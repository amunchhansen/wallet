// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Value } from '@canton-network/core-ledger-proto'
import { hashForReview } from './hash.js'
import {
    DescriptorError,
    parseDescriptor,
    type Descriptor,
    type Exercise,
    type Field,
    type Format,
    type Operation,
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
     * generic. `invalid`: a descriptor binds to the node but is not a valid descriptor; `reason`
     * lists what is wrong with it. `undescribable`: the node itself cannot be read (its contract is
     * missing or ambiguous, or it is not a create or an exercise); `reason` says why. `status` is
     * about the intent. `complete` is false when any root is not `described` or any field has an error.
     */
    status:
        | 'described'
        | 'fallback'
        | 'undescribed'
        | 'invalid'
        | 'undescribable'
    /**
     * The sentence, with values filled in. On `fallback`, `undescribed`, `invalid` and `undescribable`
     * it is the sentence `intent` shows: the descriptor's stable intent, or a generic one. `intent`
     * keeps each value apart from the wording, so a wallet can render a value separately from the
     * sentence.
     */
    interpolatedIntent: string
    intent: IntentPart[]
    fields: DescribedField[]
}

/**
 * The description of a prepared transaction, one entry per root. `clearSign` returns this plus the
 * hash. The wallet's transaction detail renders `operations`.
 */
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

/** Why a descriptor passed to `clearSign` is not one of the transaction's roots. */
export interface ExtraDescriptor {
    /** Index in the descriptors `clearSign` was given. */
    index: number
    /** `packageId:moduleName:entityName`, when the descriptor names a template. */
    template?: string
    reason: 'unused' | 'duplicate' | 'unreadable'
    /** Problems from validating the descriptor, when it is not valid. */
    problems?: readonly string[]
}

/**
 * `clearSign` was given a descriptor that is not a single binding for a root template: it names no
 * template, it names a template that is not a create or exercise root, or another descriptor already
 * binds that template. The transaction is not described.
 */
