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
    ])('rejects a choice that is not a choice name: %s', (choice) => {
        expect(() =>
            parseDescriptor({
                ...ping,
                display: { exercises: [{ choice, intent: 'Poke' }] },
            })
        ).toThrow('display.exercises.0.choice')
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
            'a contract placeholder in create',
            {
                create: {
                    intent: 'Ping',
                    interpolatedIntent: '{@.contract.id}',
                    fields: [{ path: 'id' }],
                },
            },
            "placeholder '@.contract.id' has no field with that path",
        ],
        [
            'a contract field in create',
            {
                create: {
                    intent: 'Ping',
                    fields: [{ path: '@.contract.id' }],
                },
            },
            'display.create.fields.0.path',
        ],
        [
            'a contract placeholder without a field in its exercise',
            {
                create: { intent: 'Ping', fields: [{ path: 'owner' }] },
                exercises: [
                    {
                        choice: 'Respond',
                        intent: 'Respond',
                        interpolatedIntent: '{@.contract.owner}',
                    },
                ],
            },
            "exercises[0] (Respond): placeholder '@.contract.owner' has no field with that path",
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

    it('allows a format on a field with cases', () => {
        expect(() =>
            parseDescriptor({
                ...ping,
                display: {
                    create: {
                        intent: 'Ping',
                        fields: [
                            {
                                path: 'id',
                                format: 'string',
                                cases: { None: {} },
                            },
                        ],
                    },
                },
            })
        ).not.toThrow()
    })

    it('rejects a package ID on an exercise interface', () => {
        expect(() =>
            parseDescriptor({
                ...ping,
                display: {
                    exercises: [
                        {
                            choice: 'Respond',
                            intent: 'Respond',
                            interface: {
                                ...ping.context.template,
                                entityName: 'Asset',
                            },
                        },
                    ],
                },
            })
        ).toThrow('interface')
    })

    it('rejects a case that is not Some or None', () => {
        const withCases = (cases: unknown) => ({
            ...ping,
            display: {
                create: {
                    intent: 'Ping',
                    fields: [{ path: 'id', cases }],
                },
            },
        })
        expect(() => parseDescriptor(withCases({ GLS_FullLock: {} }))).toThrow(
            "case 'GLS_FullLock' is not 'Some' or 'None'"
        )
        expect(() =>
            parseDescriptor(withCases({ Some: {}, GLS_FullLock: {} }))
        ).toThrow("case 'GLS_FullLock' is not 'Some' or 'None'")
    })

    it('accepts an empty case, and rejects a case label', () => {
        const withCase = (c: unknown) => ({
            ...ping,
            display: {
                create: {
                    intent: 'Ping',
                    fields: [{ path: 'id', cases: { None: c } }],
                },
            },
        })
        expect(() => parseDescriptor(withCase({}))).not.toThrow()
        expect(() => parseDescriptor(withCase({ label: 'not set' }))).toThrow(
            'label'
        )
    })

    it('needs create or exercises', () => {
        expect(() => parseDescriptor({ ...ping, display: {} })).toThrow(
            'display needs create or exercises'
        )
    })

    it('rejects two entries for the same choice and interface', () => {
        const iface = {
            moduleName: 'Canton.Internal.Ping',
            entityName: 'Asset',
        }
        expect(() =>
            parseDescriptor({
                ...ping,
                display: {
                    exercises: [
                        {
                            choice: 'Respond',
                            intent: 'Respond',
                            interface: iface,
                        },
                        {
                            choice: 'Respond',
                            intent: 'Respond',
                            interface: iface,
                        },
                    ],
                },
            })
        ).toThrow('the same choice and interface is already described')
        expect(() =>
            parseDescriptor({
                ...ping,
                display: {
                    exercises: [
                        { choice: 'Respond', intent: 'Respond' },
                        {
                            choice: 'Respond',
                            intent: 'Respond through Asset',
                            interface: iface,
                        },
                    ],
                },
            })
        ).not.toThrow()
    })
})
