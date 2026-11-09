// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// The simulated transactions of splice-contracts.test.ts: exercises that the local ledger cannot
// prepare, because their choice bodies need AmuletRules, mining rounds or holdings.

import {
    ALICE,
    BOB,
    DSO,
    INTERFACES,
    LOCK_MANAGER,
    PROVIDER,
    REASON_KEY,
    capturedAllocationV2,
    cid,
    decimal,
    extraArgs,
    fakeCid,
    list,
    metadata,
    none,
    party,
    record,
    simulate,
    some,
    text,
    timestamp,
    variant,
} from './splice.js'

const amuletId = record({ admin: party(DSO), id: text('Amulet') })
const lockContext = extraArgs({
    'amulet-rules': variant('AV_ContractId', cid(fakeCid(1))),
    'open-round': variant('AV_ContractId', cid(fakeCid(2))),
})

// CIP-127: the lock request is a memo in the transfer's reason, sent to the lock manager.
export const UNLOCK_MEMO = `cip-127/memo:request=unlock-and-start-vesting&lock-kind=fa-lock&lock-subject=${PROVIDER}&unlock-amount=500.0`
export const CREATE_LOCK_MEMO = `cip-127/memo:request=create-lock&lock-kind=fa-lock&lock-subject=${PROVIDER}`

const v1Transfer = (receiver: string, amount: string, memo: string) =>
    record({
        sender: party(ALICE),
        receiver: party(receiver),
        amount: decimal(amount),
        instrumentId: amuletId,
        requestedAt: timestamp('2026-11-09T10:00:00Z'),
        executeBefore: timestamp('2026-11-10T10:00:00Z'),
        inputHoldingCids: list(cid(fakeCid(3))),
        meta: metadata({ [REASON_KEY]: memo }),
    })

const account = (owner: string) =>
    record({ owner: some(party(owner)), provider: none, id: text('') })

