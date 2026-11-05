// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { Value } from '@canton-network/core-ledger-proto'
import { parsePath, PathError, resolvePath } from './path.js'

describe('parsePath', () => {
    it('splits roots and steps', () => {
        expect(parsePath('@.contract.transfer.amount')).toEqual({
            root: 'contract',
            steps: [
                { kind: 'name', name: 'transfer' },
                { kind: 'name', name: 'amount' },
            ],
        })
        expect(parsePath('settlement.executors.[]').steps).toEqual([
            { kind: 'name', name: 'settlement' },
            { kind: 'name', name: 'executors' },
            { kind: 'each' },
        ])
        expect(parsePath('@.actAs').root).toBe('transaction')
        expect(parsePath('$.metadata.constants.dso').root).toBe('descriptor')
    })

    it('reads quoted map keys, including escapes and separators', () => {
        expect(
            parsePath('meta.values["a \\"quoted\\" key with } and ]"]').steps
        ).toEqual([
            { kind: 'name', name: 'meta' },
            { kind: 'name', name: 'values' },
            { kind: 'key', key: 'a "quoted" key with } and ]' },
        ])
    })

    it.each(['', '.amount', 'amount.', 'a..b', 'values["open', '1amount'])(
        'rejects %j',
        (path) => {
            expect(() => parsePath(path)).toThrow(PathError)
        }
    )
})

describe('resolvePath', () => {
    const none: Value = { sum: { oneofKind: 'optional', optional: {} } }
    const record = (label: string, value: Value): Value => ({
        sum: { oneofKind: 'record', record: { fields: [{ label, value }] } },
    })

    it('fails on None', () => {
        expect(() =>
            resolvePath(record('x', none), parsePath('x').steps)
        ).toThrow('optional value is None')
    })

    it('selects a record field named length', () => {
        const value: Value = { sum: { oneofKind: 'int64', int64: '7' } }
        expect(
            resolvePath(record('length', value), parsePath('length').steps)
                .values
        ).toEqual([value])
    })

    it('only counts on the last step', () => {
        const list: Value = {
            sum: { oneofKind: 'list', list: { elements: [] } },
        }
        expect(() =>
            resolvePath(record('xs', list), parsePath('xs.length.foo').steps)
        ).toThrow("'length' applied to list")
    })
})
