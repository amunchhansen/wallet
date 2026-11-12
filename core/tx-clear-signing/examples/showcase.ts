// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// A five-root splice transaction, clear-signed with four descriptors this build does not ship:
// a governance lock, a featured app right, an activity marker exercised on that right, a
// Splitwell balance update, and a DSO vote.
//
// From the wallet repository:
//   pnpm exec tsx core/tx-clear-signing/examples/showcase.ts

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearSign, type Descriptor } from '../src/index.js'
import governanceLock from '../src/__tests__/schema-examples/splice/governance-lock.json'
import featuredAppRight from '../src/__tests__/schema-examples/splice/featured-app-right.json'
import splitwell from '../src/__tests__/schema-examples/splice/splitwell-balance-update.json'
import dsoRules from '../src/__tests__/schema-examples/splice/dso-rules.json'
import { showcaseTransaction } from '../src/__tests__/fixtures/showcase-transaction.js'

/** Base64 prepared transaction. */
export const preparedTransaction = showcaseTransaction

/** The hash of `preparedTransaction`. `clearSign` describes it only when it hashes to this. */
export const preparedTransactionHash =
    'wU/leIQzsMI4+iv+HDUzDFG0VZJX8BDQf1yJH3LMqA4='

/** One sentence per root, in root order. */
export const intents = [
    'Create a governance lock of 10000.0000000000 for alice::1220preview',
    'Featured app right for provider::1220preview',
    'Record activity of provider::1220preview for 2 beneficiaries',
    'Record a balance update in group flatmates of alice::1220preview',
    'Request a vote by alice::1220preview: Raise maxTextLength',
] as const

const descriptors = [
    governanceLock,
    featuredAppRight,
    splitwell,
    dsoRules,
] as unknown as Descriptor[]

export function describeShowcase() {
    return clearSign(preparedTransaction, descriptors, preparedTransactionHash)
}

async function run(): Promise<void> {
    const result = await describeShowcase()
    const wording = result.operations.map((op) => op.interpolatedIntent)
    const actual = wording.join('\n')
    const expected = intents.join('\n')
    if (actual !== expected) {
        throw new Error(`wording changed:\n${actual}`)
    }
    console.log(result.operations[0])
}

const entry = process.argv[1]
if (entry !== undefined && fileURLToPath(import.meta.url) === resolve(entry)) {
    await run()
}
