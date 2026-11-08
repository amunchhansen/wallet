// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { DescriptorError, parseDescriptor } from './descriptor.js'
import allocation from './descriptors/amulet-allocation-factory-v2.json'
import ping from './__tests__/descriptors/ping.json'
import transferOffer from './__tests__/descriptors/utility-transfer-offer.json'
import badExerciseKey from './__tests__/descriptors/invalid/bad-exercise-key.json'
import badPackageId from './__tests__/descriptors/invalid/bad-package-id.json'
import enumWithoutRef from './__tests__/descriptors/invalid/enum-without-ref.json'
import hashPath from './__tests__/descriptors/invalid/hash-path.json'
import missingPackageId from './__tests__/descriptors/invalid/missing-package-id.json'
import operationWithoutIntent from './__tests__/descriptors/invalid/operation-without-intent.json'
import paramsOnParty from './__tests__/descriptors/invalid/params-on-party.json'
import unknownFormat from './__tests__/descriptors/invalid/unknown-format.json'
import unknownTopLevelKey from './__tests__/descriptors/invalid/unknown-top-level-key.json'

describe('parseDescriptor', () => {
    it.each([
        ['ping', ping],
        ['utility-transfer-offer', transferOffer],
        ['amulet-allocation-factory-v2', allocation],
    ])('accepts %s', (_, json) => {
        expect(() => parseDescriptor(json)).not.toThrow()
    })

    it.each([
        ['bad-exercise-key', badExerciseKey, 'display.exercises'],
        ['bad-package-id', badPackageId, 'context.template.packageId'],
        ['enum-without-ref', enumWithoutRef, "format 'enum' requires params"],
        ['hash-path', hashPath, 'path'],
        ['missing-package-id', missingPackageId, 'context.template.packageId'],
        ['operation-without-intent', operationWithoutIntent, 'intent'],
        ['params-on-party', paramsOnParty, 'params'],
        ['unknown-format', unknownFormat, 'format'],
        ['unknown-top-level-key', unknownTopLevelKey, '<root>'],
    ])('rejects %s', (_, json, problem) => {
        expect(() => parseDescriptor(json)).toThrow(DescriptorError)
        expect(() => parseDescriptor(json)).toThrow(problem)
    })

    it('rejects an unsupported schema', () => {
        expect(() =>
            parseDescriptor({
                ...ping,
                $schema: 'https://example.org/other.json',
            })
        ).toThrow('unsupported schema')
        expect(() =>
            parseDescriptor({
                ...ping,
                $schema: '../canton-clear-signing-v1.schema.json',
            })
        ).toThrow('unsupported schema')
    })

    it.each([
        'HashVectors:Asset:Poke',
        '7ac0650ef4d386a42bcbc7fe129f41806daa04063ff0970a5a3cdd6f4f829e68:HashVectors:Asset:Poke',
    ])('rejects an exercise key that is not a choice name: %s', (key) => {
        expect(() =>
            parseDescriptor({
                ...ping,
                display: { exercises: { [key]: { intent: 'Poke' } } },
            })
        ).toThrow('display.exercises')
    })

    it('rejects a path that is not an argument, the contract, or a constant', () => {
        expect(() =>
            parseDescriptor({
                ...ping,
                display: {
                    create: {
                        intent: 'Ping',
                        fields: [{ path: '@.actAs' }],
                    },
                },
            })
        ).toThrow('path')
        expect(() =>
            parseDescriptor({
                ...ping,
                display: {
                    create: {
                        intent: 'Ping',
                        fields: [{ path: '$.context.template.packageId' }],
                    },
                },
            })
        ).toThrow('path')
    })

    it.each([
        ['is missing', {}],
        ['is null', { network: null }],
    ])('rejects a constant that %s', (_, constants) => {
        expect(() =>
            parseDescriptor({
                ...ping,
                metadata: { ...ping.metadata, constants },
                display: {
                    create: {
                        intent: 'Ping',
                        fields: [{ path: '$.metadata.constants.network' }],
                    },
                },
            })
        ).toThrow("no constant 'network'")
    })

    it.each([
        [
            'an undeclared placeholder',
            { create: { intent: 'Ping', interpolatedIntent: 'Ping {id}' } },
            "placeholder 'id' has no field with that path",
        ],
        [
            'a contract read in create',
            {
                create: {
                    intent: 'Ping',
                    interpolatedIntent: '{@.contract.id}',
                    fields: [{ path: 'id' }],
                },
            },
            'reads the contract outside an exercise',
        ],
        [
            'a contract field that creates does not declare',
            {
                create: { intent: 'Ping', fields: [{ path: 'id' }] },
                exercises: {
                    Respond: {
                        intent: 'Respond',
                        interpolatedIntent: '{@.contract.owner}',
                    },
                },
            },
            "has no field 'owner' in create",
        ],
        [
            'a contract field declared in an exercise',
            {
                exercises: {
                    Respond: {
                        intent: 'Respond',
                        fields: [{ path: '@.contract.id' }],
                    },
                },
            },
            'declare it in create',
        ],
        [
            'a missing enum',
            {
                create: {
                    intent: 'Ping',
                    fields: [
                        {
                            path: 'side',
                            format: 'enum',
                            params: { $ref: '$.metadata.enums.side' },
                        },
                    ],
                },
            },
            "missing enum '$.metadata.enums.side'",
        ],
        [
            'an unterminated placeholder',
            {
                create: {
                    intent: 'Ping',
                    interpolatedIntent: 'Ping {id',
                    fields: [{ path: 'id' }],
                },
            },
            'unterminated placeholder',
        ],
        [
            'an unmatched closing brace',
            {
                create: {
                    intent: 'Ping',
                    interpolatedIntent: 'Ping id}',
                    fields: [{ path: 'id' }],
                },
            },
            "unmatched '}'",
        ],
    ])('rejects %s', (_, display, problem) => {
        expect(() => parseDescriptor({ ...ping, display })).toThrow(problem)
    })

    it('treats doubled braces as literal text', () => {
        const display = {
            create: {
                intent: 'Ping',
                interpolatedIntent: '{{id}} is {id}',
                fields: [{ path: 'id' }],
            },
        }
        expect(() => parseDescriptor({ ...ping, display })).not.toThrow()
    })

    it('needs create or exercises', () => {
        expect(() => parseDescriptor({ ...ping, display: {} })).toThrow(
            'display needs create or exercises'
        )
    })
})
