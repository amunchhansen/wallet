// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    type Descriptor,
    parseDescriptor,
    shippedDescriptors,
    templateKey,
} from '@canton-network/core-tx-clear-signing'
import { VERSION_PREFIX } from './state-manager.js'

// Uploaded descriptors are kept in this browser only. They are unverified, and are used only to
// describe transactions on the approve page here; the gateway's own check uses the built-in set.
// The key must carry the app's prefix, or StateManager deletes it when a page loads.
const STORAGE_KEY = `${VERSION_PREFIX}.clear-signing-descriptors`

export type DescriptorSource = 'built-in' | 'uploaded' | 'replaces built-in'

export interface ActiveDescriptor {
    descriptor: Descriptor
    source: DescriptorSource
}

/** The uploaded descriptors that still parse. One that does not is skipped, so it cannot break approval. */
export function uploadedDescriptors(): Descriptor[] {
    const parsed: Descriptor[] = []
    for (const json of readStored()) {
        try {
            parsed.push(parseDescriptor(json))
        } catch (error) {
            console.warn('Skipping an uploaded descriptor:', error)
        }
    }
    return parsed
}

/**
 * Validates and stores a descriptor. An earlier upload for the same template is replaced.
 *
 * @throws DescriptorError when the JSON is not a valid descriptor
 */
export function addDescriptor(json: unknown): Descriptor {
    const descriptor = parseDescriptor(json)
    const key = keyOf(descriptor)
    const others = readStored().filter((stored) => storedKey(stored) !== key)
    writeStored([...others, json])
    return descriptor
}

export function removeDescriptor(descriptor: Descriptor): void {
    const key = keyOf(descriptor)
    writeStored(readStored().filter((stored) => storedKey(stored) !== key))
}

/**
 * The descriptors the approve page describes transactions with: the built-in ones, each replaced by an
 * upload for the same template, followed by the other uploads. At most one per template, as
 * `clearSign` requires.
 */
export function activeDescriptors(): ActiveDescriptor[] {
    const uploads = new Map(uploadedDescriptors().map((d) => [keyOf(d), d]))
    const active: ActiveDescriptor[] = shippedDescriptors().map((builtIn) => {
        const key = keyOf(builtIn)
        const upload = uploads.get(key)
        uploads.delete(key)
        return upload
            ? { descriptor: upload, source: 'replaces built-in' }
            : { descriptor: builtIn, source: 'built-in' }
    })
    for (const descriptor of uploads.values()) {
        active.push({ descriptor, source: 'uploaded' })
    }
    return active
}

function readStored(): unknown[] {
    try {
        const parsed: unknown = JSON.parse(
            localStorage.getItem(STORAGE_KEY) ?? '[]'
        )
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

function writeStored(entries: unknown[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

function keyOf({ context }: Descriptor): string {
    return templateKey(context.template)
}

// The template key of a stored entry, or undefined when it no longer parses.
function storedKey(json: unknown): string | undefined {
    try {
        return keyOf(parseDescriptor(json))
    } catch {
        return undefined
    }
}
