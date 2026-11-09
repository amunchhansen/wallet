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
 * The create argument of the contract an exercise acts on: an input contract, or one created by a node
 * of the same transaction. It must be of the exercised template's package name, module and entity. Its
 * package ID may differ, because an upgrade keeps the package name and changes the package ID.
 *
 * @returns undefined when the transaction does not carry the contract
 * @throws TransactionShapeError when the contract ID occurs more than once, or names another template
 */
export function contractArgument(
    tx: PreparedTransaction,
    exercise: Exercise
): Value | undefined {
    const found: Create[] = []
    for (const input of tx.metadata?.inputContracts ?? []) {
        const contract = input.contract
        if (
            contract.oneofKind === 'v1' &&
            contract.v1.contractId === exercise.contractId
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
            nodeType.create.contractId === exercise.contractId
        ) {
            found.push(nodeType.create)
        }
    }
    if (found.length > 1) {
        throw new TransactionShapeError(
            `contract '${exercise.contractId}' occurs ${found.length} times`
        )
    }
    const create = found[0]
    if (!create) return undefined
    const actual = qualifiedName(create.packageName, create.templateId)
    const expected = qualifiedName(exercise.packageName, exercise.templateId)
    if (actual !== expected) {
        throw new TransactionShapeError(
            `contract '${exercise.contractId}' is '${actual}', not '${expected}'`
        )
    }
    return create.argument
}

function qualifiedName(
    packageName: string,
    id: Identifier | undefined
): string {
    return `${packageName}:${id?.moduleName}:${id?.entityName}`
}
