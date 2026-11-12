// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { describePing, intent as pingIntent } from '../examples/ping.js'
import {
    describeAllocation,
    intent as allocationIntent,
} from '../examples/allocation.js'
import {
    describeShowcase,
    intents as showcaseIntents,
    preparedTransactionHash as showcaseHash,
} from '../examples/showcase.js'

describe('standalone examples', () => {
    it('describes the builtin ping create', async () => {
        const result = await describePing()
        expect(result.complete).toBe(true)
        expect(result.operations).toHaveLength(1)
        expect(result.operations[0]?.interpolatedIntent).toBe(pingIntent)
    })

    it('describes the two-leg allocation', async () => {
        const result = await describeAllocation()
        expect(result.complete).toBe(true)
        expect(result.operations).toHaveLength(1)
        expect(result.operations[0]?.choiceId).toBe(
            'AllocationFactory_Allocate'
        )
        expect(result.operations[0]?.interpolatedIntent).toBe(allocationIntent)
    })

    it('describes the five-root splice showcase', async () => {
        const result = await describeShowcase()
        expect(result.complete).toBe(true)
        expect(result.hash).toBe(showcaseHash)
        expect(result.operations).toHaveLength(5)
        expect(result.operations[2]?.choiceId).toBe(
            'FeaturedAppRight_CreateActivityMarker'
        )
        expect(result.operations[2]?.interface?.moduleName).toBe(
            'Splice.Api.FeaturedAppRightV2'
        )
        expect(result.operations[4]?.choiceId).toBe('DsoRules_RequestVote')
        expect(result.operations.map((op) => op.interpolatedIntent)).toEqual([
            ...showcaseIntents,
        ])
    })
})
