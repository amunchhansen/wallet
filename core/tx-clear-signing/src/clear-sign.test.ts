// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
    Exercise,
    PreparedTransaction,
    type Value,
} from '@canton-network/core-ledger-proto'
import { decodePreparedTransaction } from '@canton-network/core-tx-visualizer'
import { clearSign } from './clear-sign.js'
import { parseDescriptor } from './descriptor.js'
import { TransactionShapeError } from './roots.js'
import {
    intentText,
    OTHER,
    OWNER,
    VECTOR_PACKAGE,
    vectorDescriptor,
} from './__tests__/helpers.js'
import pingJson from './__tests__/schema-examples/ping.json'
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
    version: '1.2.0',
}

function encode(tx: PreparedTransaction): string {
    const bytes = PreparedTransaction.toBinary(tx)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!)
    }
    return btoa(binary)
}

const NO_ARGUMENT: Value = {
    sum: { oneofKind: 'record', record: { fields: [] } },
}

// An exercise on the Ping that builtinPingCreate creates, with that Ping as input contract.
function exercisePing(
    choiceId = 'Respond',
    chosenValue = NO_ARGUMENT
): PreparedTransaction {
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
                                    choiceId,
                                    chosenValue,
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
                    // Values are kept apart from the descriptor's wording.
                    intent: [
                        { kind: 'text', text: 'Ping ' },
                        {
                            kind: 'value',
                            path: 'id',
                            value: PING_ID,
                            format: 'string',
                        },
                        { kind: 'text', text: ' from ' },
                        {
                            kind: 'value',
                            path: 'initiator',
                            value: ALICE,
                            format: 'party',
                        },
                        { kind: 'text', text: ' to ' },
                        {
                            kind: 'value',
                            path: 'responder',
                            value: ALICE,
                            format: 'party',
                        },
                    ],
                    fields: [
                        {
                            label: 'Ping ID',
                            path: 'id',
                            value: PING_ID,
                            format: 'string',
                        },
                        {
                            label: 'Initiator',
                            path: 'initiator',
                            value: ALICE,
                            format: 'party',
                        },
                        {
                            label: 'Responder',
                            path: 'responder',
                            value: ALICE,
                            format: 'party',
                        },
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
            intent: [
                { kind: 'text', text: 'Create Canton.Internal.Ping:Ping' },
            ],
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
        const [op] = clearSign(encode(exercisePing()), [ping]).operations
        expect(op).toMatchObject({
            kind: 'exercise',
            choiceId: 'Respond',
            descriptor: PING_DESCRIPTOR,
            status: 'described',
        })
        expect(intentText(op)).toBe(`Respond to ping ${PING_ID} from ${ALICE}`)
        expect(op).not.toHaveProperty('interface')
    })

    it('identifies an exercise without a descriptor', () => {
        const [op] = clearSign(encode(exercisePing()), []).operations
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
        const [op] = clearSign(encode(exercisePing()), [createsOnly]).operations
        expect(op).toMatchObject({
            status: 'undescribed',
            descriptor: PING_DESCRIPTOR,
        })
        expect(intentText(op)).toBe(
            'Exercise Respond on Canton.Internal.Ping:Ping'
        )
    })

    describe('a choice exercised through an interface', () => {
        const asset = {
            packageId: VECTOR_PACKAGE,
            moduleName: 'HashVectors',
            entityName: 'Asset',
        }
        const poke = (wording: string, iface?: typeof asset) => ({
            choice: 'Poke',
            ...(iface && { interface: iface }),
            intent: 'Poke',
            interpolatedIntent: `${wording} {@.contract.owner}`,
            fields: [{ path: '@.contract.owner', format: 'party' }],
        })
        const both = vectorDescriptor('Plain', {
            create: {
                intent: 'Plain',
                fields: [{ path: 'owner', format: 'party' }],
            },
            exercises: [
                poke('Poke, by the template, the asset of'),
                poke('Poke, through Asset, the asset of', asset),
            ],
        })

        it('prefers the entry for that interface', () => {
            const [op] = clearSign(exerciseInterface.preparedTransaction, [
                both,
            ]).operations
            expect(op).toMatchObject({
                choiceId: 'Poke',
                interface: asset,
                status: 'described',
            })
            expect(intentText(op)).toBe(
                `Poke, through Asset, the asset of ${OWNER}`
            )
        })

        it('uses the entry with no interface when none names the interface', () => {
            const plain = vectorDescriptor('Plain', {
                exercises: [poke('Poke, by the template, the asset of')],
            })
            const [op] = clearSign(exerciseInterface.preparedTransaction, [
                plain,
            ]).operations
            expect(intentText(op)).toBe(
                `Poke, by the template, the asset of ${OWNER}`
            )
        })

        it('does not use an entry for another choice', () => {
            const other = vectorDescriptor('Plain', {
                exercises: [
                    { choice: 'Other', intent: 'Other', interface: asset },
                ],
            })
            const [op] = clearSign(exerciseInterface.preparedTransaction, [
                other,
            ]).operations
            expect(op).toMatchObject({ status: 'undescribed' })
        })

        it('never applies an interface entry to a choice of the template itself', () => {
            const viaAsset = parseDescriptor({
                ...pingJson,
                display: {
                    exercises: pingJson.display.exercises.map((entry) =>
                        entry.choice === 'Respond'
                            ? {
                                  ...entry,
                                  interface: {
                                      ...pingJson.context.template,
                                      entityName: 'Asset',
                                  },
                              }
                            : entry
                    ),
                },
            })
            const [op] = clearSign(encode(exercisePing()), [
                viaAsset,
            ]).operations
            // Respond is not exercised through an interface, so the Asset entry does not apply.
            expect(op).toMatchObject({
                status: 'undescribed',
                descriptor: PING_DESCRIPTOR,
            })
        })
    })

    it('rejects a contract id that occurs twice', () => {
        const tx = exercisePing()
        const input = tx.metadata?.inputContracts[0]
        if (input?.contract.oneofKind !== 'v1') {
            throw new Error('fixture has no input contract')
        }
        tx.metadata?.inputContracts.push(input)
        expect(() => clearSign(encode(tx), [ping])).toThrow(
            /occurs more than once/
        )
    })

    it('rejects a contract whose template name differs from the exercise', () => {
        const tx = exercisePing()
        const input = tx.metadata?.inputContracts[0]?.contract
        if (input?.oneofKind !== 'v1' || !input.v1.templateId) {
            throw new Error('fixture has no input contract')
        }
        input.v1.templateId.entityName = 'Other'
        expect(() => clearSign(encode(tx), [ping])).toThrow(
            /is '.*:Canton\.Internal\.Ping:Other', not '.*:Canton\.Internal\.Ping:Ping'/
        )
    })

    it('rejects a contract whose package name differs from the exercise', () => {
        const tx = exercisePing()
        const input = tx.metadata?.inputContracts[0]?.contract
        if (input?.oneofKind !== 'v1') {
            throw new Error('fixture has no input contract')
        }
        input.v1.packageName = 'another-package'
        expect(() => clearSign(encode(tx), [ping])).toThrow(
            /is 'another-package:Canton\.Internal\.Ping:Ping'/
        )
    })

    it('fails a None field without cases, and falls back when its placeholder fails', () => {
        const none: Value = { sum: { oneofKind: 'optional', optional: {} } }
        const argument: Value = {
            sum: {
                oneofKind: 'record',
                record: { fields: [{ label: 'anyone', value: none }] },
            },
        }
        const result = clearSign(encode(exercisePing('AbortPing', argument)), [
            ping,
        ])
        expect(result.complete).toBe(false)
        expect(result.operations[0]).toMatchObject({
            status: 'fallback',
            intent: [{ kind: 'text', text: 'Abort ping' }],
            fields: [
                { path: '@.contract.id', value: PING_ID },
                { path: '@.contract.initiator', value: ALICE },
                { path: 'anyone', error: "'anyone' is None" },
            ],
        })
    })

    it('fails a field without cases that is not in the record', () => {
        const [op] = clearSign(encode(exercisePing('AbortPing')), [
            ping,
        ]).operations
        expect(op?.fields[2]).toMatchObject({
            path: 'anyone',
            error: "'anyone' is not in the transaction",
        })
    })

    it('allows a contract whose package ID differs from the exercise', () => {
        const tx = exercisePing()
        const input = tx.metadata?.inputContracts[0]?.contract
        if (input?.oneofKind !== 'v1' || !input.v1.templateId) {
            throw new Error('fixture has no input contract')
        }
        input.v1.templateId.packageId = '0'.repeat(64)
        expect(clearSign(encode(tx), [ping]).complete).toBe(true)
    })

    it('rejects an exercise on a contract that is not an input contract', () => {
        const tx = exercisePing()
        if (!tx.metadata) {
            throw new Error('fixture has no metadata')
        }
        tx.metadata.inputContracts = []
        expect(() => clearSign(encode(tx), [ping])).toThrow(
            TransactionShapeError
        )
        expect(() => clearSign(encode(tx), [ping])).toThrow(
            /is neither an input contract nor created by the transaction/
        )
    })

    it('reads a contract that an earlier root creates', () => {
        const plain = vectorDescriptor('Plain', {
            create: {
                intent: 'Create a plain contract',
                interpolatedIntent: 'Create a plain contract for {owner}',
                fields: [{ path: 'owner', format: 'party' }],
            },
            exercises: [
                {
                    choice: 'Check',
                    intent: 'Check',
                    interpolatedIntent:
                        'Check the contract of {@.contract.owner}',
                    fields: [{ path: '@.contract.owner', format: 'party' }],
                },
            ],
        })
        const result = clearSign(createAndExercise.preparedTransaction, [plain])
        expect(result.complete).toBe(true)
        expect(result.operations.map(intentText)).toEqual([
            `Create a plain contract for ${OWNER}`,
            `Check the contract of ${OWNER}`,
        ])
    })

    it('describes a create and an exercise of an undescribed template without reading the contract', () => {
        const plain = vectorDescriptor('Plain', {
            create: {
                intent: 'Create a plain contract',
                interpolatedIntent: 'Create a plain contract for {owner}',
                fields: [{ path: 'owner', format: 'party' }],
            },
        })
        const result = clearSign(createAndExercise.preparedTransaction, [plain])
        expect(result.operations.map((o) => o.status)).toEqual([
            'described',
            'undescribed',
        ])
        expect(intentText(result.operations[0]!)).toBe(
            `Create a plain contract for ${OWNER}`
        )
    })

    it('describes only the root of a nested transaction', () => {
        const driver = vectorDescriptor('Driver', {
            exercises: [
                {
                    choice: 'NestedCreates',
                    intent: 'Create nested contracts',
                    interpolatedIntent: 'Create contracts {depth} levels deep',
                    fields: [
                        { path: 'depth', label: 'Depth', format: 'number' },
                    ],
                },
            ],
        })
        const result = clearSign(nestedCreates.preparedTransaction, [driver])
        expect(result.operations).toHaveLength(1)
        expect(intentText(result.operations[0])).toBe(
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
                        { path: 'values.listValue', format: 'raw' },
                        { path: 'values.textMapValue', format: 'raw' },
                        { path: 'values.genMapValue', format: 'raw' },
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
            '["first","second"]',
            '{"alpha":"2","zeta":"1"}',
            '[["1","one"],["3","three"]]',
            'pair',
            '1.5000000000',
            'green',
            '{"name":"pair","count":"2"}',
            '()',
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
        expect(intentText(op)).toBe('alpha is 2 of 3 entries; inner is x')
        expect(op?.fields.map((f) => f.value ?? f.error)).toEqual([
            '2',
            '3',
            'x',
            "'length' applied to genMap",
            "no map entry 'missing'",
        ])
    })

    it('falls back to the stable intent when a placeholder fails', () => {
        const variants = vectorDescriptor('Variants', {
            create: {
                intent: 'Variants',
                interpolatedIntent:
                    '{colors.length} colors, the first is {colors.Red}',
                fields: [
                    { path: 'colors.length', format: 'number' },
                    { path: 'colors.Red', format: 'string' },
                    { path: 'colors', format: 'raw' },
                ],
            },
        })

        const result = clearSign(variantEnum.preparedTransaction, [variants])
        expect(result.complete).toBe(false)
        expect(result.operations[0]).toMatchObject({
            status: 'fallback',
            intent: [{ kind: 'text', text: 'Variants' }],
            fields: [
                { path: 'colors.length', value: '2' },
                { path: 'colors.Red', error: "'Red' applied to list" },
                // A list of variable size is shown whole, with raw.
                { path: 'colors', value: '["Red","Blue"]' },
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

    it('rejects two entries for one choice and interface', () => {
        expect(() =>
            vectorDescriptor('Plain', {
                exercises: [
                    { choice: 'Poke', intent: 'Poke' },
                    { choice: 'Poke', intent: 'Poke again' },
                ],
            })
        ).toThrow('the same choice and interface is already described')
    })
})

describe('cases', () => {
    const describeAllKinds = (
        fields: unknown[],
        interpolatedIntent?: string
    ) => {
        const descriptor = vectorDescriptor('AllKinds', {
            create: { intent: 'All kinds', interpolatedIntent, fields },
        })
        return clearSign(allValues.preparedTransaction, [descriptor])
    }

    it('shows the matched case label and its fields, resolved against the payload', () => {
        const result = describeAllKinds(
            [
                {
                    path: 'values',
                    label: 'Values',
                    cases: { Some: { label: 'unused' } },
                },
                {
                    path: 'values.variantValue',
                    label: 'Shape',
                    cases: {
                        Circle: { label: 'a circle' },
                        Square: { label: 'a square' },
                    },
                },
                {
                    path: 'values.optionalValue',
                    label: 'Optional',
                    cases: {
                        Some: {
                            label: 'set',
                            fields: [{ path: 'x', label: 'Inner' }],
                        },
                    },
                },
            ],
            'It is {values.variantValue}'
        )
        const [op] = result.operations
        expect(intentText(op)).toBe('It is a circle')
        expect(op?.fields).toEqual([
            {
                label: 'Values',
                path: 'values',
                error: 'cases applied to record',
            },
            {
                label: 'Shape',
                path: 'values.variantValue',
                value: 'a circle',
                case: 'Circle',
            },
            {
                label: 'Optional',
                path: 'values.optionalValue',
                value: 'set',
                case: 'Some',
                fields: [
                    {
                        label: 'Inner',
                        path: 'x',
                        error: "'x' applied to int64",
                    },
                ],
            },
        ])
        // An error in a matched case's field makes the transaction incomplete
        expect(result.complete).toBe(false)
    })

    it('shows an optional through cases: a Some without a label as its value, and a missing field as None', () => {
        const result = describeAllKinds(
            [
                {
                    path: 'values.optionalValue',
                    label: 'Optional',
                    format: 'number',
                    cases: { None: { label: 'not set' } },
                },
                {
                    path: 'values.missingValue',
                    label: 'Missing',
                    cases: { None: { label: 'not set' } },
                },
            ],
            'Missing is {values.missingValue}'
        )
        const [op] = result.operations
        expect(op?.fields).toEqual([
            {
                label: 'Optional',
                path: 'values.optionalValue',
                value: '7',
                case: 'Some',
                format: 'number',
            },
            {
                label: 'Missing',
                path: 'values.missingValue',
                value: 'not set',
                case: 'None',
                absent: true,
            },
        ])
        expect(intentText(op)).toBe('Missing is not set')
        expect(result.complete).toBe(true)
    })

    it('uses the format for a Some without a label, including in the sentence', () => {
        const result = describeAllKinds(
            [
                {
                    path: 'values.optionalValue',
                    format: 'number',
                    cases: { None: { label: 'not set' } },
                },
            ],
            'It is {values.optionalValue}'
        )
        const [op] = result.operations
        expect(op?.status).toBe('described')
        expect(intentText(op)).toBe('It is 7')
    })

    it('fails a Some whose format does not accept the value', () => {
        const result = describeAllKinds([
            {
                path: 'values.optionalValue',
                format: 'string',
                cases: { None: { label: 'not set' } },
            },
        ])
        expect(result.operations[0]?.fields[0]?.error).toBe(
            "format 'string' does not accept int64"
        )
        expect(result.complete).toBe(false)
    })

    it('falls back when a placeholder names an unlabelled None', () => {
        const result = describeAllKinds(
            [
                {
                    path: 'values.missingValue',
                    cases: { Some: { label: 'set' } },
                },
            ],
            'Missing is {values.missingValue}'
        )
        expect(result.operations[0]?.status).toBe('fallback')
        expect(result.operations[0]?.fields[0]).toMatchObject({
            value: 'None',
            case: 'None',
            absent: true,
        })
    })

    it('shows the case name when no case matches, and keeps it out of the sentence', () => {
        const result = describeAllKinds(
            [
                {
                    path: 'values.variantValue',
                    label: 'Shape',
                    cases: { Square: { label: 'a square' } },
                },
            ],
            'It is {values.variantValue}'
        )
        const [op] = result.operations
        expect(op?.status).toBe('fallback')
        expect(op?.fields[0]).toMatchObject({ value: 'Circle', case: 'Circle' })
        expect(result.complete).toBe(false)
    })
})
