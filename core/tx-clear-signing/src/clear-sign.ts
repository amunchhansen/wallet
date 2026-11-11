// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Value } from '@canton-network/core-ledger-proto'
import { hashForReview } from './hash.js'
import type {
    Descriptor,
    Exercise,
    Field,
    Format,
    Operation,
} from './descriptor.js'
import { FormatError, enumKey, formatValue, type EnumTables } from './format.js'
import { CONTRACT_PREFIX, parseIntent } from './intent.js'
import {
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
    type ContractSet,
    type RootNode,
    type TemplateRef,
} from './roots.js'
import { indexByTemplate } from './select.js'

export interface DescribedField {
    label: string
    path: string
    /** Absent when the field failed. */
    value?: string
    error?: string
    /** The descriptor field's format, when it declares one. The wallet quotes `string` values. */
    format?: Format
    /**
     * True when an optional field is `None` because the value is not in the transaction. The ledger
     * leaves trailing `None` fields out, so this is usually an unset optional; it is also what a
     * mistyped path looks like, so the wallet shows that the value was inferred.
     */
    absent?: true
    /** For an enum field: the constructor, or `true`/`false`, that the table mapped. */
    enumKey?: string
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
    kind: 'create' | 'exercise' | 'other'
    /** Absent when a root is not a create or an exercise and carries no template. */
    template?: TemplateRef
    /** The exercised choice's name. Absent for a create. */
    choiceId?: string
    /** The interface the choice is exercised through, if any. */
    interface?: TemplateRef
    /** For a root that is not a create or an exercise: the node's kind, such as `fetch`. */
    nodeType?: string
    /** Why a root is `undescribable`. */
    reason?: string
    /** The descriptor bound to the node, whether or not it has an entry for it. */
    descriptor?: DescriptorInfo
    /**
     * `described`: the interpolated intent rendered. `fallback`: a placeholder failed, so `intent` is
     * the descriptor's stable intent. `undescribed`: no descriptor covers the node, so `intent` is
     * generic. `undescribable`: the node itself cannot be read (its contract is missing or
     * ambiguous, or it is not a create or an exercise); `reason` says why. `status` is about the
     * intent. `complete` is false when any root is not `described` or any field has an error.
     */
    status: 'described' | 'fallback' | 'undescribed' | 'undescribable'
    intent: IntentPart[]
    fields: DescribedField[]
}

export interface TransactionDescription {
    /** True when every root is described and every field rendered. */
    complete: boolean
    operations: OperationDescription[]
}

export interface ClearSigningResult extends TransactionDescription {
    /** The hash of the described transaction, equal to `expectedHash`. */
    hash: string
}

export class HashMismatchError extends Error {
    constructor(expectedHash: string) {
        super(`prepared transaction does not hash to '${expectedHash}'`)
        this.name = 'HashMismatchError'
    }
}

type Header = Pick<
    OperationDescription,
    'nodeId' | 'kind' | 'template' | 'choiceId' | 'interface' | 'nodeType'
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
 * The description is only as trustworthy as its binding to what is signed. `expectedHash` is the hash
 * the user is asked to approve; the transaction is described only when it hashes to that value.
 * Hashing also rejects a transaction with duplicate or unreachable nodes.
 *
 * @param tx - the prepared transaction, base64-encoded
 * @param descriptors - descriptors already validated with `parseDescriptor`; at most one per template
 * @param expectedHash - the hash the transaction must have, as base64
 * @throws HashMismatchError when the transaction does not hash to `expectedHash`
 * @throws Error when two descriptors bind the same template, or the transaction is malformed
 */
export async function clearSign(
    tx: string,
    descriptors: readonly Descriptor[],
    expectedHash: string
): Promise<ClearSigningResult> {
    const hash = await hashForReview(tx, expectedHash)
    if (hash === undefined) {
        throw new HashMismatchError(expectedHash)
    }
    return { ...describeUnverified(tx, descriptors), hash }
}

/**
 * Describes a prepared transaction like `clearSign`, without checking its hash. The description is
 * not bound to anything signed, so it must not be shown as what a user approves; it is for previewing
 * how descriptors word a transaction, including one too incomplete to hash.
 *
 * @throws Error when two descriptors bind the same template, or the transaction is malformed
 */
