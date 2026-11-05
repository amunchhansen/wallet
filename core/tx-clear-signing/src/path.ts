// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Value } from '@canton-network/core-ledger-proto'
import { CONTRACT_PREFIX } from './intent.js'

export type Step =
    | { kind: 'name'; name: string }
    | { kind: 'key'; key: string }
    | { kind: 'each' }

export type PathRoot = 'argument' | 'contract' | 'transaction' | 'descriptor'

export interface ParsedPath {
    root: PathRoot
    steps: Step[]
}

export interface Resolved {
    values: Value[]
    /** True when a `[]` step applied, so the field is a list even with one element. */
    isList: boolean
}

export class PathError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'PathError'
    }
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*/

export function parsePath(path: string): ParsedPath {
    let root: PathRoot = 'argument'
    let rest = path
    if (path.startsWith(CONTRACT_PREFIX)) {
        root = 'contract'
        rest = path.slice(CONTRACT_PREFIX.length)
    } else if (path.startsWith('@.')) {
        root = 'transaction'
        rest = path.slice(2)
    } else if (path.startsWith('$.')) {
        root = 'descriptor'
        rest = path.slice(2)
    }

    const steps: Step[] = []
    let pos = 0
    for (;;) {
        if (rest.startsWith('[]', pos)) {
            steps.push({ kind: 'each' })
            pos += 2
        } else {
            const name = NAME.exec(rest.slice(pos))?.[0]
            if (name === undefined) {
                throw new PathError(`invalid path '${path}' at offset ${pos}`)
            }
            steps.push({ kind: 'name', name })
            pos += name.length
            while (rest.startsWith('["', pos)) {
                const end = quotedKeyEnd(rest, pos + 1)
                const key: unknown = JSON.parse(rest.slice(pos + 1, end + 1))
                steps.push({ kind: 'key', key: String(key) })
                pos = end + 2
            }
        }
        if (pos === rest.length) {
            return { root, steps }
        }
        if (rest[pos] !== '.') {
            throw new PathError(`invalid path '${path}' at offset ${pos}`)
        }
        pos++
    }
}

// Returns the offset of the closing quote of the JSON string starting at `start`, which must be
// followed by `]`.
function quotedKeyEnd(s: string, start: number): number {
    for (let i = start + 1; i < s.length; i++) {
        if (s[i] === '\\') {
            i++
        } else if (s[i] === '"') {
            if (s[i + 1] !== ']') break
            return i
        }
    }
    throw new PathError(`unterminated map key in '${s}'`)
}

/**
 * Resolves the steps of a path against a Daml value. A name step selects a record field by label or
 * the payload of a variant with that constructor. `Some` is unwrapped; `None` fails. A final `length`
 * step on a list or map yields its number of elements as an int64.
 *
 * @throws PathError when a step does not resolve
 */
export function resolvePath(root: Value, steps: Step[]): Resolved {
    let current: Value[] = [root]
    let isList = false
    steps.forEach((step, i) => {
        const isLast = i === steps.length - 1
        if (step.kind === 'each') isList = true
        current = current.flatMap((v) =>
            applyStep(unwrapOptional(v), step, isLast)
        )
    })
    return { values: current.map(unwrapOptional), isList }
}

function applyStep(v: Value, step: Step, isLast: boolean): Value[] {
    const sum = v.sum
    switch (step.kind) {
        case 'each':
            switch (sum.oneofKind) {
                case 'list':
                    return sum.list.elements
                case 'textMap':
                    return sum.textMap.entries.map((e) => present(e.value))
                case 'genMap':
                    return sum.genMap.entries.map((e) => present(e.value))
                default:
                    throw new PathError(`'[]' applied to ${describeKind(v)}`)
            }
        case 'key': {
            if (sum.oneofKind !== 'textMap') {
                throw new PathError(
                    `map key '${step.key}' applied to ${describeKind(v)}`
                )
            }
            const entry = sum.textMap.entries.find((e) => e.key === step.key)
            if (!entry) {
                throw new PathError(`no map entry '${step.key}'`)
            }
            return [present(entry.value)]
        }
        case 'name':
            return [selectName(v, step.name, isLast)]
    }
}

function selectName(v: Value, name: string, isLast: boolean): Value {
    const sum = v.sum
    switch (sum.oneofKind) {
        case 'record': {
            const field = sum.record.fields.find((f) => f.label === name)
            if (!field) {
                throw new PathError(`no record field '${name}'`)
            }
            return present(field.value)
        }
        case 'variant':
            if (sum.variant.constructor !== name) {
                throw new PathError(
                    `variant is '${sum.variant.constructor}', not '${name}'`
                )
            }
            return present(sum.variant.value)
        case 'list':
        case 'textMap':
        case 'genMap':
            if (name === 'length' && isLast) {
                return int64(elementCount(v))
            }
            break
    }
    throw new PathError(`'${name}' applied to ${describeKind(v)}`)
}

function elementCount(v: Value): number {
    switch (v.sum.oneofKind) {
        case 'list':
            return v.sum.list.elements.length
        case 'textMap':
            return v.sum.textMap.entries.length
        case 'genMap':
            return v.sum.genMap.entries.length
        default:
            return 0
    }
}

function unwrapOptional(v: Value): Value {
    let current = v
    while (current.sum.oneofKind === 'optional') {
        const inner = current.sum.optional.value
        if (!inner) {
            throw new PathError('optional value is None')
        }
        current = inner
    }
    return current
}

function present(v: Value | undefined): Value {
    if (!v) {
        throw new PathError('value is missing')
    }
    return v
}

function int64(n: number): Value {
    return { sum: { oneofKind: 'int64', int64: String(n) } }
}

export function describeKind(v: Value): string {
    return v.sum.oneofKind ?? 'an empty value'
}
