// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { clearSign } from './clear-sign.js'
import { builtinPingCreate } from './__tests__/fixtures/ping.js'
import { shippedDescriptors } from './shipped.js'

describe('shippedDescriptors', () => {
    it('fully describes the builtin Ping create', () => {
        const [descriptor] = shippedDescriptors()

        expect(descriptor?.context.template).toEqual({
            packageId:
                'de2cc2f90eb523414ff54e899951dadd8789a4c07e0f71f6d6c9eaf57d412a54',
            moduleName: 'Canton.Internal.Ping',
            entityName: 'Ping',
        })
        expect(
            clearSign(builtinPingCreate, shippedDescriptors()).complete
        ).toBe(true)
    })
})
