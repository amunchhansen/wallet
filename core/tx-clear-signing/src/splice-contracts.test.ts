// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Clear signing on Splice contracts chosen for their awkward shapes: repeated field names, variants,
// optionals, tuples, maps and V1/V2 interface choices with the same name. Each test pins what the
// wallet shows, including the fields that fail. mpa documentation/clearsigning/
// splice-contract-verification.md explains each result.

import { describe, expect, it } from 'vitest'
import { HashingSchemeVersion } from '@canton-network/core-ledger-proto'
import { computePreparedTransactionHash } from '@canton-network/core-tx-hashing'
import { toBase64 } from './bytes.js'
import type { OperationDescription } from './clear-sign.js'
import {
    described,
    descriptorsForRoots,
    intentText,
} from './__tests__/helpers.js'
import {
    ALICE,
    BOB,
    DSO,
    LOCK_MANAGER,
    PROVIDER,
    REASON_KEY,
    captured,
    capturedIds,
    spliceDescriptors,
} from './__tests__/splice.js'
import {
    CREATE_LOCK_MEMO,
    UNLOCK_MEMO,
    simulated,
} from './__tests__/splice-scenarios.js'

async function describeOne(
    preparedTransaction: string
): Promise<OperationDescription> {
    const { operations } = await describedSplice(preparedTransaction)
    expect(operations).toHaveLength(1)
    return operations[0]!
}

const describeCaptured = (id: string) =>
    describeOne(captured(id).preparedTransaction)

function describedSplice(preparedTransaction: string) {
    return described(
        preparedTransaction,
        descriptorsForRoots(preparedTransaction, spliceDescriptors)
    )
}

type Field = OperationDescription['fields'][number]

/** Each field as label → value, `None (absent)` or `error: …`. */
function fields(op: OperationDescription): Record<string, string> {
    return Object.fromEntries(op.fields.map((f) => [f.label, show(f)]))
}

function show(f: Field): string {
    if (f.absent) return `${f.value} (absent)`
    return f.value ?? `error: ${f.error}`
}

describe('captured fixtures', () => {
    it.each(capturedIds)(
        '%s is the transaction the ledger hashed',
        async (id) => {
            const fixture = captured(id)
            const scheme =
                fixture.hashingSchemeVersion === 'HASHING_SCHEME_VERSION_V3'
                    ? HashingSchemeVersion.V3
                    : HashingSchemeVersion.V2
            const hash = toBase64(
                await computePreparedTransactionHash(
                    fixture.preparedTransaction,
                    scheme
                )
            )
            expect(hash).toBe(fixture.preparedTransactionHash)
        }
    )

    it('needs hashing scheme V3 for a template with a contract key', async () => {
        expect(captured('gl-lock-create').hashingSchemeVersion).toBe(
            'HASHING_SCHEME_VERSION_V3'
        )
    })
})

