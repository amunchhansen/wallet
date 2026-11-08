// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import { CONSTANT_PREFIX, CONTRACT_PREFIX, parseIntent } from './intent.js'

const SCHEMA_ID = 'https://example.org/canton-clear-signing/v1/schema.json'

const NAME = '[A-Za-z_][A-Za-z0-9_]*'
const DOTTED_NAME = `${NAME}(\\.${NAME})*`
const MAP_KEY = '\\["([^"\\\\]|\\\\.)*"\\]'
const STEP = `(${NAME}(${MAP_KEY})*|\\[\\])`

const identifier = new RegExp(`^${NAME}$`)
const dottedName = new RegExp(`^${DOTTED_NAME}$`)
const ARGUMENT_PATH = `${STEP}(\\.${STEP})*`
const pathPattern = new RegExp(
    `^(${ARGUMENT_PATH}|@\\.contract\\.${ARGUMENT_PATH}|\\$\\.metadata\\.constants\\.${NAME})$`
)
const enumRef = new RegExp(`^\\$\\.metadata\\.enums\\.${NAME}$`)
const semver =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/
const nonBlank = /\S/

const FORMATS = [
    'string',
    'number',
    'boolean',
    'party',
    'contractId',
    'dateTime',
    'duration',
    'enum',
    'raw',
] as const

const FieldSchema = z
    .strictObject({
        path: z.string().regex(pathPattern),
        label: z.string().optional(),
        format: z.enum(FORMATS).optional(),
        params: z.strictObject({ $ref: z.string().regex(enumRef) }).optional(),
    })
    .refine((f) => f.format !== 'enum' || f.params !== undefined, {
        message: "format 'enum' requires params",
    })
    .refine((f) => f.format === 'enum' || f.params === undefined, {
        message: "params are only allowed with format 'enum'",
    })

const OperationSchema = z.strictObject({
    intent: z.string().regex(nonBlank),
    interpolatedIntent: z.string().optional(),
    fields: z.array(FieldSchema).optional(),
})

const EnumTableSchema = z
    .record(z.string(), z.string().regex(nonBlank))
    .refine((table) => Object.keys(table).length > 0, {
        message: 'an enum table needs at least one entry',
    })

const DescriptorSchema = z.strictObject({
    $schema: z.string().refine((s) => s === SCHEMA_ID, {
        message: `unsupported schema; expected '${SCHEMA_ID}'`,
    }),
    $comment: z.string().optional(),
    context: z.strictObject({
        template: z.strictObject({
            packageId: z.string().regex(/^[0-9a-f]{64}$/),
            moduleName: z.string().regex(dottedName),
            entityName: z.string().regex(identifier),
        }),
    }),
    metadata: z.strictObject({
        version: z.string().regex(semver),
        publisher: z.string().regex(nonBlank),
        name: z.string().regex(nonBlank),
        url: z.url().optional(),
        constants: z
            .record(
                z.string().regex(identifier),
                z.union([z.string(), z.number(), z.boolean(), z.null()])
            )
            .optional(),
        enums: z
            .record(z.string().regex(identifier), EnumTableSchema)
            .optional(),
    }),
    display: z
        .strictObject({
            create: OperationSchema.optional(),
            exercises: z
                .record(z.string().regex(identifier), OperationSchema)
                .optional(),
        })
        .refine((d) => d.create !== undefined || d.exercises !== undefined, {
            message: 'display needs create or exercises',
        }),
    signatures: z.array(z.unknown()).max(0).optional(),
})

export type Descriptor = z.infer<typeof DescriptorSchema>
export type Operation = z.infer<typeof OperationSchema>
export type Field = z.infer<typeof FieldSchema>
export type Format = (typeof FORMATS)[number]

export class DescriptorError extends Error {
    constructor(readonly problems: string[]) {
        super(`invalid clear-signing descriptor: ${problems.join('; ')}`)
        this.name = 'DescriptorError'
    }
}

/**
 * Validates descriptor JSON against the v1 descriptor format, including the rules JSON Schema cannot
 * express: every placeholder equals the path of a declared field, contract fields are declared once in
 * `create` and read as `{@.contract.<path>}` from an exercise, every enum reference exists, and every
 * `$.metadata.constants` path names a string, number or boolean constant.
 *
 * @throws DescriptorError listing every problem found
 */
export function parseDescriptor(json: unknown): Descriptor {
    const result = DescriptorSchema.safeParse(json)
    if (!result.success) {
        throw new DescriptorError(
            result.error.issues.map(
                (issue) =>
                    `${issue.path.join('.') || '<root>'}: ${issue.message}`
            )
        )
    }
    const problems = crossReferenceProblems(result.data)
    if (problems.length > 0) {
        throw new DescriptorError(problems)
    }
    return result.data
}

function crossReferenceProblems(d: Descriptor): string[] {
    const problems: string[] = []
    const create = d.display.create
    const contractPaths = create ? fieldPaths(create) : undefined
    if (create) {
        problems.push(...operationProblems(d, 'create', create, undefined))
    }
    const exercises = d.display.exercises ?? {}
    for (const key of Object.keys(exercises).sort()) {
        const op = exercises[key]
        if (op) {
            problems.push(
                ...operationProblems(
                    d,
                    `exercises.${key}`,
                    op,
                    contractPaths ?? []
                )
            )
        }
    }
    return problems
}

// contractPaths is undefined for create, where @.contract does not exist, and the create field
// paths for an exercise.
function operationProblems(
    d: Descriptor,
    where: string,
    op: Operation,
    contractPaths: string[] | undefined
): string[] {
    const problems: string[] = []
    for (const f of op.fields ?? []) {
        if (f.path.startsWith(CONTRACT_PREFIX)) {
            problems.push(
                `${where}: field '${f.path}' reads the contract; declare it in create`
            )
        }
        const constant = constantProblem(d, f.path)
        if (constant !== undefined) {
            problems.push(`${where}: field '${f.path}' ${constant}`)
        }
        const enumName = f.params?.$ref.slice('$.metadata.enums.'.length)
        if (
            enumName !== undefined &&
            d.metadata.enums?.[enumName] === undefined
        ) {
            problems.push(
                `${where}: field '${f.path}' references missing enum '${f.params?.$ref}'`
            )
        }
    }

    let segments
    try {
        segments = parseIntent(op.interpolatedIntent ?? '')
    } catch (err) {
        return [...problems, `${where}: ${(err as Error).message}`]
    }
    const ownPaths = fieldPaths(op)
    for (const segment of segments) {
        if (segment.kind !== 'placeholder') continue
        const p = segment.path
        if (p.startsWith(CONTRACT_PREFIX)) {
            const contractPath = p.slice(CONTRACT_PREFIX.length)
            if (contractPaths === undefined) {
                problems.push(
                    `${where}: placeholder '${p}' reads the contract outside an exercise`
                )
            } else if (!contractPaths.includes(contractPath)) {
                problems.push(
                    `${where}: placeholder '${p}' has no field '${contractPath}' in create`
                )
            }
        } else if (!ownPaths.includes(p)) {
            problems.push(
                `${where}: placeholder '${p}' has no field with that path`
            )
        }
    }
    return problems
}

function constantProblem(d: Descriptor, path: string): string | undefined {
    if (!path.startsWith(CONSTANT_PREFIX)) return undefined
    const name = path.slice(CONSTANT_PREFIX.length)
    const value = d.metadata.constants?.[name]
    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return undefined
    }
    return `has no constant '${name}'`
}

function fieldPaths(op: Operation): string[] {
    return (op.fields ?? []).map((f) => f.path)
}
