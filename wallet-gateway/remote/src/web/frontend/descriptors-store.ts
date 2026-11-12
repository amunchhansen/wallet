// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    mergeDescriptors,
    shippedDescriptors,
    templateKeyOf,
    type ActiveDescriptor,
    type Descriptor,
} from '@canton-network/core-wallet-services/clear-signing'
import { VERSION_PREFIX } from './state-manager.js'

export type { ActiveDescriptor, Descriptor }

// Uploaded descriptors are unverified and stay in this browser. They only change how the approve
// page here describes a transaction. The key must carry the app's prefix, or StateManager deletes
// it when a page loads.
const STORAGE_KEY = `${VERSION_PREFIX}.clear-signing-descriptors`

/** The uploaded descriptors that name a template. One that does not is skipped, so it cannot break approval. */
export function uploadedDescriptors(): Descriptor[] {
    const parsed: Descriptor[] = []
    for (const json of readStored()) {
        try {
            templateKeyOf(json)
            parsed.push(json as Descriptor)
        } catch (error) {
            console.warn('Skipping an uploaded descriptor:', error)
        }
    }
    return parsed
}

/**
 * Stores a descriptor. An earlier upload for the same template is replaced.
 *
 * @throws Error when the JSON does not name a template
 */
export function addDescriptor(json: unknown): Descriptor {
    const key = templateKeyOf(json)
    const others = readStored().filter((stored) => storedKey(stored) !== key)
    writeStored([...others, json])
    return json as Descriptor
}

export function removeDescriptor(descriptor: Descriptor): void {
    const key = templateKeyOf(descriptor)
    writeStored(readStored().filter((stored) => storedKey(stored) !== key))
}

/**
 * The descriptors the approve page describes transactions with: the built-in ones, each replaced by an
 * upload for the same template, followed by the other uploads. At most one per template, as
 * `clearSign` requires.
 */
export function activeDescriptors(): ActiveDescriptor[] {
    return mergeDescriptors(shippedDescriptors(), uploadedDescriptors())
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

function storedKey(json: unknown): string | undefined {
    try {
        return templateKeyOf(json)
    } catch {
        return undefined
    }
}
