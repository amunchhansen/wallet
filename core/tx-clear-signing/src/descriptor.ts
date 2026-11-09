// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import { CONTRACT_PREFIX, parseIntent } from './intent.js'

// The patterns are those of canton-clear-signing-v1.schema.json. The conformance test runs the
// schema's own valid and invalid examples through this parser.
const SCHEMA_ID = 'https://example.org/canton-clear-signing/v1/schema.json'

const NAME = '[A-Za-z_][A-Za-z0-9_]*'
const MAP_KEY = '\\["(?:[^"\\\\]|\\\\.)*"\\]'
// Every step is a name, with optional map-key steps. There is no step for every element of a list or
// map: a field shows a list or map of variable size as a whole, with the raw format.
const NAME_STEP = `${NAME}(?:${MAP_KEY})*`
const STEPS = `${NAME_STEP}(?:\\.${NAME_STEP})*`

const identifier = new RegExp(`^${NAME}$`)
// Daml constructors start with an uppercase letter, as do the Optional cases Some and None
const caseName = /^[A-Z][A-Za-z0-9_]*$/
const dottedName = new RegExp(`^${NAME}(?:\\.${NAME})*$`)
const pathPattern = new RegExp(`^(?:${STEPS}|@\\.contract\\.${STEPS})$`)
/** A path inside a case: it starts at the matched value, so it cannot read the contract. */
const relativePathPattern = new RegExp(`^${STEPS}$`)
const enumRef = new RegExp(`^\\$\\.metadata\\.enums\\.${NAME}$`)
const semver =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/
/** One line with a non-whitespace character. */
const displayText = /^[^\r\n]*\S[^\r\n]*$/
/** One line without leading or trailing whitespace. */
const trimmedLine = /^\S(?:[^\r\n]*\S)?$/
/** Like `trimmedLine`, and without braces, so it cannot contain a placeholder. */
const stableIntent = /^[^\s{}](?:[^\r\n{}]*[^\s{}])?$/

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

/** A value to display. With `cases`, the field shows the shape of its value instead of a format. */
export interface Field {
    path: string
    label?: string | undefined
    format?: Format | undefined
    params?: { $ref: string } | undefined
    cases?: Record<string, Case> | undefined
}

/** How a field is shown when its value has one shape: a variant constructor, `Some` or `None`. */
export interface Case {
    label?: string | undefined
    fields?: Field[] | undefined
}

function fieldSchema(path: RegExp) {
    return z
        .strictObject({
            path: z.string().regex(path),
            label: z.string().regex(displayText).optional(),
            format: z.enum(FORMATS).optional(),
            params: z
                .strictObject({ $ref: z.string().regex(enumRef) })
                .optional(),
            cases: CasesSchema.optional(),
        })
        .refine((f) => (f.format === 'enum') === (f.params !== undefined), {
            message:
                "params are required with format 'enum' and forbidden otherwise",
        })
        .refine((f) => f.cases === undefined || f.format === undefined, {
            message: 'a field with cases has no format',
        })
}

const FieldSchema: z.ZodType<Field> = z.lazy(() => fieldSchema(pathPattern))
const CaseFieldSchema: z.ZodType<Field> = z.lazy(() =>
    fieldSchema(relativePathPattern)
)
const CaseSchema: z.ZodType<Case> = z.lazy(() =>
    z
        .strictObject({
            label: z.string().regex(displayText).optional(),
            fields: z.array(CaseFieldSchema).min(1).optional(),
        })
        .refine((c) => c.label !== undefined || c.fields !== undefined, {
            message: 'a case needs a label or fields',
        })
)
const CasesSchema = z
    .record(z.string().regex(caseName), CaseSchema)
    .refine((cases) => Object.keys(cases).length > 0, {
        message: 'cases needs at least one entry',
    })

const OperationSchema = z.strictObject({
    intent: z.string().regex(stableIntent),
    interpolatedIntent: z.string().optional(),
    fields: z.array(FieldSchema).optional(),
})

const EnumTableSchema = z
    .record(
        z.union([z.string().regex(identifier), z.literal(['true', 'false'])]),
        z.string().regex(displayText)
    )
    .refine((table) => Object.keys(table).length > 0, {
        message: 'an enum table needs at least one entry',
    })