describe('governance locks', () => {
    it('shows a vesting lock whole, with its constructor as the raw key', async () => {
        const op = await describeCaptured('gl-substitution-create-fa-vesting')
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(
            `Propose substituting 250.0000000000 of the governance lock of ${ALICE}, proposed by ${BOB}`
        )
        expect(fields(op)).toEqual({
            Amount: '250.0000000000',
            'Lock owner': ALICE,
            'Proposed by': BOB,
            'Lock type': expect.any(String),
            Funding: expect.stringMatching(/^003dc46d/),
            Expires: '2026-11-16T16:29:58Z',
            // A trailing None field is not in the prepared transaction; its None case is marked as inferred
            'First proposal': 'None (absent)',
        })
        expect(JSON.parse(fields(op)['Lock type']!)).toEqual({
            GLS_VestingLock: {
                kind: { GLK_FeaturedApp: { provider: PROVIDER } },
                vestingPeriod: '60d',
                endTime: '2027-01-08T16:29:55Z',
            },
        })
    })

    it('shows a full lock whole, and a non-trailing None', async () => {
        const op = await describeCaptured('gl-substitution-create-sv-full')
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(
            `Propose substituting 250.0000000000 of the governance lock of ${ALICE}, proposed by ${ALICE}`
        )
        const shown = fields(op)
        expect(shown.Funding).toBe('None')
        expect(JSON.parse(shown['Lock type']!)).toEqual({
            GLS_FullLock: {
                kind: { GLK_SuperValidatorRightsOwner: { svName: 'sv-1' } },
            },
        })
    })

    it('describes a lock with a contract key', async () => {
        const op = await describeCaptured('gl-lock-create')
        expect(intentText(op)).toBe(
            `Create a governance lock of 10000.0000000000 for ${ALICE}`
        )
        expect(JSON.parse(fields(op)['Lock type']!)).toEqual({
            GLS_FullLock: {
                kind: { GLK_ProvisionalFeaturedApp: { provider: PROVIDER } },
            },
        })
    })

    it('keeps source.owner apart from receiver', async () => {
        const op = await describeCaptured('gl-transfer-create')
        expect(intentText(op)).toBe(
            `Transfer 100.0000000000 of the governance locks of ${ALICE} to ${BOB}`
        )
        expect(Object.keys(JSON.parse(fields(op)['Lock type']!))).toEqual([
            'GLS_VestingLock',
        ])
    })

    it('words V1 and V2 accepts the same, each from its own entry', async () => {
        const v1 = await describeOne(simulated['gl-substitution-accept-v1']())
        const v2 = await describeOne(simulated['gl-substitution-accept-v2']())
        const sentence = `Accept the substitution of 250.0000000000 of the governance lock of ${ALICE}, proposed by ${BOB}`
        expect([v1.status, v2.status]).toEqual(['described', 'described'])
        expect(intentText(v1)).toBe(sentence)
        expect(intentText(v2)).toBe(sentence)
        expect(v1.interface?.moduleName).toBe(
            'Splice.Api.Token.TransferInstructionV1'
        )
        expect(v2.interface?.moduleName).toBe(
            'Splice.Api.Token.TransferInstructionV2'
        )
        expect(v1.descriptor?.name).toBe('Governance lock substitution')
        expect(v2.descriptor?.name).toBe(v1.descriptor?.name)
        // Only V2 has actors
        expect(fields(v1)).not.toHaveProperty('Actors')
        expect(fields(v2).Actors).toBe(JSON.stringify([ALICE]))
    })

    it('rejects through V2 on an SV lock', async () => {
        const op = await describeOne(simulated['gl-substitution-reject-sv']())
        expect(intentText(op)).toBe(
            `Reject the substitution of 250.0000000000 proposed by ${ALICE}`
        )
    })

    it('describes a captured V1 reject through the interface', async () => {
        const op = await describeCaptured('gl-transfer-reject-v1')
        expect(op.status).toBe('described')
        expect(op.interface?.entityName).toBe('TransferInstruction')
        expect(intentText(op)).toBe(
            `Reject 100.0000000000 of governance locks from ${BOB}`
        )
    })
})

describe('governance lock requests through the transfer factory', () => {
    const METADATA = 'Metadata, which the receiver may act on'
    const request = (amount: string) =>
        `Request a transfer of ${amount} Amulet from ${ALICE} to ${LOCK_MANAGER}. What the receiver does with it depends on the transfer's metadata`

    it('words an unlock request as a requested transfer, with the request in the metadata', async () => {
        const op = await describeOne(simulated['epar-transfer-v1-unlock']())
        expect(op.status).toBe('described')
        // The contract ignores this amount for an unlock; the sentence calls it requested and
        // points to the metadata, which shows the request whole
        expect(op.interface?.moduleName).toBe(
            'Splice.Api.Token.TransferInstructionV1'
        )
        expect(intentText(op)).toBe(request('1.0000000000'))
        expect(fields(op)).toEqual({
            'Requested amount': '1.0000000000',
            Instrument: 'Amulet',
            From: ALICE,
            To: LOCK_MANAGER,
            [METADATA]: JSON.stringify({ [REASON_KEY]: UNLOCK_MEMO }),
            'Execute before': '2026-11-10T10:00:00Z',
            'Expected admin': DSO,
        })
    })

    it('words V2 the same, from its own entry; its sender and receiver are accounts', async () => {
        const op = await describeOne(
            simulated['epar-transfer-v2-create-lock']()
        )
        expect(op.status).toBe('described')
        expect(op.interface?.moduleName).toBe(
            'Splice.Api.Token.TransferInstructionV2'
        )
        expect(intentText(op)).toBe(request('10000.0000000000'))
        expect(fields(op)).toMatchObject({
            From: ALICE,
            To: LOCK_MANAGER,
            'From account': JSON.stringify({
                owner: ALICE,
                provider: null,
                id: '',
            }),
            [METADATA]: JSON.stringify({ [REASON_KEY]: CREATE_LOCK_MEMO }),
            Actors: JSON.stringify([ALICE]),
        })
    })
})