export function describeUnverified(
    tx: string,
    descriptors: readonly Descriptor[]
): TransactionDescription {
    const prepared = decode(tx)
    const byTemplate = indexByTemplate(descriptors)
    const contracts = contractsOf(prepared)
    const operations = rootNodes(prepared).map((node) =>
        describeNode(node, contracts, byTemplate)
    )
    const complete = operations.every(
        (op) => op.status === 'described' && op.fields.every(resolved)
    )
    return { complete, operations }
}

function resolved(field: DescribedField): boolean {
    return field.error === undefined
}

function describeNode(
    node: RootNode,
    contracts: ContractSet,
    byTemplate: Map<string, Descriptor>
): OperationDescription {
    const header = nodeHeader(node)
    if (node.kind === 'other') {
        return undescribable(
            header,
            `root node '${node.nodeId}' is a '${node.nodeType}' node`
        )
    }
    const descriptor = header.template
        ? byTemplate.get(templateKey(header.template))
        : undefined
    const bound = descriptor && { descriptor: descriptorInfo(descriptor) }
    const selected = descriptor && selectOperation(node, descriptor, contracts)
    if (selected?.reason) {
        return { ...undescribable(header, selected.reason), ...bound }
    }
    if (!selected?.selected) {
        return {
            ...header,
            ...bound,
            status: 'undescribed',
            intent: [text(genericIntent(header))],
            fields: [],
        }
    }
    return { ...header, ...bound, ...describeOperation(selected.selected) }
}

function undescribable(header: Header, reason: string): OperationDescription {
    return {
        ...header,
        status: 'undescribable',
        reason,
        intent: [text(genericIntent(header))],
        fields: [],
    }
}

function nodeHeader(node: RootNode): Header {
    if (node.kind === 'other') {
        return {
            nodeId: node.nodeId,
            kind: 'other',
            nodeType: node.nodeType,
            ...(node.template && { template: node.template }),
        }
    }
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
    if (header.kind === 'other' || !header.template) {
        return `Cannot describe ${header.nodeType ?? 'this'} node`
    }
    const typeName = `${header.template.moduleName}:${header.template.entityName}`
    return header.kind === 'create'
        ? `Create ${typeName}`
        : `Exercise ${header.choiceId} on ${typeName}`
}

interface Attempt {
    selected?: Selected
    reason?: string
}

function selectOperation(
    node: RootNode,
    descriptor: Descriptor,
    contracts: ContractSet
): Attempt | undefined {
    if (node.kind !== 'create' && node.kind !== 'exercise') return undefined
    if (node.kind === 'create') {
        const op = descriptor.display.create
        return (
            op && {
                selected: {
                    descriptor,
                    op,
                    argument: node.create.argument,
                    contract: undefined,
                },
            }
        )
    }
    const { interfaceId } = node.exercise
    const op = exerciseEntry(
        descriptor.display.exercises,
        node.exercise.choiceId,
        interfaceId && templateRef(interfaceId, node.nodeId)
    )
    if (!op) return undefined
    const lookedUp = contractArgument(contracts, node.exercise)
    if ('reason' in lookedUp) return { reason: lookedUp.reason }
    return {
        selected: {
            descriptor,
            op,
            argument: node.exercise.chosenValue,
            contract: lookedUp.argument,
        },
    }
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
 * Resolves and formats a field. A field fails on `None`, whether the ledger kept it or left it out,
 * unless it is `optional`: then `None` is shown as None and a `Some` is formatted (raw, when the
 * field declares no format).
 */
function describeField(
    field: Field,
    start: Value | undefined,
    enums: EnumTables
): DescribedField {
    const label = field.label ?? field.path
    try {
        const resolved = resolveField(field, start)
        if (isNone(resolved.value)) {
            if (!field.optional) throw noneError(field, resolved)
            return {
                label,
                path: field.path,
                value: 'None',
                ...(resolved.absentField !== undefined && {
                    absent: true as const,
                }),
            }
        }
        return {
            label,
            path: field.path,
            value: formatValue(resolved.value, field, enums),
            ...declaredFormat(field),
            ...(field.format === 'enum' && {
                enumKey: enumKey(resolved.value),
            }),
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
