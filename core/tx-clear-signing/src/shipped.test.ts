// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { OperationDescription } from './clear-sign.js'
import { described, intentText } from './__tests__/helpers.js'
import { allocationV2Multileg } from './__tests__/fixtures/allocation-v2-multileg.js'
import { builtinPingCreate } from './__tests__/fixtures/ping.js'
import { shippedDescriptors } from './shipped.js'

function field(op: OperationDescription | undefined, path: string) {
    return op?.fields.find((f) => f.path === path)?.value
}

const pingPackageId =
    'de2cc2f90eb523414ff54e899951dadd8789a4c07e0f71f6d6c9eaf57d412a54'

describe('shippedDescriptors', () => {
    it('fully describes the builtin Ping create', async () => {
        const descriptor = shippedDescriptors().find(
            (d) => d.context.template.entityName === 'Ping'
        )

        expect(descriptor?.context.template).toEqual({
            packageId: pingPackageId,
            moduleName: 'Canton.Internal.Ping',
            entityName: 'Ping',
        })
        expect(
            (await described(builtinPingCreate, shippedDescriptors())).complete
        ).toBe(true)
    })

    it('describes a captured two-leg allocation', async () => {
        const result = await described(
            allocationV2Multileg,
            shippedDescriptors()
        )
        const op = result.operations[0]

        expect(result.complete).toBe(true)
        expect(result.operations).toHaveLength(1)
        expect(op).toMatchObject({
            kind: 'exercise',
            choiceId: 'AllocationFactory_Allocate',
            status: 'described',
            interface: {
                packageId:
                    '9818a0b5b827109de03a04c8f6151cde9d1e7fe5123dbb2dfeb0e52d7271287c',
                moduleName: 'Splice.Api.Token.AllocationInstructionV2',
                entityName: 'AllocationFactory',
            },
        })
        expect(intentText(op)).toContain('of 2 transfer legs')
        const legs = field(op, 'allocation.transferLegSides')
        expect(legs).toEqual(expect.any(String))
        expect(JSON.parse(legs as string)).toMatchObject([
            {
                transferLegId: 'leg-1',
                side: 'SenderSide',
                amount: '0.3000000000',
                instrumentId: 'Amulet',
                otherside: {
                    owner: 'bd::1220cb1468d149d30ad6f674acb2f6769dd2a6e6e1b90346fd4905fed66f37b2de56',
                },
            },
            {
                transferLegId: 'leg-2',
                side: 'ReceiverSide',
                amount: '0.1000000000',
                instrumentId: 'Amulet',
                otherside: {
                    owner: 'bd::1220cb1468d149d30ad6f674acb2f6769dd2a6e6e1b90346fd4905fed66f37b2de56',
                },
            },
        ])
    })
})
