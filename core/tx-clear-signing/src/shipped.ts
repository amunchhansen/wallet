// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import bong from './descriptors/bong.json'
import bongProposal from './descriptors/bong-proposal.json'
import collapse from './descriptors/collapse.json'
import explode from './descriptors/explode.json'
import externalPartyAmuletRules from './descriptors/external-party-amulet-rules.json'
import merge from './descriptors/merge.json'
import ping from './descriptors/ping.json'
import { parseDescriptor, type Descriptor } from './descriptor.js'

let cached: readonly Descriptor[] | undefined

/**
 * The clear-signing descriptors shipped with this build. A prepared transaction is fully described
 * only when every root matches one of these, by package ID, module and entity.
 */
export function shippedDescriptors(): readonly Descriptor[] {
    cached ??= Object.freeze([
        parseDescriptor(ping),
        parseDescriptor(bongProposal),
        parseDescriptor(explode),
        parseDescriptor(merge),
        parseDescriptor(collapse),
        parseDescriptor(bong),
        parseDescriptor(externalPartyAmuletRules),
    ])
    return cached
}
