// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Value } from '@canton-network/core-ledger-proto'

export type Step = { kind: 'name'; name: string } | { kind: 'key'; key: string }

export class PathError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'PathError'
    }
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*/

/**
 * Parses a path into its steps. The path starts at the value it is resolved against; `@.contract.`
 * is stripped by the caller, which also picks that value.
 */
export function parsePath(path: string): Step[] {
    const steps: Step[] = []
    let pos = 0
    for (;;) {
        const name = NAME.exec(path.slice(pos))?.[0]
        if (name === undefined) {
            throw new PathError(`invalid path '${path}' at offset ${pos}`)
        }
        steps.push({ kind: 'name', name })
        pos += name.length
        while (path.startsWith('["', pos)) {
            const end = quotedKeyEnd(path, pos + 1)
            const key: unknown = JSON.parse(path.slice(pos + 1, end + 1))
            steps.push({ kind: 'key', key: String(key) })
            pos = end + 2
        }
        if (pos === path.length) {
            return steps
        }
        if (path[pos] !== '.') {
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

export interface Resolved {
    value: Value
    /**
     * Set when a record has no field labelled as the path names. The ledger leaves trailing `None`
     * fields out of a record, and upgrades only append optional fields, so such a field is taken to
     * be `None`. A mistyped path looks the same, so the caller shows that the value was inferred.
     */
    absentField?: string
}

const NONE: Value = { sum: { oneofKind: 'optional', optional: {} } }

/**
 * Resolves the steps of a path against a Daml value. A name step selects a record field by label or
 * the payload of a variant with that constructor. `Some` is unwrapped. A `None` cannot be stepped
 * into, but is returned when it is the value the path names. A record field that is not in the
 * record resolves the whole path to `None`, with `absentField` set. A final `length` step on a list
 * or text map yields its number of elements as an int64.
 *
 * @throws PathError when a step does not resolve
 */
export function resolvePath(root: Value, steps: Step[]): Resolved {
    let current = root
    for (const [i, step] of steps.entries()) {
        const v = unwrapSome(current)
        const missing = step.kind === 'name' && lacksField(v, step.name)
        if (missing) {
            return { value: NONE, absentField: step.name }
        }
        current = applyStep(v, step, i === steps.length - 1)
    }
    return { value: unwrapSome(current) }
}

function lacksField(v: Value, name: string): boolean {
    return (
        v.sum.oneofKind === 'record' &&
        !v.sum.record.fields.some((f) => f.label === name)
    )
}

export function isNone(v: Value): boolean {
    return v.sum.oneofKind === 'optional' && !v.sum.optional.value
}

function applyStep(v: Value, step: Step, isLast: boolean): Value {
    if (isNone(v)) {
        throw new PathError('optional value is None')
    }
    const sum = v.sum
    switch (step.kind) {
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
            return present(entry.value)
        }
        case 'name':
            return selectName(v, step.name, isLast)
    }
}

function selectName(v: Value, name: string, isLast: boolean): Value {
    const sum = v.sum
    switch (sum.oneofKind) {
        case 'record': {
            // resolvePath handles a missing field before it gets here
            const field = sum.record.fields.find((f) => f.label === name)
            return present(field?.value)
        }
        case 'variant':
            if (sum.variant.constructor !== name) {
                throw new PathError(
                    `variant is '${sum.variant.constructor}', not '${name}'`
                )
            }
            return present(sum.variant.value)
        case 'list':
            if (name === 'length' && isLast) {
                return int64(sum.list.elements.length)
            }
            break
        case 'textMap':
            if (name === 'length' && isLast) {
                return int64(sum.textMap.entries.length)
            }
            break
    }
    throw new PathError(`'${name}' applied to ${describeKind(v)}`)
}

// Unwraps Some, however nested. A None has nothing to unwrap and is returned as is.
function unwrapSome(v: Value): Value {
    let current = v
    while (current.sum.oneofKind === 'optional' && current.sum.optional.value) {
        current = current.sum.optional.value
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
