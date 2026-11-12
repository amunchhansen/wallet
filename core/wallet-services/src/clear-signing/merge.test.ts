// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { mergeDescriptors, templateKeyOf } from './merge.js'
import { shippedDescriptors } from './shipped.js'

const ping = shippedDescriptors().find(
    (descriptor) => descriptor.context.template.entityName === 'Ping'
)!

function renamed(entityName: string, name = entityName) {
    return {
        ...ping,
        context: {
            template: { ...ping.context.template, entityName },
        },
        metadata: { ...ping.metadata, name },
    }
}

describe('mergeDescriptors', () => {
    it('keeps the shipped set when nothing is uploaded', () => {
        const merged = mergeDescriptors(shippedDescriptors(), [])
        expect(merged.map((entry) => entry.source)).toEqual(
            shippedDescriptors().map(() => 'built-in')
        )
    })

    it('replaces a shipped descriptor and appends other uploads', () => {
        const edited = {
            ...ping,
            metadata: { ...ping.metadata, name: 'Edited ping' },
        }
        const merged = mergeDescriptors(shippedDescriptors(), [
            edited,
            renamed('Pong'),
        ])

        expect(
            merged.find(
                (entry) =>
                    entry.descriptor.context.template.entityName === 'Ping'
            )
        ).toMatchObject({
            source: 'replaces built-in',
            descriptor: { metadata: { name: 'Edited ping' } },
        })
        expect(merged.at(-1)).toMatchObject({
            source: 'uploaded',
            descriptor: { metadata: { name: 'Pong' } },
        })
        expect(
            merged.filter((entry) => entry.source === 'built-in')
        ).toHaveLength(shippedDescriptors().length - 1)
    })

    it('lets a later upload for the same template win', () => {
        const merged = mergeDescriptors(shippedDescriptors(), [
            renamed('Pong', 'first'),
            renamed('Pong', 'second'),
        ])
        const uploads = merged.filter((entry) => entry.source === 'uploaded')
        expect(uploads).toHaveLength(1)
        expect(uploads[0]?.descriptor.metadata.name).toBe('second')
    })
})

describe('templateKeyOf', () => {
    it('reads the template the upload replaces', () => {
        expect(templateKeyOf(ping)).toBe(
            `${ping.context.template.packageId}:${ping.context.template.moduleName}:${ping.context.template.entityName}`
        )
    })

    it('rejects a descriptor that does not name a template', () => {
        expect(() => templateKeyOf({ context: { template: {} } })).toThrow(
            /no template/
        )
        expect(() =>
            templateKeyOf({
                context: {
                    template: {
                        packageId: '',
                        moduleName: 'M',
                        entityName: 'E',
                    },
                },
            })
        ).toThrow(/no template/)
    })
})
