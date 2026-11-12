// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { ExtraDescriptorsError, clearSign } from './clear-sign.js'
import { selectDescriptors } from '../../wallet-services/src/clear-signing/select.js'
import { captured, capturedIds, spliceDescriptors } from './__tests__/splice.js'

describe('selectDescriptors', () => {
    it.each(capturedIds)(
        '%s selects descriptors clearSign accepts',
        async (id) => {
            const { preparedTransaction, preparedTransactionHash } =
                captured(id)
            const selected = selectDescriptors(
                preparedTransaction,
                spliceDescriptors
            )
            const described = await clearSign(
                preparedTransaction,
                selected,
                preparedTransactionHash
            )
            expect(described.hash).toBe(preparedTransactionHash)
            await expect(
                clearSign(
                    preparedTransaction,
                    spliceDescriptors,
                    preparedTransactionHash
                )
            ).rejects.toThrow(ExtraDescriptorsError)
        }
    )
})
