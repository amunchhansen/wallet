// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import ping from './descriptors/ping.json'
import { parseDescriptor, type Descriptor } from './descriptor.js'

let cached: Descriptor[] | undefined

/**
 * The clear-signing descriptors shipped with this build. A prepared transaction is fully described
 * only when every root matches one of these, by package ID, module and entity.
 */
export function shippedDescriptors(): Descriptor[] {
    cached ??= [parseDescriptor(ping)]
    return cached
}
