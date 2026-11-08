// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type {
    PreparedTransaction,
    Value,
} from '@canton-network/core-ledger-proto'
import type { Descriptor, Field, Operation } from './descriptor.js'
import { formatValue } from './format.js'
import { CONTRACT_PREFIX, parseIntent } from './intent.js'
import { parsePath, PathError, resolvePath, type Step } from './path.js'
import {
    contractArgument,
    decode,
    rootNodes,
    rootTemplate,
    templateKey,
    templateRef,
    type RootNode,
    type TemplateRef,
} from './roots.js'

export interface DescribedField {
    label: string
    path: string
    /** A list when the path contains `[]`. Absent when the field failed. */
    value?: string | string[]
    error?: string
}

/**
 * Who wrote the descriptor bound to a node's template. Descriptors are unsigned in v1, so this is
 * the descriptor's own claim, shown to the user as such.
 */
export interface DescriptorInfo {
    name: string
    publisher: string
    version: string
    url?: string
}

/**
 * `kind`, `template`, `choiceId` and `interface` are read from the transaction, never from the
 * descriptor, so a descriptor cannot change what the user is told is being done. Only `intent`,
 * `fields` and `descriptor` come from the descriptor. The descriptor is chosen by `template` and,
 * for an exercise, `choiceId`. An interface the choice is exercised through is not part of that choice.
 */
export interface OperationDescription {
    nodeId: string
    kind: 'create' | 'exercise'
    template: TemplateRef
    /** The exercised choice's name. Absent for a create. */
    choiceId?: string
    /** The interface the choice belongs to, when it is exercised through one. */
    interface?: TemplateRef
    /** The descriptor bound to `template`, whether or not it has an entry for this node. */
    descriptor?: DescriptorInfo
    /**
     * `described`: the interpolated intent rendered. `fallback`: a placeholder failed, so `intent` is
     * the descriptor's stable intent. `undescribed`: no descriptor covers the node.
     */
    status: 'described' | 'fallback' | 'undescribed'
    intent: string
    fields: DescribedField[]
}

export interface ClearSigningResult {
    /** True when every root is described and every field rendered. */
    complete: boolean
    operations: OperationDescription[]
}

// What a path's roots resolve against for one node.
interface Scope {
    argument: Value | undefined
    contract: Value | undefined
    descriptor: Descriptor
}

/**
 * Describes each root node of a prepared transaction with the descriptor bound to its template.
 *
 * @param descriptors - descriptors already validated with `parseDescriptor`; at most one per template
 * @throws Error when two descriptors bind the same template, or the transaction is malformed
 */
export function clearSign(
    tx: string,
    descriptors: readonly Descriptor[]
): ClearSigningResult {
    const prepared = decode(tx)
    const byTemplate = new Map<string, Descriptor>()
    for (const d of descriptors) {
        const key = templateKey(d.context.template)
        if (byTemplate.has(key)) {
            throw new Error(`more than one descriptor for template '${key}'`)
        }
        byTemplate.set(key, d)
    }

    const operations = rootNodes(prepared).map((node) =>
        describeNode(prepared, node, byTemplate)
    )
    const complete = operations.every(
        (op) =>
            op.status === 'described' &&
            op.fields.every((f) => f.error === undefined)
    )
    return { complete, operations }
}

function describeNode(
    tx: PreparedTransaction,
    node: RootNode,
    byTemplate: Map<string, Descriptor>
): OperationDescription {
    const template = rootTemplate(node)
    const descriptor = byTemplate.get(templateKey(template))
    const typeName = `${template.moduleName}:${template.entityName}`
    const bound = descriptor ? { descriptor: descriptorInfo(descriptor) } : {}

    if (node.kind === 'create') {
        const base = {
            nodeId: node.nodeId,
            kind: node.kind,
            template,
            ...bound,
        }
        const op = descriptor?.display.create
        if (!descriptor || !op) {
            return {
                ...base,
                status: 'undescribed',
                intent: `Create ${typeName}`,
                fields: [],
            }
        }
        const scope = {
            argument: node.create.argument,
            contract: undefined,
            descriptor,
        }
        return { ...base, ...describeOperation(op, scope) }
    }

    const exercise = node.exercise
    const iface = exercise.interfaceId
    const base = {
        nodeId: node.nodeId,
        kind: node.kind,
        template,
        choiceId: exercise.choiceId,
        ...(iface && { interface: templateRef(iface, node.nodeId) }),
        ...bound,
    }
    const op = descriptor?.display.exercises?.[exercise.choiceId]
    if (!descriptor || !op) {
        return {
            ...base,
            status: 'undescribed',
            intent: `Exercise ${exercise.choiceId} on ${typeName}`,
            fields: [],
        }
    }
    const scope = {
        argument: exercise.chosenValue,
        contract: contractArgument(tx, exercise.contractId, template),
        descriptor,
    }
    return { ...base, ...describeOperation(op, scope) }
}

