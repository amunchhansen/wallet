// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
    Exercise,
    PreparedTransaction,
} from '@canton-network/core-ledger-proto'
import { decodePreparedTransaction } from '@canton-network/core-tx-visualizer'
import { clearSign } from './clear-sign.js'
import { parseDescriptor } from './descriptor.js'
import { TransactionShapeError } from './roots.js'
import {
    OTHER,
    OWNER,
    VECTOR_PACKAGE,
    vectorDescriptor,
} from './__tests__/helpers.js'
import pingJson from './__tests__/descriptors/ping.json'
import {
    adminWorkflowsPingCreate,
    builtinPingCreate,
} from './__tests__/fixtures/ping.js'
import allValues from './__tests__/fixtures/v2-create-all-values.json'
import createAndExercise from './__tests__/fixtures/v2-create-and-exercise.json'
import exerciseInterface from './__tests__/fixtures/v2-exercise-interface.json'
import nestedCreates from './__tests__/fixtures/v2-exercise-nested-creates.json'
import maps from './__tests__/fixtures/v2-maps.json'
import variantEnum from './__tests__/fixtures/v2-variant-enum.json'

const ping = parseDescriptor(pingJson)
const ALICE =
    'v1-01-alice::1220ee2624190834dddf28f194685acee8f00cbde9ee0d211dae277f4d799884f289'
const PING_ID = '04d887dd-15b8-4954-8b79-a853811ce7cf'
const PING_DESCRIPTOR = {
    name: 'Canton ping',
    publisher: '<canton publisher>',
    version: '1.0.0',
}

function encode(tx: PreparedTransaction): string {
    const bytes = PreparedTransaction.toBinary(tx)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!)
    }
    return btoa(binary)
}

// A Respond exercise on the Ping that builtinPingCreate creates, with that Ping as input contract.
function respondToPing(): PreparedTransaction {
    const created = decodePreparedTransaction(builtinPingCreate)
    const node = created.transaction?.nodes[0]?.versionedNode
    const nodeType = node?.oneofKind === 'v1' ? node.v1.nodeType : undefined
    if (nodeType?.oneofKind !== 'create') {
        throw new Error('fixture is not a create')
    }
    const create = nodeType.create
    const templateId = create.templateId
    if (!templateId) {
        throw new Error('fixture has no template ID')
    }
    return PreparedTransaction.create({
        transaction: {
            version: '2.1',
            roots: ['0'],
            nodes: [
                {
                    nodeId: '0',
                    versionedNode: {
                        oneofKind: 'v1',
                        v1: {
                            nodeType: {
                                oneofKind: 'exercise',
                                exercise: Exercise.create({
                                    contractId: create.contractId,
                                    packageName: create.packageName,
                                    templateId,
                                    choiceId: 'Respond',
                                    chosenValue: {
                                        sum: {
                                            oneofKind: 'record',
                                            record: { fields: [] },
                                        },
                                    },
                                    consuming: true,
                                }),
                            },
                        },
                    },
                },
            ],
        },
        metadata: {
            inputContracts: [{ contract: { oneofKind: 'v1', v1: create } }],
        },
    })
}

