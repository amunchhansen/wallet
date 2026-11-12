// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    PreparedTransaction,
    type Identifier,
} from '@canton-network/core-ledger-proto'
import type { Descriptor } from '@canton-network/core-tx-clear-signing'
import { templateKeyOf } from './merge.js'

interface TemplateId {
    packageId: string
    moduleName: string
    entityName: string
}

/**
 * The candidates bound to the templates of the transaction's create and exercise roots, one per
 * template, in root order. A root template with no candidate is left out. A fetch or other root is
 * not selected: `clearSign` cannot describe it from a descriptor.
 *
 * The result is what `clearSign` takes. A candidate the transaction does not use is left out, so
 * passing the result does not throw `ExtraDescriptorsError`. Selection does not check the hash.
 *
 * @throws Error when two candidates bind the same template, a candidate names no template, or the
 * transaction cannot be read
 */
export function selectDescriptors(
    tx: string,
    candidates: readonly Descriptor[]
): Descriptor[] {
    const byTemplate = indexCandidates(candidates)
    const transaction = decode(tx).transaction
    if (!transaction) {
        throw new Error('prepared transaction has no transaction')
    }
    const selected: Descriptor[] = []
    const seen = new Set<string>()
    for (const nodeId of transaction.roots) {
        const template = templateOfRoot(transaction, nodeId)
        if (!template) continue
        const key = templateKey(template)
        if (seen.has(key)) continue
        seen.add(key)
        const descriptor = byTemplate.get(key)
        if (descriptor) selected.push(descriptor)
    }
    return selected
}

function indexCandidates(
    candidates: readonly Descriptor[]
): Map<string, Descriptor> {
    const byTemplate = new Map<string, Descriptor>()
    for (const descriptor of candidates) {
        const key = templateKeyOf(descriptor)
        if (byTemplate.has(key)) {
            throw new Error(`more than one descriptor for template '${key}'`)
        }
        byTemplate.set(key, descriptor)
    }
    return byTemplate
}

function decode(tx: string): PreparedTransaction {
    return PreparedTransaction.fromBinary(fromBase64(tx), {
        readUnknownField: 'throw',
    })
}

function templateOfRoot(
    transaction: NonNullable<PreparedTransaction['transaction']>,
    nodeId: string
): TemplateId | undefined {
    const versioned = transaction.nodes.find(
        (node) => node.nodeId === nodeId
    )?.versionedNode
    if (versioned?.oneofKind !== 'v1') return undefined
    const nodeType = versioned.v1.nodeType
    if (nodeType.oneofKind === 'create') {
        return requiredTemplate(nodeType.create.templateId, nodeId)
    }
    if (nodeType.oneofKind === 'exercise') {
        return requiredTemplate(nodeType.exercise.templateId, nodeId)
    }
    return undefined
}

function requiredTemplate(
    id: Identifier | undefined,
    nodeId: string
): TemplateId {
    if (!id) {
        throw new Error(`node '${nodeId}' has no template ID`)
    }
    return {
        packageId: id.packageId,
        moduleName: id.moduleName,
        entityName: id.entityName,
    }
}

function templateKey(template: TemplateId): string {
    return `${template.packageId}:${template.moduleName}:${template.entityName}`
}

/** Decodes standard base64. `atob` is available in Node and in the browser. */
function fromBase64(b64: string): Uint8Array {
    const binaryString = atob(b64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes
}
