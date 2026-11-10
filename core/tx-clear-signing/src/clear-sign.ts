// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Create, Value } from '@canton-network/core-ledger-proto'
import type {
    Descriptor,
    Exercise,
    Field,
    Format,
    Operation,
} from './descriptor.js'
import { FormatError, formatValue, type EnumTables } from './format.js'
import { CONTRACT_PREFIX, parseIntent } from './intent.js'
import {
    describeKind,
    isNone,
    parsePath,
    PathError,
    resolvePath,
    type Resolved,
} from './path.js'
import {
    contractArgument,
    contractsOf,
    decode,
    rootNodes,
    templateKey,
    templateRef,
    type RootNode,
    type TemplateRef,
} from './roots.js'

export interface DescribedField {
    label: string
    path: string
    /** Absent when the field failed. */
    value?: string
    error?: string
    /** The descriptor field's format, when it declares one. The wallet quotes `string` values. */
    format?: Format
    /**
     * True when a field with cases is `None` because the value is not in the transaction. The ledger
     * leaves trailing `None` fields out, so this is usually an unset optional; it is also what a
     * mistyped path looks like, so the wallet shows that the value was inferred.
     */
    absent?: true
    /**
     * For a field with cases: `Some` or `None`. `value` is that name, or, when the field declares a
     * format, the formatted `Some`.
     */
    case?: string
    /** The fields of the matched case, resolved against the value the case matched. */
    fields?: DescribedField[]
}

/**
 * One part of an intent: wording from the descriptor, or a value read from the transaction. A wallet
 * renders values apart from the wording, so a value cannot pass as part of the sentence.
 */
export type IntentPart =
    | { kind: 'text'; text: string }
    | { kind: 'value'; path: string; value: string; format?: Format }

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
 * `fields` and `descriptor` come from the descriptor. The descriptor is chosen by `template`, and
 * its entry by the kind and, for an exercise, by `choiceId` and `interface`. An entry matches only
 * when its interface equals the node's, module and entity; an entry without one matches only a node
 * without one.
 */
export interface OperationDescription {
    nodeId: string
    kind: 'create' | 'exercise'
    template: TemplateRef
    /** The exercised choice's name. Absent for a create. */
    choiceId?: string
    /** The interface the choice is exercised through, if any. */
    interface?: TemplateRef
    /** The descriptor bound to the node, whether or not it has an entry for it. */
    descriptor?: DescriptorInfo
    /**
     * `described`: the interpolated intent rendered. `fallback`: a placeholder failed, so `intent` is
     * the descriptor's stable intent. `undescribed`: no descriptor covers the node, so `intent` is
     * generic.
     */
    status: 'described' | 'fallback' | 'undescribed'
    intent: IntentPart[]
    fields: DescribedField[]
}

export interface ClearSigningResult {
    /** True when every root is described and every field rendered. */
    complete: boolean
    operations: OperationDescription[]
}

type Header = Pick<
    OperationDescription,
    'nodeId' | 'kind' | 'template' | 'choiceId' | 'interface'
>

/** The descriptor entry for a node, and the values its paths resolve against. */
interface Selected {
    descriptor: Descriptor
    op: Operation
    /** The create argument or the choice argument. */
    argument: Value | undefined
    /** For an exercise, the create argument of the contract it acts on, read by `@.contract.` paths. */
    contract: Value | undefined
}

/**
 * Describes each root node of a prepared transaction with the descriptor bound to it. Child nodes
 * are consequences of their root's choice, which the root's descriptor words.
 *
 * The description is only as trustworthy as its binding to what is signed: call this on bytes whose
 * hash has been checked, which also rejects a transaction with duplicate or unreachable nodes.
 *
 * @param tx - the prepared transaction, base64-encoded
 * @param descriptors - descriptors already validated with `parseDescriptor`; at most one per template
 * @throws Error when two descriptors bind the same template, or the transaction is malformed
 */
