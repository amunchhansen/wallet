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
 * The contracts the transaction's exercises can act on, by contract ID: its input contracts, and the
 * contracts its create nodes create. A root exercise acts on one of these; for example, a
 * create-and-exercise command creates a contract in one root and exercises it in the next.
 *
 * @throws TransactionShapeError when a contract ID occurs more than once
 */
export function contractsOf(tx: PreparedTransaction): Map<string, Create> {
    const inputs = (tx.metadata?.inputContracts ?? []).flatMap(({ contract }) =>
        contract.oneofKind === 'v1' ? [contract.v1] : []
    )
    const created = (tx.transaction?.nodes ?? []).flatMap(({ versionedNode }) =>
        versionedNode.oneofKind === 'v1' &&
        versionedNode.v1.nodeType.oneofKind === 'create'
            ? [versionedNode.v1.nodeType.create]
            : []
    )
    const contracts = new Map<string, Create>()
    for (const create of [...inputs, ...created]) {
        if (contracts.has(create.contractId)) {
            throw new TransactionShapeError(
                `contract '${create.contractId}' occurs more than once`
            )
        }
        contracts.set(create.contractId, create)
    }
    return contracts
}

/**
 * The create argument of the contract an exercise acts on. The contract must be of the exercised
 * template's package name, module and entity. Its package ID may differ, because an upgrade keeps the
 * package name and changes the package ID.
 *
 * @throws TransactionShapeError when the transaction has no such contract, or it names another template
 */
export function contractArgument(
    contracts: Map<string, Create>,
    exercise: Exercise
): Value | undefined {
    const create = contracts.get(exercise.contractId)
    if (!create) {
        throw new TransactionShapeError(
            `contract '${exercise.contractId}' is neither an input contract nor created by the transaction`
        )
    }
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
