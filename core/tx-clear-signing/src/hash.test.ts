// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { fromBase64, toBase64 } from './bytes.js'
import { hashForReview, hashPreparedTransaction } from './hash.js'
import createAndExercise from './__tests__/fixtures/v2-create-and-exercise.json'
import glLockCreate from './__tests__/fixtures/splice/gl-lock-create.json'

function hexToBase64(hex: string): string {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    }
    return toBase64(bytes)
}

// Protobuf field 999, wire type varint, value 1. Concatenated messages decode as one.
const UNKNOWN_FIELD = Uint8Array.from([0xb8, 0x3e, 0x01])

describe('hashForReview', () => {
    it('returns the hash under the scheme that reproduces the claimed hash', async () => {
        const v2Hash = hexToBase64(createAndExercise.expected.hash)
        await expect(
            hashForReview(createAndExercise.preparedTransaction, v2Hash)
        ).resolves.toBe(v2Hash)
        await expect(
            hashForReview(
                glLockCreate.preparedTransaction,
                glLockCreate.preparedTransactionHash
            )
        ).resolves.toBe(glLockCreate.preparedTransactionHash)
    })

    it('returns undefined when the claimed hash belongs to another transaction', async () => {
        await expect(
            hashForReview(
                createAndExercise.preparedTransaction,
                btoa('x'.repeat(32))
            )
        ).resolves.toBeUndefined()
    })

    it('refuses a transaction with an unknown field', async () => {
        const tx = toBase64(
            Uint8Array.from([
                ...fromBase64(createAndExercise.preparedTransaction),
                ...UNKNOWN_FIELD,
            ])
        )
        await expect(
            hashForReview(tx, btoa('x'.repeat(32)))
        ).rejects.toMatchObject({
            name: 'TxHashingError',
            code: 'UNKNOWN_FIELD',
        })
    })
})

describe('hashPreparedTransaction', () => {
    it('returns the V3 hash clearSign accepts', async () => {
        await expect(
            hashPreparedTransaction(glLockCreate.preparedTransaction)
        ).resolves.toBe(glLockCreate.preparedTransactionHash)
        const v2Transaction = createAndExercise.preparedTransaction
        const v3Hash = await hashPreparedTransaction(v2Transaction)
        expect(v3Hash).not.toBe(hexToBase64(createAndExercise.expected.hash))
        await expect(hashForReview(v2Transaction, v3Hash)).resolves.toBe(v3Hash)
    })
})
