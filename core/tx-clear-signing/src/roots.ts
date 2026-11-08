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
export function decode(tx: string): PreparedTransaction {
    return decodePreparedTransaction(tx, { readUnknownField: 'throw' })
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
 * The create argument of the contract an exercise uses: an input contract, or one created by a node
 * of the same transaction. Its module and entity must be the exercise's. Its package may differ,
 * because an upgrade keeps the name and changes the package.
 *
 * @throws TransactionShapeError when the contract id occurs more than once, or names another template
 */
export function contractArgument(
    tx: PreparedTransaction,
    contractId: string,
    template: TemplateRef
): Value | undefined {
    const found: Create[] = []
    for (const input of tx.metadata?.inputContracts ?? []) {
        const contract = input.contract
        if (
            contract.oneofKind === 'v1' &&
            contract.v1.contractId === contractId
        ) {
            found.push(contract.v1)
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
            found.push(nodeType.create)
        }
    }
    if (found.length > 1) {
        throw new TransactionShapeError(
            `contract '${contractId}' occurs ${found.length} times`
        )
    }
    const create = found[0]
    if (!create) return undefined
    const id = create.templateId
    const name = `${id?.moduleName}:${id?.entityName}`
    const expected = `${template.moduleName}:${template.entityName}`
    if (!id || name !== expected) {
        throw new TransactionShapeError(
            `contract '${contractId}' is '${name}', not '${expected}'`
        )
    }
    return create.argument
}
