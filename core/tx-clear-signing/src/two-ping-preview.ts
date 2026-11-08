// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    PreparedTransaction,
    type DamlTransaction_Node,
} from '@canton-network/core-ledger-proto'
import { decodePreparedTransaction } from '@canton-network/core-tx-visualizer'
import { builtinPingCreate } from './__tests__/fixtures/ping.js'

/**
 * A prepared transaction with two Ping creates. The participant refuses to prepare more than one
 * command, so this is built from a real single-Ping preparation and is only for display.
 */
export function twoPingPreviewTransaction(): string {
    const first = decodePreparedTransaction(builtinPingCreate)
    const second = decodePreparedTransaction(builtinPingCreate)
    const transaction = first.transaction
    const firstNode = transaction?.nodes[0]
    const secondNode = second.transaction?.nodes[0]
    if (!transaction || !firstNode || !secondNode) {
        throw new Error('ping fixture has no create node')
    }
    secondNode.nodeId = '1'
    suffixPingId(secondNode)
    transaction.roots = [firstNode.nodeId, secondNode.nodeId]
    transaction.nodes = [firstNode, secondNode]
    return toBase64(PreparedTransaction.toBinary(first))
}

function suffixPingId(node: DamlTransaction_Node): void {
    const versioned = node.versionedNode
    if (versioned.oneofKind !== 'v1') {
        throw new Error('ping fixture node is not v1')
    }
    const nodeType = versioned.v1.nodeType
    if (nodeType.oneofKind !== 'create') {
        throw new Error('ping fixture node is not a create')
    }
    const argument = nodeType.create.argument
    if (argument?.sum.oneofKind !== 'record') {
        throw new Error('ping fixture argument is not a record')
    }
    const id = argument.sum.record.fields.find((field) => field.label === 'id')
    if (id?.value?.sum.oneofKind !== 'text') {
        throw new Error('ping fixture has no text id')
    }
    id.value.sum.text = `${id.value.sum.text}-2`
}

function toBase64(data: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]!)
    }
    return btoa(binary)
}
