// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    shippedDescriptors,
    templateKey,
    type Descriptor,
    type TemplateRef,
} from '@canton-network/core-tx-clear-signing'

let bundled: Map<string, Descriptor> | undefined

// Parsed on first use, so that a broken descriptor fails the clear-signing view, not the whole page.
function bundledDescriptors(): Map<string, Descriptor> {
    bundled ??= new Map(
        shippedDescriptors().map((descriptor) => [
            templateKey(descriptor.context.template),
            descriptor,
        ])
    )
    return bundled
}

/**
 * The clear-signing descriptors the gateway has for the given templates. Templates without one are
 * left out; the transaction view then marks those operations as undescribed.
 */
export function resolveDescriptors(templates: TemplateRef[]): Descriptor[] {
    const descriptors = bundledDescriptors()
    return templates.flatMap((template) => {
        const descriptor = descriptors.get(templateKey(template))
        return descriptor ? [descriptor] : []
    })
}