export class ExtraDescriptorsError extends Error {
    constructor(readonly extras: readonly ExtraDescriptor[]) {
        super(extraMessage(extras))
        this.name = 'ExtraDescriptorsError'
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
 * Describes each root node of a prepared transaction with the descriptor bound to it. This is the
 * function a caller uses. Child nodes are consequences of their root's choice, which the root's
 * descriptor words.
 *
 * Pass the descriptors for this transaction's create and exercise roots, one per template.
 * `clearSign` validates each one. A root with no descriptor is `undescribed`. A descriptor that
 * binds to a root but is not valid leaves that root `invalid`, and `reason` lists the problems. A
 * descriptor that names no template, names a template that is not such a root, or repeats a template
 * is too many: `clearSign` throws `ExtraDescriptorsError` and does not describe the transaction.
 *
 * The description is only as trustworthy as its binding to what is signed. `expectedHash` is the hash
 * the user is asked to approve; the transaction is described only when it hashes to that value.
 * Hashing also rejects a transaction with duplicate or unreachable nodes. The hash is checked before
 * the descriptors are.
 *
 * @param tx - the prepared transaction, base64-encoded
 * @param descriptors - one descriptor per create or exercise root template
 * @param expectedHash - the hash the transaction must have, as base64
 * @throws HashMismatchError when the transaction does not hash to `expectedHash`
 * @throws ExtraDescriptorsError when a descriptor is unused, repeated, or has no template
 * @throws Error when the transaction cannot be hashed or is malformed
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
    return { ...describeRoots(tx, descriptors), hash }
}

/** The description `clearSign` returns once the transaction hashes to `expectedHash`. */
function describeRoots(
    tx: string,
    descriptors: readonly Descriptor[]
): TransactionDescription {
    const prepared = decode(tx)
    const roots = rootNodes(prepared)
    const bound = bindDescriptors(descriptors, rootTemplateKeys(roots))
    const contracts = contractsOf(prepared)
    const operations = roots.map((node) => describeNode(node, contracts, bound))
    const complete = operations.every(
        (op) => op.status === 'described' && op.fields.every(resolved)
    )
    return { complete, operations }
}

function resolved(field: DescribedField): boolean {
    return field.error === undefined
}

/** A descriptor bound to one root template, valid or not. */
type Bound =
    | { ok: true; descriptor: Descriptor; info: DescriptorInfo }
    | { ok: false; problems: readonly string[]; info?: DescriptorInfo }

/**
 * One descriptor per create or exercise root template. Anything else is too many, and the
 * transaction is not described. An invalid descriptor that does name such a template is kept, so
 * that root can be reported as `invalid`.
 */
function bindDescriptors(
    descriptors: readonly Descriptor[],
    rootKeys: ReadonlySet<string>
): Map<string, Bound> {
    const bound = new Map<string, Bound>()
    const extras: ExtraDescriptor[] = []
    for (const [index, json] of descriptors.entries()) {
        const inspected = inspect(json)
        const template = inspected.template
        if (!template) {
            extras.push(extra(index, 'unreadable', inspected.problems))
            continue
        }
        const key = templateKey(template)
        if (!rootKeys.has(key)) {
            extras.push(extra(index, 'unused', inspected.problems, key))
            continue
        }
        if (bound.has(key)) {
            extras.push(extra(index, 'duplicate', inspected.problems, key))
            continue
        }
        bound.set(
            key,
            inspected.parsed
                ? {
                      ok: true,
                      descriptor: inspected.parsed,
                      info: descriptorInfo(inspected.parsed),
                  }
                : {
                      ok: false,
                      problems: inspected.problems ?? [],
                      ...(inspected.info && { info: inspected.info }),
                  }
        )
    }
    if (extras.length > 0) throw new ExtraDescriptorsError(extras)
    return bound
}

function rootTemplateKeys(nodes: readonly RootNode[]): Set<string> {
    const keys = new Set<string>()
    for (const node of nodes) {
        if (node.kind === 'create') {
            keys.add(
                templateKey(templateRef(node.create.templateId, node.nodeId))
            )
        } else if (node.kind === 'exercise') {
            keys.add(
                templateKey(templateRef(node.exercise.templateId, node.nodeId))
            )
        }
    }
    return keys
}

interface Inspected {
    template?: TemplateRef
    parsed?: Descriptor
    problems?: string[]
    info?: DescriptorInfo
}

/** A valid descriptor, or the template and problems of one that is not. */
function inspect(json: unknown): Inspected {
    try {
        const parsed = parseDescriptor(json)
        return { template: parsed.context.template, parsed }
    } catch (err) {
        if (!(err instanceof DescriptorError)) throw err
        const template = readTemplate(json)
        const info = looseInfo(json)
        return {
            problems: err.problems,
            ...(template && { template }),
            ...(info && { info }),
        }
    }
}

/**
 * `packageId`, `moduleName` and `entityName` when they are non-empty strings. Validation can fail
 * and still leave a template that a root can be bound to.
 */
function readTemplate(json: unknown): TemplateRef | undefined {
    if (typeof json !== 'object' || json === null) return undefined
    const context = (json as { context?: unknown }).context
    if (typeof context !== 'object' || context === null) return undefined
    const template = (context as { template?: unknown }).template
    if (typeof template !== 'object' || template === null) return undefined
    const fields = template as Record<string, unknown>
    const packageId = nonEmpty(fields.packageId)
    const moduleName = nonEmpty(fields.moduleName)
    const entityName = nonEmpty(fields.entityName)
    if (!packageId || !moduleName || !entityName) return undefined
    return { packageId, moduleName, entityName }
}

/** Metadata the wallet can show, when the three displayed strings are present. */
function looseInfo(json: unknown): DescriptorInfo | undefined {
    if (typeof json !== 'object' || json === null) return undefined
    const metadata = (json as { metadata?: unknown }).metadata
    if (typeof metadata !== 'object' || metadata === null) return undefined
    const fields = metadata as Record<string, unknown>
    const name = nonEmpty(fields.name)
    const publisher = nonEmpty(fields.publisher)
    const version = nonEmpty(fields.version)
    if (!name || !publisher || !version) return undefined
    const url = nonEmpty(fields.url)
    return { name, publisher, version, ...(url && { url }) }
}

function nonEmpty(value: unknown): string | undefined {
    if (typeof value !== 'string' || value === '') return undefined
    return value
}

function extra(
    index: number,
    reason: ExtraDescriptor['reason'],
    problems: readonly string[] | undefined,
    template?: string
): ExtraDescriptor {
    const described: ExtraDescriptor = { index, reason }
    if (template) described.template = template
    if (problems && problems.length > 0) described.problems = problems
    return described
}

function extraMessage(extras: readonly ExtraDescriptor[]): string {
    return `too many descriptors: ${extras.map(describeExtra).join('; ')}`
}

function describeExtra(extraDescriptor: ExtraDescriptor): string {
    const subject = extraDescriptor.template
        ? `template '${extraDescriptor.template}'`
        : `descriptor ${extraDescriptor.index}`
    const why =
        extraDescriptor.reason === 'duplicate'
            ? 'is already described'
            : extraDescriptor.reason === 'unused'
              ? 'is not a root of the transaction'
              : 'has no template'
    const problems = extraDescriptor.problems?.length
        ? ` (${extraDescriptor.problems.join('; ')})`
        : ''
    return `${subject} ${why}${problems}`
}

function describeNode(
    node: RootNode,
    contracts: ContractSet,
    bound: Map<string, Bound>
): OperationDescription {
    const header = nodeHeader(node)
    if (node.kind === 'other') {
        return withIntent(
            undescribable(
                header,
                `root node '${node.nodeId}' is a '${node.nodeType}' node`
            )
        )
    }
    const key = header.template && templateKey(header.template)
    const match = key ? bound.get(key) : undefined
    if (!match) {
        return withIntent({
            ...header,
            status: 'undescribed',
            intent: [text(genericIntent(header))],
            fields: [],
        })
    }
    const info = { ...(match.info && { descriptor: match.info }) }
    if (!match.ok) {
        return withIntent({
            ...header,
            ...info,
            status: 'invalid',
            reason: match.problems.join('; '),
            intent: [text(genericIntent(header))],
            fields: [],
        })
    }
    const selected = selectOperation(node, match.descriptor, contracts)
    if (selected?.reason) {
        return withIntent({
            ...undescribable(header, selected.reason),
            ...info,
        })
    }
    if (!selected?.selected) {
        return withIntent({
            ...header,
            ...info,
            status: 'undescribed',
            intent: [text(genericIntent(header))],
            fields: [],
        })
    }
    return withIntent({
        ...header,
        ...info,
        ...describeOperation(selected.selected),
    })
}

type OperationBody = Omit<OperationDescription, 'interpolatedIntent'>

function withIntent(operation: OperationBody): OperationDescription {
    const interpolatedIntent = operation.intent
        .map((part) => (part.kind === 'text' ? part.text : part.value))
        .join('')
    return { ...operation, interpolatedIntent }
}

function undescribable(header: Header, reason: string): OperationBody {
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
): Pick<OperationBody, 'status' | 'intent' | 'fields'> {
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
