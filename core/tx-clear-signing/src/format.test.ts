// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { Value } from '@canton-network/core-ledger-proto'
import type { Field } from './descriptor.js'
import { formatValue, FormatError } from './format.js'

const text = (t: string): Value => ({ sum: { oneofKind: 'text', text: t } })
const int64 = (n: string): Value => ({ sum: { oneofKind: 'int64', int64: n } })
const relTime = (micros: string): Value => ({
    sum: {
        oneofKind: 'record',
        record: { fields: [{ label: 'microseconds', value: int64(micros) }] },
    },
})
const field = (format: Field['format'], ref?: string): Field => ({
    path: 'x',
    ...(format && { format }),
    ...(ref && { params: { $ref: ref } }),
})
// Written as a code point: a literal right-to-left override would be invisible in the source.
const RLO = String.fromCodePoint(0x202e)
const enums = { side: { SenderSide: 'send to', true: 'yes' } }

describe('formatValue', () => {
    it.each([
        ['0', '0s'],
        ['1500000', '1.5s'],
        ['90061000001', '1d 1h 1m 1.000001s'],
        ['-3600000000', '-1h'],
    ])('formats a duration of %s µs as %s', (micros, expected) => {
        expect(formatValue(relTime(micros), field('duration'), {})).toBe(
            expected
        )
    })

    it('formats timestamps before the epoch and on whole seconds', () => {
        const ts = (micros: string): Value => ({
            sum: { oneofKind: 'timestamp', timestamp: micros },
        })
        expect(formatValue(ts('-1'), field('dateTime'), {})).toBe(
            '1969-12-31T23:59:59.999999Z'
        )
        expect(formatValue(ts('0'), field('dateTime'), {})).toBe(
            '1970-01-01T00:00:00Z'
        )
    })

    it('maps enum constructors, bools and unit variants through the table', () => {
        const ref = '$.metadata.enums.side'
        const variant: Value = {
            sum: {
                oneofKind: 'variant',
                variant: { constructor: 'SenderSide' },
            },
        }
        const bool: Value = { sum: { oneofKind: 'bool', bool: true } }
        expect(formatValue(variant, field('enum', ref), enums)).toBe('send to')
        expect(formatValue(bool, field('enum', ref), enums)).toBe('yes')
    })

    it('fails on a value missing from the enum table', () => {
        const ref = '$.metadata.enums.side'
        const value: Value = {
            sum: { oneofKind: 'enum', enum: { constructor: 'ReceiverSide' } },
        }
        expect(() => formatValue(value, field('enum', ref), enums)).toThrow(
            "'ReceiverSide' is not in enum table"
        )
        expect(() =>
            formatValue(text('toString'), field('enum', ref), enums)
        ).toThrow(FormatError)
    })

    it('never coerces', () => {
        expect(() => formatValue(int64('1'), field('string'), {})).toThrow(
            "format 'string' does not accept int64"
        )
        expect(() => formatValue(text('1'), field('number'), {})).toThrow(
            FormatError
        )
        expect(() => formatValue(text('1d'), field('duration'), {})).toThrow(
            FormatError
        )
    })

    it('escapes control and bidirectional characters', () => {
        expect(formatValue(text(`a\nb${RLO}c`), field('string'), {})).toBe(
            'a\\u{000a}b\\u{202e}c'
        )
    })

    it('shows a value without format as raw', () => {
        expect(formatValue(int64('5'), field(undefined), {})).toBe('5')
    })
})
