// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { HashingSchemeVersion } from '@canton-network/core-ledger-proto'
import { computePreparedTransactionHash } from '@canton-network/core-tx-hashing'
import { toBase64 } from './bytes.js'

// V3 first: a V2 hash of a V3 transaction is a different value, so the claimed hash selects the scheme.
const SCHEMES = [HashingSchemeVersion.V3, HashingSchemeVersion.V2] as const

/**
 * The hash of `preparedTransaction` under hashing scheme V3, base64. `clearSign` accepts this hash.
 */
export async function hashPreparedTransaction(
    preparedTransaction: string
): Promise<string> {
    const digest = await computePreparedTransactionHash(
        preparedTransaction,
        HashingSchemeVersion.V3
    )
    return toBase64(digest)
}

/**
 * The hash of `preparedTransaction`, computed from the bytes themselves. `claimedHash` only selects
 * the hashing scheme. Returns undefined when no scheme reproduces it: the bytes are then not the
 * transaction that hash belongs to, and approval must not be offered.
 *
 * The wallet gateway approve page calls this to decide whether to offer approval, before it describes
 * the transaction. `clearSign` uses the same check and throws `HashMismatchError` when the hash does
 * not match.
 *
 * Unknown protobuf fields are refused. A transaction that cannot be hashed throws.
 */
export async function hashForReview(
    preparedTransaction: string,
    claimedHash: string
): Promise<string | undefined> {
    for (const hashingScheme of SCHEMES) {
        const digest = await computePreparedTransactionHash(
            preparedTransaction,
            hashingScheme
        )
        const hash = toBase64(digest)
        if (hash === claimedHash) return hash
    }
    return undefined
}