export function clearSign(
    tx: string,
    descriptors: readonly Descriptor[]
): ClearSigningResult {
    const prepared = decode(tx)
    const byTemplate = indexByTemplate(descriptors)
    const contracts = contractsOf(prepared)
    const operations = rootNodes(prepared).map((node) =>
        describeNode(node, contracts, byTemplate)
    )
    const complete = operations.every(
        (op) => op.status === 'described' && op.fields.every(resolvedFully)
    )
    return { complete, operations }
}

function resolvedFully(field: DescribedField): boolean {
    return (
        field.error === undefined && (field.fields ?? []).every(resolvedFully)
    )
}

function indexByTemplate(
    descriptors: readonly Descriptor[]
): Map<string, Descriptor> {
    const byTemplate = new Map<string, Descriptor>()
    for (const d of descriptors) {
        const key = templateKey(d.context.template)
        if (byTemplate.has(key)) {
            throw new Error(`more than one descriptor for template '${key}'`)
        }
        byTemplate.set(key, d)
    }
    return byTemplate
}

function describeNode(
    node: RootNode,
    contracts: Map<string, Create>,
    byTemplate: Map<string, Descriptor>
): OperationDescription {
    const header = nodeHeader(node)
    const descriptor = byTemplate.get(templateKey(header.template))
    const selected = descriptor && selectOperation(node, descriptor, contracts)
    const bound = descriptor && { descriptor: descriptorInfo(descriptor) }
    if (!selected) {
        return {
            ...header,
            ...bound,
            status: 'undescribed',
            intent: [text(genericIntent(header))],
            fields: [],
        }
    }
    return { ...header, ...bound, ...describeOperation(selected) }
}

function nodeHeader(node: RootNode): Header {
    if (node.kind === 'create') {
        return {
            nodeId: node.nodeId,
            kind: 'create',
            template: templateRef(node.create.templateId, node.nodeId),
        }
    }
    const { templateId, choiceId, interfaceId } = node.exercise
    return {
        nodeId: node.nodeId,
        kind: 'exercise',
        template: templateRef(templateId, node.nodeId),
        choiceId,
        ...(interfaceId && {
            interface: templateRef(interfaceId, node.nodeId),
        }),
    }
}

function genericIntent(header: Header): string {
    const typeName = `${header.template.moduleName}:${header.template.entityName}`
    return header.kind === 'create'
        ? `Create ${typeName}`
        : `Exercise ${header.choiceId} on ${typeName}`
}

function selectOperation(
    node: RootNode,
    descriptor: Descriptor,
    contracts: Map<string, Create>
): Selected | undefined {
    if (node.kind === 'create') {
        const op = descriptor.display.create
        return (
            op && {
                descriptor,
                op,
                argument: node.create.argument,
                contract: undefined,
            }
        )
    }
    const { interfaceId } = node.exercise
    const op = exerciseEntry(
        descriptor.display.exercises,
        node.exercise.choiceId,
        interfaceId && templateRef(interfaceId, node.nodeId)
    )
    return (
        op && {
            descriptor,
            op,
            argument: node.exercise.chosenValue,
            contract: contractArgument(contracts, node.exercise),
        }
    )
}

/**
 * The exercise entry for a node. The choice and the interface must both match. An entry without an
 * interface matches only a node exercised as the template's own choice.
 */
function exerciseEntry(
    exercises: readonly Exercise[] | undefined,
    choiceId: string,
    iface: TemplateRef | undefined
): Exercise | undefined {
    return (exercises ?? []).find(
        (e) => e.choice === choiceId && sameInterface(e.interface, iface)
    )
}

function sameInterface(
    entry: { moduleName: string; entityName: string } | undefined,
    node: TemplateRef | undefined
): boolean {
    if (entry === undefined || node === undefined) {
        return entry === undefined && node === undefined
    }
    return (
        entry.moduleName === node.moduleName &&
        entry.entityName === node.entityName
    )
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
    selected: Selected
): Pick<OperationDescription, 'status' | 'intent' | 'fields'> {
    const { op } = selected
    const enums = selected.descriptor.metadata.enums ?? {}
    const fields = (op.fields ?? []).map((f) =>
        describeField(f, startOf(f.path, selected), enums)
    )
    if (op.interpolatedIntent === undefined) {
        return { status: 'described', intent: [text(op.intent)], fields }
    }
    try {
        const intent = parseIntent(op.interpolatedIntent).map(
            (segment): IntentPart =>
                segment.kind === 'text'
                    ? segment
                    : valuePart(segment.path, fields)
        )
        return { status: 'described', intent, fields }
    } catch (err) {
        if (!(err instanceof PathError)) throw err
        // The stable intent words the operation without values; the fields still show them.
        return { status: 'fallback', intent: [text(op.intent)], fields }
    }
}

