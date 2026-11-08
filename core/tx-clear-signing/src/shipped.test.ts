// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { clearSign } from './clear-sign.js'
import { builtinPingCreate } from './__tests__/fixtures/ping.js'
import { shippedDescriptors } from './shipped.js'

const pingPackageId =
    'de2cc2f90eb523414ff54e899951dadd8789a4c07e0f71f6d6c9eaf57d412a54'

describe('shippedDescriptors', () => {
    it('fully describes the builtin Ping create', () => {
        const descriptor = shippedDescriptors().find(
            (d) => d.context.template.entityName === 'Ping'
        )

        expect(descriptor?.context.template).toEqual({
            packageId: pingPackageId,
            moduleName: 'Canton.Internal.Ping',
            entityName: 'Ping',
        })
        expect(
            clearSign(builtinPingCreate, shippedDescriptors()).complete
        ).toBe(true)
    })

    it('includes the builtin Bong proposal', () => {
        const descriptor = shippedDescriptors().find(
            (d) => d.context.template.entityName === 'BongProposal'
        )

        expect(descriptor?.context.template).toEqual({
            packageId: pingPackageId,
            moduleName: 'Canton.Internal.Bong',
            entityName: 'BongProposal',
        })
        expect(Object.keys(descriptor?.display.exercises ?? {}).sort()).toEqual(
            ['AbortBongProposal', 'Accept']
        )
        expect(descriptor?.display.create?.fields?.map((f) => f.path)).toEqual([
            'id',
            'initiator',
            'candidates.[]',
            'validators.[]',
            'responders.[]',
            'maxLevel',
            'timeout',
        ])
    })

    it('includes the rest of the builtin Bong choices', () => {
        const byEntity = new Map(
            shippedDescriptors().map((d) => [
                d.context.template.entityName,
                Object.keys(d.display.exercises ?? {}).sort(),
            ])
        )

        expect(byEntity.get('Explode')).toEqual([
            'AbortExplode',
            'ProcessExplode',
        ])
        expect(byEntity.get('Merge')).toEqual(['AbortMerge', 'ProcessMerge'])
        expect(byEntity.get('Collapse')).toEqual([
            'AbortCollapse',
            'ProcessCollapse',
        ])
        expect(byEntity.get('Bong')).toEqual(['AbortBong', 'Ack'])
    })

    it('includes AllocationFactory_Allocate on the external party amulet rules', () => {
        const descriptor = shippedDescriptors().find(
            (d) => d.context.template.entityName === 'ExternalPartyAmuletRules'
        )

        expect(descriptor?.context.template).toEqual({
            packageId:
                'fb10433a48c24f30076a7aee03a3e314b7ab02fe9a22e2069e3af92d2b6ac88a',
            moduleName: 'Splice.ExternalPartyAmuletRules',
            entityName: 'ExternalPartyAmuletRules',
        })
        expect(Object.keys(descriptor?.display.exercises ?? {})).toEqual([
            'AllocationFactory_Allocate',
        ])
    })
})
