// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Value } from '@canton-network/core-ledger-proto'
import type { Field } from './descriptor.js'
import { describeKind } from './path.js'

export class FormatError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'FormatError'
    }
}

export type EnumTables = Partial<Record<string, Record<string, string>>>

const MICROS_PER_SECOND = 1_000_000n
const MS_PER_DAY = 86_400_000

/**
 * Formats a Daml value for display. Each formatter accepts only certain value kinds and fails on any
 * other; it never coerces.
 *
 * @throws FormatError on a kind the formatter does not accept, or an enum value missing from its table
 */
export function formatValue(v: Value, field: Field, enums: EnumTables): string {
    return sanitize(formatUnsanitized(v, field, enums))
}

function formatUnsanitized(v: Value, field: Field, enums: EnumTables): string {
    const sum = v.sum
    const format = field.format ?? 'raw'
    switch (format) {
        case 'string':
            if (sum.oneofKind === 'text') return sum.text
            break
        case 'number':
            if (sum.oneofKind === 'int64') return sum.int64
            if (sum.oneofKind === 'numeric') return sum.numeric
            break
        case 'boolean':
            if (sum.oneofKind === 'bool') return String(sum.bool)
            break
        case 'party':
            if (sum.oneofKind === 'party') return sum.party
            break
        case 'contractId':
            if (sum.oneofKind === 'contractId') return sum.contractId
            break
        case 'dateTime':
            if (sum.oneofKind === 'timestamp')
                return formatTimestamp(sum.timestamp)
            if (sum.oneofKind === 'date') return formatDate(sum.date)
            break
        case 'duration': {
            const micros = relTimeMicros(v)
            if (micros !== undefined) return formatDuration(micros)
            break
        }
        case 'enum':
            return formatEnum(v, field, enums)
        case 'raw':
            return formatRaw(v)
    }
    throw new FormatError(
        `format '${format}' does not accept ${describeKind(v)}`
    )
}

function formatEnum(v: Value, field: Field, enums: EnumTables): string {
    const ref = field.params?.$ref ?? ''
    const table = enums[ref.slice('$.metadata.enums.'.length)]
    if (!table) {
        throw new FormatError(`enum table '${ref}' does not exist`)
    }
    const key = enumKey(v)
    const label = Object.hasOwn(table, key) ? table[key] : undefined
    if (label === undefined) {
        throw new FormatError(`'${key}' is not in enum table '${ref}'`)
    }
    return label
}

function enumKey(v: Value): string {
    const sum = v.sum
    switch (sum.oneofKind) {
        case 'enum':
            return sum.enum.constructor
        case 'bool':
            return String(sum.bool)
        case 'variant': {
            const payload = sum.variant.value?.sum.oneofKind
            if (payload === undefined || payload === 'unit') {
                return sum.variant.constructor
            }
            break
        }
    }
    throw new FormatError(`format 'enum' does not accept ${describeKind(v)}`)
}

function formatTimestamp(micros: string): string {
    const total = BigInt(micros)
    let seconds = total / MICROS_PER_SECOND
    let fraction = total % MICROS_PER_SECOND
    if (fraction < 0n) {
        seconds -= 1n
        fraction += MICROS_PER_SECOND
    }
    const iso = new Date(Number(seconds) * 1000).toISOString()
    const suffix =
        fraction === 0n ? 'Z' : `.${fraction.toString().padStart(6, '0')}Z`
    return iso.replace(/\.\d{3}Z$/, suffix)
}

function formatDate(days: number): string {
    return new Date(days * MS_PER_DAY).toISOString().slice(0, 10)
}

// DA.Time's RelTime is a record with one int64 field, microseconds.
function relTimeMicros(v: Value): bigint | undefined {
    if (v.sum.oneofKind !== 'record') return undefined
    const fields = v.sum.record.fields
    const only = fields.length === 1 ? fields[0] : undefined
    const value = only?.label === 'microseconds' ? only.value?.sum : undefined
    return value?.oneofKind === 'int64' ? BigInt(value.int64) : undefined
}

function formatDuration(micros: bigint): string {
    const sign = micros < 0n ? '-' : ''
    let rest = micros < 0n ? -micros : micros
    const parts: string[] = []
    for (const [unit, size] of [
        ['d', 86_400n * MICROS_PER_SECOND],
        ['h', 3_600n * MICROS_PER_SECOND],
        ['m', 60n * MICROS_PER_SECOND],
    ] as const) {
        if (rest >= size) {
            parts.push(`${rest / size}${unit}`)
            rest %= size
        }
    }
    if (rest > 0n || parts.length === 0) {
        const whole = rest / MICROS_PER_SECOND
        const fraction = (rest % MICROS_PER_SECOND)
            .toString()
            .padStart(6, '0')
            .replace(/0+$/, '')
        parts.push(fraction === '' ? `${whole}s` : `${whole}.${fraction}s`)
    }
    return sign + parts.join(' ')
}

function formatRaw(v: Value): string {
    const plain = toPlain(v)
    return typeof plain === 'string' ? plain : JSON.stringify(plain)
}

type Plain = string | boolean | null | Plain[] | { [key: string]: Plain }

function toPlain(v: Value | undefined): Plain {
    const sum = v?.sum
    switch (sum?.oneofKind) {
        case 'unit':
            return '()'
        case 'bool':
            return sum.bool
        case 'int64':
            return sum.int64
        case 'numeric':
            return sum.numeric
        case 'party':
            return sum.party
        case 'text':
            return sum.text
        case 'contractId':
            return sum.contractId
        case 'timestamp':
            return formatTimestamp(sum.timestamp)
        case 'date':
            return formatDate(sum.date)
        case 'optional':
            return sum.optional.value ? toPlain(sum.optional.value) : null
        case 'list':
            return sum.list.elements.map(toPlain)
        case 'textMap':
            return Object.fromEntries(
                sum.textMap.entries.map((e) => [e.key, toPlain(e.value)])
            )
        case 'genMap':
            return sum.genMap.entries.map((e) => [
                toPlain(e.key),
                toPlain(e.value),
            ])
        case 'record':
            return Object.fromEntries(
                sum.record.fields.map((f, i) => [
                    f.label || String(i),
                    toPlain(f.value),
                ])
            )
        case 'variant':
            return { [sum.variant.constructor]: toPlain(sum.variant.value) }
        case 'enum':
            return sum.enum.constructor
        default:
            return null
    }
}

// Values come from the transaction and are untrusted. Control, format (bidirectional overrides,
// zero-width characters) and line or paragraph separator characters could break lines, hide text or
// reorder the text around them, so they are shown escaped.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

function sanitize(s: string): string {
    return s.replace(
        UNSAFE,
        (c) => `\\u{${c.codePointAt(0)?.toString(16).padStart(4, '0')}}`
    )
}