// The value an operation field's path starts at: the argument, or the exercised contract.
function startOf(path: string, selected: Selected): Value | undefined {
    return path.startsWith(CONTRACT_PREFIX)
        ? selected.contract
        : selected.argument
}

/**
 * Resolves and formats a field. A field without cases fails on `None`, whether the ledger kept it or
 * left it out: an optional value is shown through cases. A field with cases fails unless the value is
 * optional, and on a `Some` or `None` it does not list, except a `Some` that its declared format
 * accepts. It shows `Some` or `None`, or that formatted value.
 */
function describeField(
    field: Field,
    start: Value | undefined,
    enums: EnumTables
): DescribedField {
    const label = field.label ?? field.path
    try {
        const resolved = resolveField(field, start)
        if (field.cases) {
            const shape = shapeOf(resolved)
            const matched = field.cases[shape.name]
            const formatted =
                shape.name !== 'None' && field.format !== undefined
            if (!matched && !formatted) {
                throw shape.name === 'None'
                    ? noneError(field, resolved)
                    : new PathError(
                          `'${field.path}' has no case '${shape.name}'`
                      )
            }
            return {
                label,
                path: field.path,
                value: formatted
                    ? formatValue(resolved.value, field, enums)
                    : shape.name,
                case: shape.name,
                ...(formatted && declaredFormat(field)),
                ...(matched?.fields && {
                    fields: matched.fields.map((f) =>
                        describeField(f, shape.payload, enums)
                    ),
                }),
                ...(resolved.absentField !== undefined && {
                    absent: true as const,
                }),
            }
        }
        if (isNone(resolved.value)) throw noneError(field, resolved)
        return {
            label,
            path: field.path,
            value: formatValue(resolved.value, field, enums),
            ...declaredFormat(field),
        }
    } catch (err) {
        if (!(err instanceof PathError || err instanceof FormatError)) {
            throw err
        }
        return {
            label,
            path: field.path,
            error: err.message,
            ...declaredFormat(field),
        }
    }
}

// A placeholder shows the field with the same path, as the field shows it.
function valuePart(path: string, fields: DescribedField[]): IntentPart {
    const described = fields.find((f) => f.path === path)
    if (described?.value === undefined) {
        throw new PathError(`'${path}' has no value`)
    }
    return {
        kind: 'value',
        path,
        value: described.value,
        ...(described.format && { format: described.format }),
    }
}

function noneError(field: Field, resolved: Resolved): PathError {
    return new PathError(
        resolved.absentField === undefined
            ? `'${field.path}' is None`
            : `'${resolved.absentField}' is not in the transaction`
    )
}

interface Shape {
    name: string
    payload?: Value
}

// The shape a field with cases is matched on, and the value its case fields start at. Cases apply
// only to an optional value. Some is already unwrapped, so an Optional holding a variant or an enum
// is Some, and the case fields start at what it holds.
function shapeOf(resolved: Resolved): Shape {
    const { value } = resolved
    if (isNone(value)) return { name: 'None' }
    if (resolved.some) return { name: 'Some', payload: value }
    throw new PathError(
        `cases applied to ${describeKind(value)}, which is not optional`
    )
}

function declaredFormat(field: Field): { format: Format } | undefined {
    return field.format === undefined ? undefined : { format: field.format }
}

function resolveField(field: Field, start: Value | undefined): Resolved {
    if (!start) {
        throw new PathError(`'${field.path}' has no value to start from`)
    }
    const path = field.path.startsWith(CONTRACT_PREFIX)
        ? field.path.slice(CONTRACT_PREFIX.length)
        : field.path
    return resolvePath(start, parsePath(path))
}

function text(t: string): IntentPart {
    return { kind: 'text', text: t }
}
