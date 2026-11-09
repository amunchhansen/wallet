// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { DescriptorError, parseDescriptor } from './descriptor.js'
import ping from './__tests__/schema-examples/ping.json'

// The examples of canton-clear-signing-v1.schema.json, copied unchanged from
// mpa/documentation/clearsigning/examples. The parser must agree with the schema on every one.
// No type argument: see core/tx-hashing/src/__tests__/helpers/load-vectors.ts.
const valid = import.meta.glob('./__tests__/schema-examples/*.json', {
    eager: true,
    import: 'default',
}) as Record<string, unknown>
const invalid = import.meta.glob('./__tests__/schema-examples/invalid/*.json', {
    eager: true,
    import: 'default',
}) as Record<string, unknown>

describe('parseDescriptor', () => {
    it('has the schema examples', () => {
        expect(Object.keys(valid).length).toBeGreaterThan(0)
        expect(Object.keys(invalid).length).toBeGreaterThan(0)
    })

    it.each(Object.entries(valid))('accepts %s', (_, json) => {
        expect(() => parseDescriptor(json)).not.toThrow()
    })

    it.each(Object.entries(invalid))('rejects %s', (_, json) => {
        expect(() => parseDescriptor(json)).toThrow(DescriptorError)
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

    it.each([
        '@.actAs',
        '$.context.template.packageId',
        '$.metadata.constants.network',
    ])('rejects a path that is not an argument or the contract: %s', (path) => {
        expect(() =>
            parseDescriptor({
                ...ping,
                display: { create: { intent: 'Ping', fields: [{ path }] } },
            })
        ).toThrow('path')
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
        [
            'a path declared twice',
            {
                create: {
                    intent: 'Ping',
                    fields: [{ path: 'id' }, { path: 'id', format: 'string' }],
                },
            },
            "field 'id' is declared more than once",
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

    it('checks the fields of cases like any other fields', () => {
        const withCases = (fields: unknown[], interpolatedIntent?: string) => ({
            ...ping,
            metadata: { ...ping.metadata, enums: { kind: { Red: 'red' } } },
            display: {
                create: {
                    intent: 'Ping',
                    interpolatedIntent,
                    fields: [{ path: 'id', cases: { Some: { fields } } }],
                },
            },
        })
        expect(() =>
            parseDescriptor(withCases([{ path: 'x' }, { path: 'x' }]))
        ).toThrow("case 'Some': field 'x' is declared more than once")
        expect(() =>
            parseDescriptor(
                withCases([
                    {
                        path: 'x',
                        format: 'enum',
                        params: { $ref: '$.metadata.enums.missing' },
                    },
                ])
            )
        ).toThrow("references missing enum '$.metadata.enums.missing'")
        // A case field cannot be used in the sentence
        expect(() =>
            parseDescriptor(withCases([{ path: 'x' }], 'Ping {x}'))
        ).toThrow("placeholder 'x' has no field with that path")
        expect(() =>
            parseDescriptor(withCases([{ path: 'x' }], 'Ping {id}'))
        ).not.toThrow()
    })

    it('needs a label or fields in a case', () => {
        expect(() =>
            parseDescriptor({
                ...ping,
                display: {
                    create: {
                        intent: 'Ping',
                        fields: [{ path: 'id', cases: { Some: {} } }],
                    },
                },
            })
        ).toThrow('a case needs a label or fields')
    })

    it('needs create or exercises', () => {
        expect(() => parseDescriptor({ ...ping, display: {} })).toThrow(
            'display needs create or exercises'
        )
    })
})