describe('clearSign', () => {
    it('rejects a transaction without a transaction tree', () => {
        expect(() =>
            clearSign(encode(PreparedTransaction.create()), [])
        ).toThrow(TransactionShapeError)
    })

    it('describes a Ping create', () => {
        const result = clearSign(builtinPingCreate, [ping])
        expect(result).toEqual({
            complete: true,
            operations: [
                {
                    nodeId: '0',
                    kind: 'create',
                    template: ping.context.template,
                    descriptor: PING_DESCRIPTOR,
                    status: 'described',
                    intent: `Ping ${PING_ID} from ${ALICE} to ${ALICE}`,
                    fields: [
                        { label: 'Ping ID', path: 'id', value: PING_ID },
                        { label: 'Initiator', path: 'initiator', value: ALICE },
                        { label: 'Responder', path: 'responder', value: ALICE },
                    ],
                },
            ],
        })
    })

    it('binds a descriptor to the exact package', () => {
        // Same module and entity, different package: the descriptor does not apply.
        const result = clearSign(adminWorkflowsPingCreate, [ping])
        expect(result.complete).toBe(false)
        expect(result.operations[0]).toMatchObject({
            status: 'undescribed',
            intent: 'Create Canton.Internal.Ping:Ping',
            fields: [],
        })
        expect(result.operations[0]).not.toHaveProperty('descriptor')
    })

    it('identifies a create without a descriptor', () => {
        const [op] = clearSign(builtinPingCreate, []).operations
        expect(op).toMatchObject({ kind: 'create', status: 'undescribed' })
        expect(op).not.toHaveProperty('descriptor')
        expect(op).not.toHaveProperty('choiceId')
        expect(op).not.toHaveProperty('interface')
    })

    it('reads the exercised contract through @.contract', () => {
        const [op] = clearSign(encode(respondToPing()), [ping]).operations
        expect(op).toMatchObject({
            kind: 'exercise',
            choiceId: 'Respond',
            descriptor: PING_DESCRIPTOR,
            status: 'described',
            intent: `Respond to ping ${PING_ID} from ${ALICE}`,
        })
        expect(op).not.toHaveProperty('interface')
    })

    it('identifies an exercise without a descriptor', () => {
        const [op] = clearSign(encode(respondToPing()), []).operations
        expect(op).toMatchObject({
            kind: 'exercise',
            choiceId: 'Respond',
            status: 'undescribed',
        })
        expect(op).not.toHaveProperty('descriptor')
    })

    it('reports an exercise without an operation as undescribed', () => {
        const createsOnly = parseDescriptor({
            ...pingJson,
            display: { create: pingJson.display.create },
        })
        const [op] = clearSign(encode(respondToPing()), [
            createsOnly,
        ]).operations
        expect(op).toMatchObject({
            status: 'undescribed',
            intent: 'Exercise Respond on Canton.Internal.Ping:Ping',
            descriptor: PING_DESCRIPTOR,
        })
    })

    it('describes an interface choice by the template and the choice name', () => {
        const poke = {
            intent: 'Poke',
            interpolatedIntent: 'Poke the asset of {@.contract.owner}',
        }
        const [op] = clearSign(exerciseInterface.preparedTransaction, [
            vectorDescriptor('Plain', {
                create: {
                    intent: 'Plain',
                    fields: [{ path: 'owner', format: 'party' }],
                },
                exercises: { Poke: poke },
            }),
        ]).operations
        expect(op).toMatchObject({
            choiceId: 'Poke',
            interface: {
                packageId: VECTOR_PACKAGE,
                moduleName: 'HashVectors',
                entityName: 'Asset',
            },
            status: 'described',
            intent: `Poke the asset of ${OWNER}`,
        })
    })

    it('rejects a contract id that occurs twice', () => {
        const tx = respondToPing()
        const input = tx.metadata?.inputContracts[0]?.contract
        const nodes = tx.transaction?.nodes
        if (input?.oneofKind !== 'v1' || !nodes) {
            throw new Error('fixture has no input contract')
        }
        nodes.push({
            nodeId: '1',
            versionedNode: {
                oneofKind: 'v1',
                v1: {
                    nodeType: { oneofKind: 'create', create: input.v1 },
                },
            },
        })
        expect(() => clearSign(encode(tx), [ping])).toThrow(/occurs 2 times/)
    })

    it('rejects a contract whose template name differs from the exercise', () => {
        const tx = respondToPing()
        const input = tx.metadata?.inputContracts[0]?.contract
        if (input?.oneofKind !== 'v1' || !input.v1.templateId) {
            throw new Error('fixture has no input contract')
        }
        input.v1.templateId.entityName = 'Other'
        expect(() => clearSign(encode(tx), [ping])).toThrow(
            "is 'Canton.Internal.Ping:Other', not 'Canton.Internal.Ping:Ping'"
        )
    })

    it('allows a contract whose package differs from the exercise', () => {
        const tx = respondToPing()
        const input = tx.metadata?.inputContracts[0]?.contract
        if (input?.oneofKind !== 'v1' || !input.v1.templateId) {
            throw new Error('fixture has no input contract')
        }
        input.v1.templateId.packageId = '0'.repeat(64)
        expect(clearSign(encode(tx), [ping]).complete).toBe(true)
    })

    it('describes every root, finding a contract created in the same transaction', () => {
        const plain = vectorDescriptor('Plain', {
            create: {
                intent: 'Create a plain contract',
                interpolatedIntent: 'Create a plain contract for {owner}',
                fields: [{ path: 'owner', format: 'party' }],
            },
            exercises: {
                Check: {
                    intent: 'Check',
                    interpolatedIntent:
                        'Check the contract of {@.contract.owner}',
                },
            },
        })
        const result = clearSign(createAndExercise.preparedTransaction, [plain])
        expect(result.complete).toBe(true)
        expect(result.operations.map((op) => op.intent)).toEqual([
            `Create a plain contract for ${OWNER}`,
            `Check the contract of ${OWNER}`,
        ])
    })

    it('describes only the root of a nested transaction', () => {
        const driver = vectorDescriptor('Driver', {
            exercises: {
                NestedCreates: {
                    intent: 'Create nested contracts',
                    interpolatedIntent: 'Create contracts {depth} levels deep',
                    fields: [
                        { path: 'depth', label: 'Depth', format: 'number' },
                    ],
                },
            },
        })
        const result = clearSign(nestedCreates.preparedTransaction, [driver])
        expect(result.operations).toHaveLength(1)
        expect(result.operations[0]?.intent).toBe(
            'Create contracts 3 levels deep'
        )
    })

    it('formats every kind of value', () => {
        const allKinds = vectorDescriptor(
            'AllKinds',
            {
                create: {
                    intent: 'All kinds',
                    fields: [
                        { path: 'values.boolValue', format: 'boolean' },
                        { path: 'values.int64Value', format: 'number' },
                        { path: 'values.numericValue', format: 'number' },
                        { path: 'values.textValue', format: 'string' },
                        { path: 'values.timestampValue', format: 'dateTime' },
                        { path: 'values.dateValue', format: 'dateTime' },
                        { path: 'values.partyValue', format: 'party' },
                        {
                            path: 'values.contractIdValue',
                            format: 'contractId',
                        },
                        { path: 'values.optionalValue', format: 'number' },
                        { path: 'values.listValue.[]', format: 'string' },
                        { path: 'values.textMapValue.[]', format: 'number' },
                        { path: 'values.genMapValue.[]', format: 'string' },
                        { path: 'values.recordValue.name', format: 'string' },
                        {
                            path: 'values.variantValue.Circle',
                            format: 'number',
                        },
                        {
                            path: 'values.enumValue',
                            format: 'enum',
                            params: { $ref: '$.metadata.enums.color' },
                        },
                        { path: 'values.recordValue' },
                        { path: 'values.unitValue', format: 'raw' },
                        {
                            path: '$.metadata.constants.network',
                            format: 'string',
                        },
                    ],
                },
            },
            { color: { Red: 'red', Green: 'green', Blue: 'blue' } }
        )

        const [op] = clearSign(allValues.preparedTransaction, [
            allKinds,
        ]).operations
        expect(op?.fields.map((f) => f.value ?? f.error)).toEqual([
            'true',
            '-42',
            '3.1415926535',
            'héllo, мир',
            '2026-10-24T12:34:56.789012Z',
            '2026-10-24',
            OTHER,
            '003cbb94a4b2470b97999dd6ecbef7cebd5045a57cf6fc1d24e9e1cee1adbcd090ca1212207aa8738571d5ee56e9760a18077666bc7f97e559e8c80722ecf9af3c4977899e',
            '7',
            ['first', 'second'],
            ['2', '1'],
            ['one', 'three'],
            'pair',
            '1.5000000000',
            'green',
            '{"name":"pair","count":"2"}',
            '()',
            'localnet',
        ])
    })

    it('reads maps by key and counts their elements', () => {
        const mapsDescriptor = vectorDescriptor('Maps', {
            create: {
                intent: 'Maps',
                interpolatedIntent:
                    'alpha is {textMap["alpha"]} of {textMap.length} entries; inner is {nestedMap["outer"]["inner"]}',
                fields: [
                    { path: 'textMap["alpha"]', format: 'number' },
                    { path: 'textMap.length', format: 'number' },
                    { path: 'nestedMap["outer"]["inner"]', format: 'string' },
                    { path: 'genMap.length', format: 'number' },
                    { path: 'textMap["missing"]', format: 'number' },
                ],
            },
        })
        const [op] = clearSign(maps.preparedTransaction, [
            mapsDescriptor,
        ]).operations
        expect(op?.intent).toBe('alpha is 2 of 3 entries; inner is x')
        expect(op?.fields.map((f) => f.value ?? f.error)).toEqual([
            '2',
            '3',
            'x',
            '3',
            "no map entry 'missing'",
        ])
    })

    it('falls back to the stable intent when a placeholder fails', () => {
        const variants = vectorDescriptor(
            'Variants',
            {
                create: {
                    intent: 'Variants',
                    interpolatedIntent:
                        'Colors {colors.[]}, dogs {animals.[].Dog.name}',
                    fields: [
                        {
                            path: 'colors.[]',
                            format: 'enum',
                            params: { $ref: '$.metadata.enums.color' },
                        },
                        { path: 'animals.[].Dog.name', format: 'string' },
                    ],
                },
            },
            { color: { Red: 'red', Blue: 'blue' } }
        )

        const result = clearSign(variantEnum.preparedTransaction, [variants])
        expect(result.complete).toBe(false)
        expect(result.operations[0]).toMatchObject({
            status: 'fallback',
            intent: 'Variants',
            fields: [
                { path: 'colors.[]', value: ['red', 'blue'] },
                {
                    path: 'animals.[].Dog.name',
                    error: "variant is 'Cat', not 'Dog'",
                },
            ],
        })
    })

    it('fails a field whose format does not match the value', () => {
        const wrongFormat = vectorDescriptor('Plain', {
            create: {
                intent: 'Plain',
                fields: [{ path: 'owner', format: 'string' }],
            },
        })
        const [op] = clearSign(createAndExercise.preparedTransaction, [
            wrongFormat,
        ]).operations
        expect(op?.fields[0]?.error).toBe(
            "format 'string' does not accept party"
        )
    })

    it('rejects two descriptors for one template', () => {
        expect(() => clearSign(builtinPingCreate, [ping, ping])).toThrow(
            'more than one descriptor'
        )
    })
})