export const simulated = {
    'gl-substitution-accept-v1': () =>
        simulate({
            contract: 'gl-substitution-create-fa-vesting',
            choiceId: 'TransferInstruction_Accept',
            interfaceId: INTERFACES.transferInstructionV1,
            actingParties: [ALICE],
            chosenValue: record({ extraArgs: lockContext }),
        }),
    'gl-substitution-accept-v2': () =>
        simulate({
            contract: 'gl-substitution-create-fa-vesting',
            choiceId: 'TransferInstruction_Accept',
            interfaceId: INTERFACES.transferInstructionV2,
            actingParties: [ALICE],
            chosenValue: record({
                actors: list(party(ALICE)),
                extraArgs: lockContext,
            }),
        }),
    'gl-substitution-reject-sv': () =>
        simulate({
            contract: 'gl-substitution-create-sv-full',
            choiceId: 'TransferInstruction_Reject',
            interfaceId: INTERFACES.transferInstructionV2,
            actingParties: [ALICE],
            chosenValue: record({
                actors: list(party(ALICE)),
                extraArgs: extraArgs(),
            }),
        }),
    'epar-transfer-v1-unlock': () =>
        simulate({
            contract: 'external-party-amulet-rules-create',
            choiceId: 'TransferFactory_Transfer',
            interfaceId: INTERFACES.transferFactoryV1,
            actingParties: [ALICE],
            chosenValue: record({
                expectedAdmin: party(DSO),
                transfer: v1Transfer(LOCK_MANAGER, '1.0', UNLOCK_MEMO),
                extraArgs: lockContext,
            }),
        }),
    'epar-transfer-v2-create-lock': () =>
        simulate({
            contract: 'external-party-amulet-rules-create',
            choiceId: 'TransferFactory_Transfer',
            interfaceId: INTERFACES.transferFactoryV2,
            actingParties: [ALICE],
            chosenValue: record({
                transfer: record({
                    sender: account(ALICE),
                    receiver: account(LOCK_MANAGER),
                    amount: decimal('10000.0'),
                    instrumentId: amuletId,
                    requestedAt: timestamp('2026-11-09T10:00:00Z'),
                    executeBefore: timestamp('2026-11-10T10:00:00Z'),
                    inputHoldingCids: list(cid(fakeCid(3))),
                    meta: metadata({ [REASON_KEY]: CREATE_LOCK_MEMO }),
                }),
                actors: list(party(ALICE)),
                extraArgs: lockContext,
            }),
        }),
    'epar-allocate-v1': () =>
        simulate({
            contract: 'external-party-amulet-rules-create',
            choiceId: 'AllocationFactory_Allocate',
            interfaceId: INTERFACES.allocationFactoryV1,
            actingParties: [ALICE],
            chosenValue: record({
                expectedAdmin: party(DSO),
                allocation: record({
                    settlement: record({
                        executor: party(PROVIDER),
                        settlementRef: record({
                            id: text('trade-7'),
                            cid: none,
                        }),
                        requestedAt: timestamp('2026-11-09T10:00:00Z'),
                        allocateBefore: timestamp('2026-11-10T10:00:00Z'),
                        settleBefore: timestamp('2026-11-11T10:00:00Z'),
                        meta: metadata({}),
                    }),
                    transferLegId: text('leg0'),
                    transferLeg: record({
                        sender: party(ALICE),
                        receiver: party(BOB),
                        amount: decimal('75.0'),
                        instrumentId: amuletId,
                        meta: metadata({}),
                    }),
                }),
                requestedAt: timestamp('2026-11-09T10:00:00Z'),
                inputHoldingCids: list(cid(fakeCid(3))),
                extraArgs: extraArgs(),
            }),
        }),
    'epar-allocate-v2': () => {
        const { value, interfaceId } = capturedAllocationV2()
        return simulate({
            contract: 'external-party-amulet-rules-create',
            choiceId: 'AllocationFactory_Allocate',
            interfaceId,
            actingParties: [ALICE],
            chosenValue: value,
        })
    },
    'wallet-user-proxy-transfer': () =>
        simulate({
            contract: 'wallet-user-proxy-create',
            choiceId: 'WalletUserProxy_TransferFactory_Transfer',
            actingParties: [ALICE],
            chosenValue: record({
                cid: cid(fakeCid(4)),
                proxyArg: record({
                    user: party(ALICE),
                    choiceArg: record({
                        expectedAdmin: party(DSO),
                        transfer: v1Transfer(BOB, '30.0', 'Concert tickets'),
                        extraArgs: extraArgs(),
                    }),
                    featuredAppRightCid: cid(fakeCid(5)),
                }),
            }),
        }),
    'preapproval-send-v2-memo': () =>
        simulate({
            contract: 'transfer-preapproval-create',
            choiceId: 'TransferPreapproval_SendV2',
            actingParties: [ALICE],
            chosenValue: record({
                context: record({
                    externalPartyConfigState: cid(fakeCid(6)),
                    featuredAppRight: none,
                }),
                inputs: list(
                    variant('InputAmulet', cid(fakeCid(7))),
                    variant('InputAmulet', cid(fakeCid(8)))
                ),
                amount: decimal('25.0'),
                sender: party(ALICE),
                description: some(text('Rent')),
                meta: some(metadata({ [REASON_KEY]: 'Rent for November' })),
            }),
        }),
    'preapproval-send-v2-plain': () =>
        simulate({
            contract: 'transfer-preapproval-create',
            choiceId: 'TransferPreapproval_SendV2',
            actingParties: [ALICE],
            chosenValue: record({
                context: record({
                    externalPartyConfigState: cid(fakeCid(6)),
                    featuredAppRight: none,
                }),
                inputs: list(variant('InputAmulet', cid(fakeCid(7)))),
                amount: decimal('25.0'),
                sender: party(ALICE),
                description: none,
                meta: none,
            }),
        }),
} satisfies Record<string, () => string>
