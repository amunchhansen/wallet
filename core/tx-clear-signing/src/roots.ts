// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type {
    Create,
    Exercise,
    Identifier,
    PreparedTransaction,
    Value,
} from '@canton-network/core-ledger-proto'
import { decodePreparedTransaction } from '@canton-network/core-tx-visualizer'

/** The identity of a Daml template, which a descriptor binds to exactly. */
export interface TemplateRef {
    packageId: string
    moduleName: string
    entityName: string
}

export type RootNode =
    | { nodeId: string; kind: 'create'; create: Create }
    | { nodeId: string; kind: 'exercise'; exercise: Exercise }

export class TransactionShapeError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'TransactionShapeError'
    }
}

// Unknown fields could carry content the user is never shown, so decoding refuses them.
export function decode(tx: string | PreparedTransaction): PreparedTransaction {
    return typeof tx === 'string'
        ? decodePreparedTransaction(tx, { readUnknownField: 'throw' })
        : tx
}

/**
 * The root nodes of the transaction, in order. Each is a create or an exercise, since a submission's
 * commands produce only those.
 *
 * @throws TransactionShapeError when a root is missing or of another kind
 */
export function rootNodes(tx: PreparedTransaction): RootNode[] {
    const transaction = tx.transaction
    if (!transaction) {
        throw new TransactionShapeError(
            'prepared transaction has no transaction'
        )
    }
    return transaction.roots.map((nodeId): RootNode => {
        const versioned = transaction.nodes.find(
            (n) => n.nodeId === nodeId
        )?.versionedNode
        if (versioned?.oneofKind !== 'v1') {
            throw new TransactionShapeError(`root node '${nodeId}' is missing`)
        }
        const nodeType = versioned.v1.nodeType
        switch (nodeType.oneofKind) {
            case 'create':
                return { nodeId, kind: 'create', create: nodeType.create }
            case 'exercise':
                return { nodeId, kind: 'exercise', exercise: nodeType.exercise }
            default:
                throw new TransactionShapeError(
                    `root node '${nodeId}' is a '${nodeType.oneofKind ?? 'empty'}' node`
                )
        }
    })
}

export function rootTemplate(node: RootNode): TemplateRef {
    const id =
        node.kind === 'create'
            ? node.create.templateId
            : node.exercise.templateId
    return templateRef(id, node.nodeId)
}

export function templateRef(
    id: Identifier | undefined,
    nodeId: string
): TemplateRef {
    if (!id) {
        throw new TransactionShapeError(`node '${nodeId}' has no template ID`)
    }
    return {
        packageId: id.packageId,
        moduleName: id.moduleName,
        entityName: id.entityName,
    }
}

export function templateKey(t: TemplateRef): string {
    return `${t.packageId}:${t.moduleName}:${t.entityName}`
}

/**
 * Which templates need a descriptor to describe the transaction: the template of each root node,
 * de-duplicated, in root order.
 */
export function requiredTemplates(
    tx: string | PreparedTransaction
): TemplateRef[] {
    const byKey = new Map<string, TemplateRef>()
    for (const node of rootNodes(decode(tx))) {
        const ref = rootTemplate(node)
        byKey.set(templateKey(ref), ref)
    }
    return [...byKey.values()]
}

/**
 * The create argument of a contract the transaction uses: an input contract, or one created by a
 * node of the same transaction.
 */
export function contractArgument(
    tx: PreparedTransaction,
    contractId: string
): Value | undefined {
    for (const input of tx.metadata?.inputContracts ?? []) {
        const contract = input.contract
        if (
            contract.oneofKind === 'v1' &&
            contract.v1.contractId === contractId
        ) {
            return contract.v1.argument
        }
    }
    for (const node of tx.transaction?.nodes ?? []) {
        const versioned = node.versionedNode
        if (versioned.oneofKind !== 'v1') continue
        const nodeType = versioned.v1.nodeType
        if (
            nodeType.oneofKind === 'create' &&
            nodeType.create.contractId === contractId
        ) {
            return nodeType.create.argument
        }
    }
    return undefined
}
