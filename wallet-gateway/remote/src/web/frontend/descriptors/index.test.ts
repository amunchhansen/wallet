// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixture } from '@open-wc/testing-helpers'
import { html } from 'lit'
import { shippedDescriptors } from '@canton-network/core-tx-clear-signing'

vi.mock('../index.js', () => ({}))
vi.mock('../utils.js', () => ({ showToast: vi.fn() }))

import './index.js'
import type { UserUiDescriptors } from './index.js'

const builtInPing = shippedDescriptors().find(
    (d) => d.context.template.entityName === 'Ping'
)!
const pong = {
    ...builtInPing,
    context: {
        template: { ...builtInPing.context.template, entityName: 'Pong' },
    },
    metadata: { ...builtInPing.metadata, name: 'Uploaded pong' },
}

async function render(): Promise<UserUiDescriptors> {
    return fixture<UserUiDescriptors>(
        html`<user-ui-descriptors></user-ui-descriptors>`
    )
}

async function paste(el: UserUiDescriptors, text: string) {
    el.pasted = text
    await el.updateComplete
    const add = [...el.shadowRoot!.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Add'
    )!
    add.click()
    await el.updateComplete
}

describe('descriptors page', () => {
    afterEach(() => {
        localStorage.clear()
    })

    it('lists the built-in descriptors without a delete button', async () => {
        const el = await render()
        const cards = el.shadowRoot!.querySelectorAll('section.descriptor')
        expect(cards).toHaveLength(shippedDescriptors().length)
        expect(el.shadowRoot!.textContent).toContain('built-in')
        expect(el.shadowRoot!.textContent).not.toContain('Delete')
    })

    it('adds pasted JSON, lists it as uploaded and deletes it', async () => {
        const el = await render()
        await paste(el, JSON.stringify(pong))

        expect(el.problems).toEqual([])
        expect(el.pasted).toBe('')
        const card = [
            ...el.shadowRoot!.querySelectorAll('section.descriptor'),
        ].find((c) => c.textContent?.includes('Uploaded pong'))!
        expect(card.textContent).toContain('uploaded')

        const remove = [...card.querySelectorAll('button')].find(
            (b) => b.textContent?.trim() === 'Delete'
        )!
        remove.click()
        await el.updateComplete
        expect(el.shadowRoot!.textContent).not.toContain('Uploaded pong')
    })

    it('shows why a descriptor is rejected', async () => {
        const el = await render()
        await paste(el, JSON.stringify({ ...pong, display: {} }))

        expect(
            el.shadowRoot!.querySelector('.alert-danger')?.textContent
        ).toContain('display needs create or exercises')

        await paste(el, '{ not json')
        expect(el.problems).toEqual(['pasted JSON: not valid JSON'])
    })
})