describe('V1 and V2 AllocationFactory_Allocate each have their own entry', () => {
    it('describes V2', async () => {
        const tx = simulated['epar-allocate-v2']()
        const op = await describeOne(tx)
        expect(op.status).toBe('described')
        expect(op.interface?.moduleName).toBe(
            'Splice.Api.Token.AllocationInstructionV2'
        )
        expect(fields(op)).toMatchObject({
            'Amulet administrator': DSO,
            'Number of legs': '2',
        })
        expect((await describedSplice(tx)).complete).toBe(true)
    })

    it('describes V1', async () => {
        const tx = simulated['epar-allocate-v1']()
        const op = await describeOne(tx)
        expect(op.status).toBe('described')
        expect(op.interface?.moduleName).toBe(
            'Splice.Api.Token.AllocationInstructionV1'
        )
        expect(intentText(op)).toBe(
            `Allocate 75.0000000000 Amulet from ${ALICE} to ${BOB} for settlement trade-7, executed by ${PROVIDER}`
        )
        expect((await describedSplice(tx)).complete).toBe(true)
    })
})

describe('DSO governance', () => {
    it('shows a SetConfig vote whole, with the action constructor in the raw value', async () => {
        const op = await describeCaptured('dso-request-vote-set-config')
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(
            `Request a vote by ${ALICE}: Raise maxTextLength`
        )
        expect(fields(op)).toMatchObject({
            'Voting period': '3d',
            'Effective at': 'None (absent)',
        })
        const action = JSON.parse(fields(op)['Votes on']!)
        const setConfig = action.ARC_DsoRules.dsoAction.SRARC_SetConfig
        expect(setConfig.newConfig.maxTextLength).toBe('2048')
        expect(setConfig.baseConfig.maxTextLength).toBe('1024')
        expect(setConfig.newConfig.voteCooldownTime).toBe('1m')
        expect(
            setConfig.newConfig.svOperationsSwitchOverTimes['cip-0104']
        ).toBe('2026-11-19T16:29:56Z')
    })

    it('shows tuples, Sets and an enum inside an amulet config schedule shown whole', async () => {
        const op = await describeCaptured('dso-request-vote-amulet-schedule')
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(
            `Request a vote by ${ALICE}: New traffic price`
        )
        expect(fields(op)['Voting period']).toBe('None')
        const action = JSON.parse(fields(op)['Votes on']!)
        const schedule =
            action.ARC_AmuletRules.amuletRulesAction
                .CRARC_AddFutureAmuletConfigSchedule
        const config = schedule.newScheduleItem._2
        expect(config.decentralizedSynchronizer.fees.extraTrafficPrice).toBe(
            '16.6700000000'
        )
        expect(
            config.decentralizedSynchronizer.fees.baseRateTrafficLimits
                .burstWindow
        ).toBe('20m')
        expect(config.decentralizedSynchronizer.requiredSynchronizers).toEqual({
            map: [['global-domain::1220c0ffee', '()']],
        })
        expect(config.transferConfig.transferFee.steps).toEqual([
            { _1: '100.0000000000', _2: '0.0000000000' },
            { _1: '1000.0000000000', _2: '0.0000000000' },
        ])
        // raw shows the enum constructor, not the descriptor's enum table
        expect(config.rewardConfig.mintingVersion).toBe(
            'RewardVersion_TrafficBasedAppRewards'
        )
    })

    it('keeps sibling optional configs with the same field names apart', async () => {
        const op = await describeCaptured('dso-set-synchronizer-node-config')
        expect(op.status).toBe('described')
        expect(fields(op)).toMatchObject({
            'Sequencer URL': 'https://sequencer.example.com',
            'Sequencer migration': '3',
            'Legacy sequencer URL': 'https://legacy-sequencer.example.com',
            'Legacy sequencer migration': '2',
            'Sequencer identity available after': 'None (absent)',
            'Mediator ID': 'MED::current',
            'Public URL': 'https://scan.example.com',
            'Governance keys': '1',
            'Physical synchronizers':
                '[["1",{"sequencer":{"url":"https://psid-1.example.com"}}]]',
        })
    })

    it('shows a GenMap keyed by text only as a whole', async () => {
        const op = await describeCaptured('vote-request-create')
        expect(intentText(op)).toMatch(/^Vote by sv-1, open until /)
        const action = JSON.parse(fields(op)['Votes on']!)
        expect(
            action.ARC_DsoRules.dsoAction.SRARC_SetConfig.newConfig
                .maxTextLength
        ).toBe('2048')
        expect(fields(op).Votes).toMatch(/^\[\["sv-1",\{"sv":/)
        expect(fields(op).Tracking).toBe('None (absent)')
    })
})

describe('wallet and apps', () => {
    it('reads amount.amount and an enum unit', async () => {
        const op = await describeCaptured('transfer-offer-create')
        expect(intentText(op)).toBe(`Offer 12.5000000000 USD to ${BOB}: Lunch`)
    })

    it('words a choice without arguments from the contract alone', async () => {
        const op = await describeCaptured('transfer-offer-accept')
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(`Accept 12.5000000000 USD from ${ALICE}`)
        expect(fields(op)).toEqual({
            Amount: '12.5000000000',
            Unit: 'USD',
            From: ALICE,
        })
    })

    it('formats an optional enum as Some, and counts an optional list', async () => {
        const op = await describeCaptured('featured-app-right-create')
        expect(fields(op)).toMatchObject({
            Kind: 'Asset mover',
            'Activity weight': '2.5000000000',
            'Number of operational parties': '1',
        })
        expect(op.fields.find((f) => f.label === 'Kind')).toMatchObject({
            value: 'Asset mover',
            enumKey: 'FAK_AssetMoving',
            format: 'enum',
        })
    })

    it('words V1 and V2 activity markers the same; weight is V2 only', async () => {
        const v1 = await describeCaptured('activity-marker-v1')
        const v2 = await describeCaptured('activity-marker-v2')
        expect(intentText(v1)).toBe(
            `Record activity of ${PROVIDER} for 2 beneficiaries`
        )
        expect(fields(v1)).not.toHaveProperty('Weight')
        expect(fields(v2).Weight).toBe('3.0000000000')
    })

    it('indexes a TextMap of records with a quoted key', async () => {
        const op = await describeCaptured('otc-trade-proposal-create')
        expect(intentText(op)).toBe(
            `Trade 100.0000000000 Amulet from ${ALICE} to ${BOB}, one of 2 legs`
        )
        expect(fields(op)['Leg 0 note']).toBe('csalice pays')
    })

    it('counts the legs of the contract an accept acts on', async () => {
        const op = await describeCaptured('otc-trade-proposal-accept')
        expect(intentText(op)).toBe(
            `Approve, as ${BOB}, a trade of 2 legs at ${PROVIDER}`
        )
    })

    it('reads the label of a positional newtype, and shows each update whole', async () => {
        const transfer = await describeCaptured(
            'balance-update-create-transfer'
        )
        const netting = await describeCaptured('balance-update-create-netting')
        expect(intentText(transfer)).toBe(
            `Record a balance update in group flatmates of ${ALICE}`
        )
        expect(intentText(netting)).toBe(
            `Record a balance update in group flatmates of ${ALICE}`
        )
        expect(fields(transfer).Group).toBe('flatmates')
        expect(JSON.parse(fields(transfer).Update!)).toMatchObject({
            Transfer: { sender: BOB, amount: '42.0000000000' },
        })
        expect(JSON.parse(fields(netting).Update!)).toEqual({
            Netting: {
                balanceChanges: [
                    [
                        ALICE,
                        [
                            [ALICE, '-5.0000000000'],
                            [BOB, '5.0000000000'],
                        ],
                    ],
                ],
            },
        })
    })

    it('counts a list of variants, and shows it only as a whole', async () => {
        const op = await describeCaptured('batching-utility-execute')
        expect(intentText(op)).toBe(
            `Execute 2 token standard actions as ${ALICE}`
        )
        const actions = JSON.parse(fields(op).Actions!) as object[]
        expect(actions.map((a) => Object.keys(a)[0])).toEqual([
            'TSA_TransferInstruction_RejectV1',
            'TSA_TransferInstruction_RejectV2',
        ])
    })

    it('reads five levels into a generic proxy argument', async () => {
        const op = await describeOne(simulated['wallet-user-proxy-transfer']())
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(
            `Transfer 30.0000000000 Amulet from ${ALICE} to ${BOB} via ${PROVIDER}`
        )
    })

    it('shows an optional Metadata whole', async () => {
        const op = await describeOne(simulated['preapproval-send-v2-memo']())
        expect(intentText(op)).toBe(
            `Send 25.0000000000 Amulet from ${ALICE} to ${BOB}`
        )
        expect(fields(op)).toMatchObject({
            Description: 'Rent',
            Metadata: JSON.stringify({
                values: { [REASON_KEY]: 'Rent for November' },
            }),
            'Number of inputs': '2',
        })
    })

    it('shows trailing None fields, which the ledger leaves out, as absent', async () => {
        const tx = simulated['preapproval-send-v2-plain']()
        const op = await describeOne(tx)
        expect(op.status).toBe('described')
        expect(fields(op)).toMatchObject({
            // The None case matches an Optional the ledger left out of the record
            Description: 'None (absent)',
            Metadata: 'None (absent)',
        })
        // An absent field is not a failure: the transaction is still completely described
        expect((await describedSplice(tx)).complete).toBe(true)
    })

    it('describes the input contracts the simulations use', async () => {
        for (const id of [
            'external-party-amulet-rules-create',
            'transfer-preapproval-create',
            'wallet-user-proxy-create',
        ]) {
            expect((await describeCaptured(id)).status).toBe('described')
        }
        expect(
            intentText(
                await describeCaptured('external-party-amulet-rules-create')
            )
        ).toBe(`Amulet rules for external parties, administered by ${DSO}`)
    })
})
