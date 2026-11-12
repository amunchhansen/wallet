// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest'
import { shippedDescriptors } from '@canton-network/core-wallet-services/clear-signing'
import { StateManager } from './state-manager.js'
import {
    activeDescriptors,
    addDescriptor,
    removeDescriptor,
    uploadedDescriptors,
} from './descriptors-store.js'

const builtInPing = shippedDescriptors().find(
    (d) => d.context.template.entityName === 'Ping'
)!

function otherTemplate(entityName: string, name = entityName) {
    return {
        ...builtInPing,
        context: {
            template: { ...builtInPing.context.template, entityName },
        },
        metadata: { ...builtInPing.metadata, name },
    }
}

describe('descriptors store', () => {
    afterEach(() => {
        localStorage.clear()
    })

    it('starts with the built-in descriptors only', () => {
        expect(uploadedDescriptors()).toEqual([])
        expect(activeDescriptors().map((a) => a.source)).toEqual(
            shippedDescriptors().map(() => 'built-in')
        )
    })

    it('adds an upload and replaces an earlier one for the same template', () => {
        addDescriptor(otherTemplate('Pong', 'first'))
        addDescriptor(otherTemplate('Pong', 'second'))

        expect(uploadedDescriptors().map((d) => d.metadata.name)).toEqual([
            'second',
        ])
        expect(activeDescriptors().at(-1)).toMatchObject({
            source: 'uploaded',
            descriptor: { metadata: { name: 'second' } },
        })
    })

    it('replaces a built-in descriptor for the same template', () => {
        addDescriptor({
            ...builtInPing,
            metadata: { ...builtInPing.metadata, name: 'Edited ping' },
        })

        const active = activeDescriptors()
        expect(active).toHaveLength(shippedDescriptors().length)
        expect(
            active.find(
                (a) => a.descriptor.context.template.entityName === 'Ping'
            )
        ).toMatchObject({
            source: 'replaces built-in',
            descriptor: { metadata: { name: 'Edited ping' } },
        })
    })

    it('rejects a descriptor without a template and stores nothing', () => {
        expect(() => addDescriptor({ ...builtInPing, context: {} })).toThrow(
            /no template/
        )
        expect(uploadedDescriptors()).toEqual([])
    })

    it('skips a stored entry that no longer parses', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        localStorage.setItem(
            'com.splice.wallet.v1.clear-signing-descriptors',
            JSON.stringify([{ broken: true }, otherTemplate('Pong')])
        )

        expect(uploadedDescriptors().map((d) => d.metadata.name)).toEqual([
            'Pong',
        ])
        expect(warn).toHaveBeenCalledOnce()
        warn.mockRestore()
    })

    it('keeps uploads when a page loads the state manager', () => {
        addDescriptor(otherTemplate('Pong'))
        new StateManager()
        expect(uploadedDescriptors().map((d) => d.metadata.name)).toEqual([
            'Pong',
        ])
    })

    it('removes an upload', () => {
        const pong = addDescriptor(otherTemplate('Pong'))
        removeDescriptor(pong)
        expect(uploadedDescriptors()).toEqual([])
    })

    it('keeps both interface entries of one descriptor, and replaces the built-in', () => {
        const iface = (entityName: string) => ({
            moduleName: 'Canton.Internal.Ping',
            entityName,
        })
        addDescriptor({
            ...builtInPing,
            metadata: { ...builtInPing.metadata, name: 'Ping with interfaces' },
            display: {
                exercises: ['V1', 'V2'].map((name) => ({
                    choice: 'Respond',
                    interface: iface(name),
                    intent: `Respond through ${name}`,
                })),
            },
        })

        const active = activeDescriptors().find(
            (a) => a.descriptor.context.template.entityName === 'Ping'
        )
        expect(active?.source).toBe('replaces built-in')
        expect(
            active?.descriptor.display.exercises?.map(
                (e) => e.interface?.entityName
            )
        ).toEqual(['V1', 'V2'])
    })
})
