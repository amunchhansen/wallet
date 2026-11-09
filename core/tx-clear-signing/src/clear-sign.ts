// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type {
    PreparedTransaction,
    Value,
} from '@canton-network/core-ledger-proto'
import type { Descriptor, Field, Operation } from './descriptor.js'
import { formatValue, type EnumTables } from './format.js'
import { CONTRACT_PREFIX, parseIntent } from './intent.js'
import { isNone, parsePath, PathError, resolvePath } from './path.js'
import {
    contractArgument,
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
}

/**
 * One part of an intent: wording from the descriptor, or a value read from the transaction. A wallet
 * renders values apart from the wording, so a value cannot pass as part of the sentence.
 */
export type IntentPart =
    | { kind: 'text'; text: string }
    | { kind: 'value'; path: string; value: string }

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
 * for an exercise, `choiceId`.
 */
export interface OperationDescription {
    nodeId: string
    kind: 'create' | 'exercise'
    template: TemplateRef
    /** The exercised choice's name. Absent for a create. */
    choiceId?: string
    /** The interface the choice is exercised through, if any. */
    interface?: TemplateRef
    /** The descriptor bound to `template`, whether or not it has an entry for this node. */
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
    /** For an exercise, the create argument of the contract it acts on, read by `{@.contract.…}`. */
    contract: Value | undefined
}

/**
 * Describes each root node of a prepared transaction with the descriptor bound to its template.
 * Child nodes are consequences of their root's choice, which the root's descriptor words.
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
    tx: PreparedTransaction,
    node: RootNode,
    byTemplate: Map<string, Descriptor>
): OperationDescription {
    const header = nodeHeader(node)
    const descriptor = byTemplate.get(templateKey(header.template))
    const selected = descriptor && selectOperation(tx, node, descriptor)
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
    tx: PreparedTransaction,
    node: RootNode,
    descriptor: Descriptor
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
    const op = descriptor.display.exercises?.[node.exercise.choiceId]
    return (
        op && {
            descriptor,
            op,
            argument: node.exercise.chosenValue,
            contract: contractArgument(tx, node.exercise),
        }
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
    const fields = (op.fields ?? []).map((f) =>
        describeField(f, selected.argument, enums(selected))
    )
    if (op.interpolatedIntent === undefined) {
        return { status: 'described', intent: [text(op.intent)], fields }
    }
    try {
        const intent = parseIntent(op.interpolatedIntent).map(
            (segment): IntentPart =>
                segment.kind === 'text'
                    ? segment
                    : {
                          kind: 'value',
                          path: segment.path,
                          value: renderPlaceholder(segment.path, selected),
                      }
        )
        return { status: 'described', intent, fields }
    } catch {
        // The stable intent words the operation without values; the fields still show them.
        return { status: 'fallback', intent: [text(op.intent)], fields }
    }
}

function describeField(
    field: Field,
    argument: Value | undefined,
    enums: EnumTables
): DescribedField {
    const label = field.label ?? field.path
    try {
        const resolved = resolveField(field, argument)
        return {
            label,
            path: field.path,
            value: format(resolved, field, enums),
        }
    } catch (err) {
        return { label, path: field.path, error: (err as Error).message }
    }
}

// A placeholder is formatted like the field with the same path. {@.contract.<path>} is the create
// field with <path>, resolved against the contract the exercise acts on. A None fails the placeholder,
// so the sentence never depends on an absent value.
function renderPlaceholder(path: string, selected: Selected): string {
    const readsContract = path.startsWith(CONTRACT_PREFIX)
    const fieldPath = readsContract ? path.slice(CONTRACT_PREFIX.length) : path
    const fields = readsContract
        ? selected.descriptor.display.create?.fields
        : selected.op.fields
    const field = fields?.find((f) => f.path === fieldPath)
    if (!field) {
        throw new PathError(`no field '${fieldPath}'`)
    }
    const argument = readsContract ? selected.contract : selected.argument
    const resolved = resolveField(field, argument)
    if (isNone(resolved)) {
        throw new PathError(`'${path}' is None`)
    }
    return format(resolved, field, enums(selected))
}

function resolveField(field: Field, argument: Value | undefined): Value {
    if (!argument) {
        throw new PathError(`'${field.path}' has no value to start from`)
    }
    return resolvePath(argument, parsePath(field.path))
}

// A None is shown as `None` in a field: the value is absent, and the user should see that it is.
function format(resolved: Value, field: Field, enums: EnumTables): string {
    return isNone(resolved) ? 'None' : formatValue(resolved, field, enums)
}

function enums(selected: Selected): EnumTables {
    return selected.descriptor.metadata.enums ?? {}
}

function text(t: string): IntentPart {
    return { kind: 'text', text: t }
}