function descriptorInfo({ metadata }: Descriptor): DescriptorInfo {
    return {
        name: metadata.name,
        publisher: metadata.publisher,
        version: metadata.version,
        ...(metadata.url !== undefined && { url: metadata.url }),
    }
}

function describeOperation(
    op: Operation,
    scope: Scope
): Pick<OperationDescription, 'status' | 'intent' | 'fields'> {
    const fields = (op.fields ?? []).map((f) => describeField(f, scope))
    if (op.interpolatedIntent === undefined) {
        return { status: 'described', intent: op.intent, fields }
    }
    try {
        return {
            status: 'described',
            intent: interpolate(op.interpolatedIntent, op, scope),
            fields,
        }
    } catch {
        return { status: 'fallback', intent: op.intent, fields }
    }
}

function describeField(field: Field, scope: Scope): DescribedField {
    const label = field.label ?? field.path
    try {
        return {
            label,
            path: field.path,
            value: renderField(field, field.path, scope),
        }
    } catch (err) {
        return { label, path: field.path, error: (err as Error).message }
    }
}

function interpolate(template: string, op: Operation, scope: Scope): string {
    return parseIntent(template)
        .map((segment) => {
            if (segment.kind === 'text') return segment.text
            const value = renderPlaceholder(segment.path, op, scope)
            return Array.isArray(value) ? value.join(', ') : value
        })
        .join('')
}

// A placeholder is formatted like the field with the same path. {@.contract.<path>} uses the create
// field with <path>, resolved against the exercised contract.
function renderPlaceholder(
    path: string,
    op: Operation,
    scope: Scope
): string | string[] {
    if (path.startsWith(CONTRACT_PREFIX)) {
        const contractPath = path.slice(CONTRACT_PREFIX.length)
        const field = scope.descriptor.display.create?.fields?.find(
            (f) => f.path === contractPath
        )
        if (!field) {
            throw new PathError(`no create field '${contractPath}'`)
        }
        return renderField(field, path, scope)
    }
    const field = op.fields?.find((f) => f.path === path)
    if (!field) {
        throw new PathError(`no field '${path}'`)
    }
    return renderField(field, path, scope)
}

function renderField(
    field: Field,
    path: string,
    scope: Scope
): string | string[] {
    const { root, steps } = parsePath(path)
    let start: Value | undefined
    switch (root) {
        case 'argument':
            start = scope.argument
            break
        case 'contract':
            start = scope.contract
            break
        case 'descriptor':
            return formatValue(
                present(constantValue(scope.descriptor, steps), path),
                field,
                enums(scope)
            )
    }
    const { values, isList } = resolvePath(present(start, path), steps)
    const formatted = values.map((v) => formatValue(v, field, enums(scope)))
    if (isList) return formatted
    const [only] = formatted
    if (only === undefined || formatted.length !== 1) {
        throw new PathError(`'${path}' did not resolve to one value`)
    }
    return only
}

function enums(scope: Scope) {
    return scope.descriptor.metadata.enums ?? {}
}

function present(v: Value | undefined, path: string): Value {
    if (!v) {
        throw new PathError(`'${path}' has no value to start from`)
    }
    return v
}

function constantValue(
    descriptor: Descriptor,
    steps: Step[]
): Value | undefined {
    const step = steps.length === 1 ? steps[0] : undefined
    const constants = descriptor.metadata.constants
    if (step?.kind !== 'name' || constants === undefined) return undefined
    const current = Object.hasOwn(constants, step.name)
        ? constants[step.name]
        : undefined
    switch (typeof current) {
        case 'string':
            return { sum: { oneofKind: 'text', text: current } }
        case 'number':
            return { sum: { oneofKind: 'numeric', numeric: String(current) } }
        case 'boolean':
            return { sum: { oneofKind: 'bool', bool: current } }
        default:
            return undefined
    }
}
