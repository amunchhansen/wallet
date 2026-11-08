// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { clearSign } from './clear-sign.js'
import { shippedDescriptors } from './shipped.js'
import { twoPingPreviewTransaction } from './two-ping-preview.js'

describe('twoPingPreviewTransaction', () => {
    it('describes two Ping creates', () => {
        const result = clearSign(
            twoPingPreviewTransaction(),
            shippedDescriptors()
        )

        expect(result.complete).toBe(true)
        expect(result.operations).toHaveLength(2)
        expect(result.operations.map((op) => op.kind)).toEqual([
            'create',
            'create',
        ])
        expect(result.operations.map((op) => op.intent)).toEqual([
            expect.stringMatching(/^Ping .+ from /),
            expect.stringMatching(/^Ping .+ from /),
        ])
        expect(result.operations[0]?.intent).not.toBe(
            result.operations[1]?.intent
        )
    })
})