const DescriptorSchema = z.strictObject({
    $schema: z.literal(SCHEMA_ID, {
        error: `unsupported schema; expected '${SCHEMA_ID}'`,
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
        publisher: z.string().regex(trimmedLine),
        name: z.string().regex(trimmedLine),
        url: z.url().optional(),
        enums: z
            .record(z.string().regex(identifier), EnumTableSchema)
            .optional(),
    }),
    display: z
        .strictObject({
            create: OperationSchema.optional(),
            exercises: z
                .record(z.string().regex(identifier), OperationSchema)
                .refine((e) => Object.keys(e).length > 0, {
                    message: 'exercises needs at least one entry',
                })
                .optional(),
        })
        .refine((d) => d.create !== undefined || d.exercises !== undefined, {
            message: 'display needs create or exercises',
        }),
    signatures: z.array(z.unknown()).max(0).optional(),
})

export type Descriptor = z.infer<typeof DescriptorSchema>
export type Operation = z.infer<typeof OperationSchema>
export type Format = (typeof FORMATS)[number]

export class DescriptorError extends Error {
    constructor(readonly problems: string[]) {
        super(`invalid clear-signing descriptor: ${problems.join('; ')}`)
        this.name = 'DescriptorError'
    }
}

/**
 * Validates descriptor JSON against the v1 schema, and then against the rules a JSON Schema cannot
 * express: an operation declares each path once, every placeholder equals the path of a declared
 * field, contract fields are declared once in `create` and read as `{@.contract.<path>}` from an
 * exercise, and every enum reference names a table.
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
    const create = d.display.create
    const problems = create ? operationProblems(d, 'create', create) : []
    const contractPaths = create ? fieldPaths(create) : []
    for (const [choice, op] of Object.entries(d.display.exercises ?? {})) {
        problems.push(
            ...operationProblems(d, `exercises.${choice}`, op, contractPaths)
        )
    }
    return problems
}

// contractPaths is the create field paths for an exercise, and absent for create, where @.contract
// does not exist.
function operationProblems(
    d: Descriptor,
    where: string,
    op: Operation,
    contractPaths?: string[]
): string[] {
    const problems: string[] = []
    const ownPaths = fieldPaths(op)
    for (const f of op.fields ?? []) {
        if (f.path.startsWith(CONTRACT_PREFIX)) {
            problems.push(
                `${where}: field '${f.path}' reads the contract; declare it in create`
            )
        }
    }
    problems.push(...fieldProblems(d, where, op.fields ?? []))

    let segments
    try {
        segments = parseIntent(op.interpolatedIntent ?? '')
    } catch (err) {
        return [...problems, `${where}: ${(err as Error).message}`]
    }
    for (const segment of segments) {
        if (segment.kind !== 'placeholder') continue
        const p = segment.path
        if (!p.startsWith(CONTRACT_PREFIX)) {
            if (!ownPaths.includes(p)) {
                problems.push(
                    `${where}: placeholder '${p}' has no field with that path`
                )
            }
        } else if (contractPaths === undefined) {
            problems.push(
                `${where}: placeholder '${p}' reads the contract outside an exercise`
            )
        } else if (!contractPaths.includes(p.slice(CONTRACT_PREFIX.length))) {
            problems.push(
                `${where}: placeholder '${p}' has no field '${p.slice(CONTRACT_PREFIX.length)}' in create`
            )
        }
    }
    return problems
}

// Checks a list of fields and, recursively, the fields of their cases: each list declares a path
// once, and every enum reference names a table.
function fieldProblems(
    d: Descriptor,
    where: string,
    fields: Field[]
): string[] {
    const problems: string[] = []
    const seen = new Set<string>()
    for (const f of fields) {
        if (seen.has(f.path)) {
            problems.push(
                `${where}: field '${f.path}' is declared more than once`
            )
        }
        seen.add(f.path)
        const enumName = f.params?.$ref.slice('$.metadata.enums.'.length)
        if (enumName !== undefined && !d.metadata.enums?.[enumName]) {
            problems.push(
                `${where}: field '${f.path}' references missing enum '${f.params?.$ref}'`
            )
        }
        for (const [name, c] of Object.entries(f.cases ?? {})) {
            problems.push(
                ...fieldProblems(
                    d,
                    `${where}: field '${f.path}' case '${name}'`,
                    c.fields ?? []
                )
            )
        }
    }
    return problems
}

// The paths an interpolatedIntent may name: the operation's own fields, not the fields of their cases.
function fieldPaths(op: Operation): string[] {
    return (op.fields ?? []).map((f) => f.path)
}
