// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Descriptor } from '@canton-network/core-tx-clear-signing'

export type DescriptorSource = 'built-in' | 'uploaded' | 'replaces built-in'

export interface ActiveDescriptor {
    descriptor: Descriptor
    source: DescriptorSource
}

interface TemplateId {
    packageId: string
    moduleName: string
    entityName: string
}

/**
 * `packageId:moduleName:entityName` of a descriptor, the key an upload replaces and `clearSign` binds
 * by. This only checks that the three strings are present. `clearSign` validates the rest.
 *
 * @throws Error when `context.template` does not name a template
 */
export function templateKeyOf(json: unknown): string {
    const template = templateOf(json)
    if (!template) {
        throw new Error(
            'descriptor has no template: context.template needs packageId, moduleName and entityName'
        )
    }
    return templateKey(template)
}

/**
 * The shipped descriptors, each replaced by an upload for the same template, followed by the other
 * uploads. At most one per template: `clearSign` reports a template with two as invalid.
 */
export function mergeDescriptors(
    shipped: readonly Descriptor[],
    uploaded: readonly unknown[]
): ActiveDescriptor[] {
    const uploads = new Map<string, Descriptor>()
    for (const json of uploaded) {
        uploads.set(templateKeyOf(json), json as Descriptor)
    }
    const active: ActiveDescriptor[] = shipped.map((builtIn) => {
        const key = templateKeyOf(builtIn)
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

function templateOf(json: unknown): TemplateId | undefined {
    if (typeof json !== 'object' || json === null) return undefined
    const context = (json as { context?: unknown }).context
    if (typeof context !== 'object' || context === null) return undefined
    const template = (context as { template?: unknown }).template
    if (typeof template !== 'object' || template === null) return undefined
    const fields = template as Record<string, unknown>
    const packageId = nonEmpty(fields.packageId)
    const moduleName = nonEmpty(fields.moduleName)
    const entityName = nonEmpty(fields.entityName)
    if (!packageId || !moduleName || !entityName) return undefined
    return { packageId, moduleName, entityName }
}

function templateKey(template: TemplateId): string {
    return `${template.packageId}:${template.moduleName}:${template.entityName}`
}

function nonEmpty(value: unknown): string | undefined {
    if (typeof value !== 'string' || value === '') return undefined
    return value
}
