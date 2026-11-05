// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
    clearSign,
    requiredTemplates,
} from '@canton-network/core-tx-clear-signing'
import { pingCreate } from '../__tests__/ping-transaction.js'
import { resolveDescriptors } from './registry.js'

describe('resolveDescriptors', () => {
    it('describes a Ping create with the bundled descriptor', () => {
        const descriptors = resolveDescriptors(requiredTemplates(pingCreate))
        const result = clearSign(pingCreate, descriptors)

        expect(result.complete).toBe(true)
        expect(result.operations[0]?.intent).toMatch(
            /^Ping \S+ from \S+ to \S+$/
        )
    })

    it('leaves out templates without a descriptor', () => {
        const template = {
            packageId: '0'.repeat(64),
            moduleName: 'Unknown',
            entityName: 'Template',
        }
        expect(resolveDescriptors([template])).toEqual([])
    })
})
