// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
    PreparedTransaction,
    Value,
    type Exercise,
} from '@canton-network/core-ledger-proto'
import { decodePreparedTransaction } from '@canton-network/core-tx-visualizer'
import { allocationV2Multileg } from './__tests__/fixtures/allocation-v2-multileg.js'
import { clearSign, type OperationDescription } from './clear-sign.js'
import { shippedDescriptors } from './shipped.js'
import { intentText } from './__tests__/helpers.js'

const V1_INTERFACE = {
    packageId:
        '275064aacfe99cea72ee0c80563936129563776f67415ef9f13e4297eecbc520',
    moduleName: 'Splice.Api.Token.AllocationInstructionV1',
    entityName: 'AllocationFactory',
}

function encode(tx: PreparedTransaction): string {
    const bytes = PreparedTransaction.toBinary(tx)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!)
    }
    return btoa(binary)
}

const text = (value: string): Value =>
    Value.create({ sum: { oneofKind: 'text', text: value } })
const party = (value: string): Value =>
    Value.create({ sum: { oneofKind: 'party', party: value } })
const timestamp = (micros: string): Value =>
    Value.create({ sum: { oneofKind: 'timestamp', timestamp: micros } })
const numeric = (value: string): Value =>
    Value.create({ sum: { oneofKind: 'numeric', numeric: value } })
const record = (fields: { label: string; value: Value }[]): Value =>
    Value.create({ sum: { oneofKind: 'record', record: { fields } } })
const noMeta = record([
    {
        label: 'values',
        value: Value.create({
            sum: { oneofKind: 'textMap', textMap: { entries: [] } },
        }),
    },
])

// V1 AllocationFactory_Allocate takes expectedAdmin and one transferLeg. The same
// template also implements the V2 choice of the same name, whose argument has
// transferLegSides; each is described by the descriptor bound to its interface.
function v1Allocate(): string {
    const tx = decodePreparedTransaction(allocationV2Multileg)
    const exercise = rootExercise(tx)
    const iface = exercise.interfaceId
    if (!iface) {
        throw new Error('capture exercise has no interface')
    }
    iface.packageId = V1_INTERFACE.packageId
    iface.moduleName = V1_INTERFACE.moduleName
    iface.entityName = V1_INTERFACE.entityName
    exercise.chosenValue = record([
        { label: 'expectedAdmin', value: party('DSO::1220d8a7') },
        {
            label: 'allocation',
            value: record([
                {
                    label: 'settlement',
                    value: record([
                        { label: 'executor', value: party('venue::1') },
                        {
                            label: 'settlementRef',
                            value: record([
                                { label: 'id', value: text('trade-1') },
                            ]),
                        },
                        {
                            label: 'requestedAt',
                            value: timestamp('1700000000000000'),
                        },
                        {
                            label: 'allocateBefore',
                            value: timestamp('1800000000000000'),
                        },
                        {
                            label: 'settleBefore',
                            value: timestamp('1900000000000000'),
                        },
                        { label: 'meta', value: noMeta },
                    ]),
                },
                { label: 'transferLegId', value: text('leg-1') },
                {
                    label: 'transferLeg',
                    value: record([
                        { label: 'sender', value: party('alice::1') },
                        { label: 'receiver', value: party('bob::1') },
                        { label: 'amount', value: numeric('5.0000000000') },
                        {
                            label: 'instrumentId',
                            value: record([
                                {
                                    label: 'admin',
                                    value: party('DSO::1220d8a7'),
                                },
                                { label: 'id', value: text('Amulet') },
                            ]),
                        },
                        { label: 'meta', value: noMeta },
                    ]),
                },
            ]),
        },
        { label: 'requestedAt', value: timestamp('1700000000000000') },
        {
            label: 'inputHoldingCids',
            value: Value.create({
                sum: { oneofKind: 'list', list: { elements: [] } },
            }),
        },
        { label: 'extraArgs', value: record([]) },
    ])
    return encode(tx)
}

function rootExercise(tx: PreparedTransaction): Exercise {
    const rootId = tx.transaction?.roots[0]
    const node = tx.transaction?.nodes.find((n) => n.nodeId === rootId)
    const versioned = node?.versionedNode
    const nodeType =
        versioned?.oneofKind === 'v1' ? versioned.v1.nodeType : undefined
    if (nodeType?.oneofKind !== 'exercise') {
        throw new Error('capture root is not an exercise')
    }
    return nodeType.exercise
}

function field(op: OperationDescription | undefined, path: string) {
    return op?.fields.find((f) => f.path === path)?.value
}

describe('AllocationFactory_Allocate', () => {
    it('describes the two-leg capture', () => {
        const result = clearSign(allocationV2Multileg, shippedDescriptors())
        const op = result.operations[0]

        expect(result.complete).toBe(true)
        expect(result.operations).toHaveLength(1)
        expect(op).toMatchObject({
            kind: 'exercise',
            choiceId: 'AllocationFactory_Allocate',
            status: 'described',
            interface: {
                packageId:
                    '9818a0b5b827109de03a04c8f6151cde9d1e7fe5123dbb2dfeb0e52d7271287c',
                moduleName: 'Splice.Api.Token.AllocationInstructionV2',
                entityName: 'AllocationFactory',
            },
        })
        expect(intentText(op)).toContain('of 2 transfer legs')
        const legs = field(op, 'allocation.transferLegSides')
        expect(legs).toEqual(expect.any(String))
        expect(JSON.parse(legs as string)).toMatchObject([
            {
                transferLegId: 'leg-1',
                side: 'SenderSide',
                amount: '0.3000000000',
                instrumentId: 'Amulet',
                otherside: {
                    owner: 'bd::1220cb1468d149d30ad6f674acb2f6769dd2a6e6e1b90346fd4905fed66f37b2de56',
                },
            },
            {
                transferLegId: 'leg-2',
                side: 'ReceiverSide',
                amount: '0.1000000000',
                instrumentId: 'Amulet',
                otherside: {
                    owner: 'bd::1220cb1468d149d30ad6f674acb2f6769dd2a6e6e1b90346fd4905fed66f37b2de56',
                },
            },
        ])
    })

    it('describes a V1 AllocationFactory_Allocate on the same template with the V1 entry', () => {
        const result = clearSign(v1Allocate(), shippedDescriptors())
        const op = result.operations[0]

        expect(result.complete).toBe(true)
        expect(op).toMatchObject({
            choiceId: 'AllocationFactory_Allocate',
            status: 'described',
            interface: V1_INTERFACE,
            descriptor: { name: 'Amulet rules for external parties' },
        })
        expect(intentText(op)).toBe(
            'Allocate 5.0000000000 Amulet from alice::1 to bob::1 for settlement trade-1, executed by venue::1'
        )
    })
})
