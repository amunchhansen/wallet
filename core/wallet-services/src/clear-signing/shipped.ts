// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Descriptor } from '@canton-network/core-tx-clear-signing'
import bong from './descriptors/bong.json'
import bongProposal from './descriptors/bong-proposal.json'
import collapse from './descriptors/collapse.json'
import explode from './descriptors/explode.json'
import externalPartyAmuletRules from './descriptors/external-party-amulet-rules.json'
import merge from './descriptors/merge.json'
import ping from './descriptors/ping.json'

// `clearSign` validates. These are cast, so a descriptor that drifts from the schema is reported on
// the root it binds to when a transaction is described.
const shipped: readonly Descriptor[] = Object.freeze([
    asDescriptor(ping),
    asDescriptor(bongProposal),
    asDescriptor(explode),
    asDescriptor(merge),
    asDescriptor(collapse),
    asDescriptor(bong),
    asDescriptor(externalPartyAmuletRules),
])

/**
 * The descriptors bundled with the wallet gateways. A caller merges uploads over this set, selects
 * the ones a transaction uses, and passes that list to `clearSign`.
 */
export function shippedDescriptors(): readonly Descriptor[] {
    return shipped
}

function asDescriptor(json: unknown): Descriptor {
    return json as Descriptor
}
