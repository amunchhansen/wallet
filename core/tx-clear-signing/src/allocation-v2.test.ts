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

const V1_INTERFACE = {
    packageId: '#splice-api-token-allocation-instruction-v1',
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
const record = (fields: { label: string; value: Value }[]): Value =>
    Value.create({ sum: { oneofKind: 'record', record: { fields } } })

// V1 AllocationFactory_Allocate takes expectedAdmin and one transferLeg. The same
// template also implements the V2 choice of the same name, whose argument has
// transferLegSides. Lookup ignores the interface, so this call still matches.
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
                        {
                            label: 'settleBefore',
                            value: timestamp('1900000000000000'),
                        },
                    ]),
                },
                { label: 'transferLegId', value: text('leg-1') },
                {
                    label: 'transferLeg',
                    value: record([
                        { label: 'sender', value: party('alice::1') },
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
        expect(op?.intent).toContain('of 2 transfer legs')
        expect(field(op, 'allocation.transferLegSides.[].side')).toEqual([
            'send to',
            'receive from',
        ])
        expect(field(op, 'allocation.transferLegSides.[].amount')).toEqual([
            '0.3000000000',
            '0.1000000000',
        ])
        expect(
            field(op, 'allocation.transferLegSides.[].transferLegId')
        ).toEqual(['leg-1', 'leg-2'])
    })

    it('falls back for a V1 AllocationFactory_Allocate on the same template', () => {
        const result = clearSign(v1Allocate(), shippedDescriptors())
        const op = result.operations[0]

        expect(result.complete).toBe(false)
        expect(op).toMatchObject({
            choiceId: 'AllocationFactory_Allocate',
            status: 'fallback',
            intent: 'Allocate funds for a settlement',
            interface: V1_INTERFACE,
        })
    })
})
