// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Clear signing on Splice contracts chosen for their awkward shapes: repeated field names, variants,
// optionals, tuples, maps and V1/V2 interface choices with the same name. Each test pins what the
// wallet shows, including the fields that fail. mpa documentation/clearsigning/
// splice-contract-verification.md explains each result.

import { describe, expect, it } from 'vitest'
import { HashingSchemeVersion } from '@canton-network/core-ledger-proto'
import { hashPreparedTransaction } from '@canton-network/core-tx-visualizer'
import { clearSign, type OperationDescription } from './clear-sign.js'
import { intentText } from './__tests__/helpers.js'
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

function describeOne(preparedTransaction: string): OperationDescription {
    const { operations } = clearSign(preparedTransaction, spliceDescriptors)
    expect(operations).toHaveLength(1)
    return operations[0]!
}

const describeCaptured = (id: string) =>
    describeOne(captured(id).preparedTransaction)

/** Each field as label → value, `None (absent)` or `error: …`. */
function fields(op: OperationDescription): Record<string, string> {
    return Object.fromEntries(
        op.fields.map((f) => [
            f.label,
            f.absent ? `${f.value} (absent)` : (f.value ?? `error: ${f.error}`),
        ])
    )
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
            const hash = await hashPreparedTransaction(
                fixture.preparedTransaction,
                'base64',
                { hashingScheme: scheme, readUnknownField: 'throw' }
            )
            expect(hash).toBe(fixture.preparedTransactionHash)
        }
    )

    it('needs hashing scheme V3 for a template with a contract key', () => {
        expect(captured('gl-lock-create').hashingSchemeVersion).toBe(
            'HASHING_SCHEME_VERSION_V3'
        )
    })
})

describe('governance locks', () => {
    it('reads through variant, record and variant to the lock kind', () => {
        const op = describeCaptured('gl-substitution-create-fa-vesting')
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(
            `Propose substituting 250.0000000000 of the governance lock of ${ALICE}, proposed by ${BOB}`
        )
        expect(fields(op)).toMatchObject({
            'Lock owner': ALICE,
            'Proposed by': BOB,
            'Featured app provider': PROVIDER,
            'Vesting period': '60d',
            SV: "error: variant is 'GLS_VestingLock', not 'GLS_FullLock'",
            // A trailing None field is not in the prepared transaction, so it is shown as an inferred None
            'First proposal': 'None (absent)',
        })
    })

    it('fails the vesting fields of a full lock, and shows a non-trailing None', () => {
        const op = describeCaptured('gl-substitution-create-sv-full')
        expect(op.status).toBe('described')
        expect(fields(op)).toMatchObject({
            'Featured app provider':
                "error: variant is 'GLS_FullLock', not 'GLS_VestingLock'",
            'Vesting period':
                "error: variant is 'GLS_FullLock', not 'GLS_VestingLock'",
            SV: 'sv-1',
            Funding: 'None',
        })
    })

    it('describes a lock with a contract key', () => {
        const op = describeCaptured('gl-lock-create')
        expect(intentText(op)).toBe(`Lock 10000.0000000000 of ${ALICE}`)
        expect(fields(op)).toMatchObject({
            'Lock kind': JSON.stringify({
                GLK_ProvisionalFeaturedApp: { provider: PROVIDER },
            }),
            'Provisional featured app': PROVIDER,
        })
    })

    it('keeps source.owner apart from receiver', () => {
        const op = describeCaptured('gl-transfer-create')
        expect(intentText(op)).toBe(
            `Transfer 100.0000000000 of governance locks from ${ALICE} to ${BOB}`
        )
    })

    it('words V1 and V2 accepts the same, from the contract', () => {
        const v1 = describeOne(simulated['gl-substitution-accept-v1']())
        const v2 = describeOne(simulated['gl-substitution-accept-v2']())
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
        expect(fields(v1).Actors).toBe('None (absent)')
        expect(fields(v2).Actors).toBe(JSON.stringify([ALICE]))
    })

    it('rejects through V2 on an SV lock', () => {
        const op = describeOne(simulated['gl-substitution-reject-sv']())
        expect(intentText(op)).toBe(
            `Reject the substitution of 250.0000000000 proposed by ${ALICE}`
        )
    })

    it('describes a captured V1 reject through the interface', () => {
        const op = describeCaptured('gl-transfer-reject-v1')
        expect(op.status).toBe('described')
        expect(op.interface?.entityName).toBe('TransferInstruction')
        expect(intentText(op)).toBe(
            `Reject 100.0000000000 of governance locks from ${BOB}`
        )
    })
})

describe('governance lock requests through the transfer factory', () => {
    const METADATA = 'Metadata, which the receiver may act on'
    const REQUEST =
        "Request a transfer of {amount} Amulet. What the receiver does with it depends on the transfer's metadata"

    it('words an unlock request as a requested transfer, with the request in the metadata', () => {
        const op = describeOne(simulated['epar-transfer-v1-unlock']())
        expect(op.status).toBe('described')
        // The contract ignores this amount for an unlock; the sentence calls it requested and
        // points to the metadata, which shows the request whole
        expect(intentText(op)).toBe(REQUEST.replace('{amount}', '1.0000000000'))
        expect(fields(op)).toMatchObject({
            'Requested amount': '1.0000000000',
            From: ALICE,
            To: LOCK_MANAGER,
            [METADATA]: JSON.stringify({ [REASON_KEY]: UNLOCK_MEMO }),
            'From account owner': "error: 'owner' applied to party",
        })
    })

    it('words V2 the same; its sender and receiver are accounts', () => {
        const op = describeOne(simulated['epar-transfer-v2-create-lock']())
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(
            REQUEST.replace('{amount}', '10000.0000000000')
        )
        expect(fields(op)).toMatchObject({
            From: "error: format 'party' does not accept record",
            'From account owner': ALICE,
            'To account owner': LOCK_MANAGER,
            [METADATA]: JSON.stringify({ [REASON_KEY]: CREATE_LOCK_MEMO }),
        })
    })
})

describe('V1 and V2 AllocationFactory_Allocate share one entry', () => {
    it('describes V2', () => {
        const op = describeOne(simulated['epar-allocate-v2']())
        expect(op.status).toBe('described')
        expect(fields(op)).toMatchObject({
            'Number of legs': '2',
            'Amount (V1)': 'None (absent)',
        })
    })

    it('falls back for V1, and shows its own fields', () => {
        const op = describeOne(simulated['epar-allocate-v1']())
        expect(op.status).toBe('fallback')
        expect(intentText(op)).toBe('Allocate funds for a settlement')
        expect(fields(op)).toMatchObject({
            Settlement: 'None (absent)',
            'Settlement (V1)': 'trade-7',
            'Amount (V1)': '75.0000000000',
            'Sender (V1)': ALICE,
        })
    })
})

describe('DSO governance', () => {
    it('reaches seven levels into a SetConfig vote', () => {
        const op = describeCaptured('dso-request-vote-set-config')
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(
            `Request a vote by ${ALICE}: Raise maxTextLength`
        )
        expect(fields(op)).toMatchObject({
            'Voting period': '3d',
            'New max text length': '2048',
            'Current max text length': '1024',
            'New vote cooldown': '1m',
            'Effective at': 'None (absent)',
            'Schedule from':
                "error: variant is 'ARC_DsoRules', not 'ARC_AmuletRules'",
        })
        expect(fields(op)['CIP-0104 switch-over']).toMatch(/^2026-11-19T/)
    })

    it('reads tuples, Sets and enums in an amulet config schedule', () => {
        const op = describeCaptured('dso-request-vote-amulet-schedule')
        expect(op.status).toBe('described')
        expect(fields(op)).toMatchObject({
            'Voting period': 'None',
            'Extra traffic price': '16.6700000000',
            'Burst window': '20m',
            'Required synchronizers':
                '{"map":[["global-domain::1220c0ffee","()"]]}',
            'Transfer fee steps':
                '[{"_1":"100.0000000000","_2":"0.0000000000"},{"_1":"1000.0000000000","_2":"0.0000000000"}]',
            Minting: 'Traffic-based app rewards',
            'DSO app activity weight': 'None (absent)',
            'New max text length':
                "error: variant is 'ARC_AmuletRules', not 'ARC_DsoRules'",
        })
    })

    it('keeps sibling optional configs with the same field names apart', () => {
        const op = describeCaptured('dso-set-synchronizer-node-config')
        expect(op.status).toBe('described')
        expect(fields(op)).toMatchObject({
            'Sequencer URL': 'https://sequencer.example.com',
            'Sequencer migration': '3',
            'Legacy sequencer URL': 'https://legacy-sequencer.example.com',
            'Legacy sequencer migration': '2',
            'Sequencer identity available after': 'None (absent)',
            'Governance keys': '1',
            'Physical synchronizers':
                '[["1",{"sequencer":{"url":"https://psid-1.example.com"}}]]',
        })
    })

    it('shows a GenMap keyed by text only as a whole', () => {
        const op = describeCaptured('vote-request-create')
        expect(intentText(op)).toMatch(/^Vote requested by sv-1, open until /)
        expect(fields(op).Votes).toMatch(/^\[\["sv-1",\{"sv":/)
        expect(fields(op).Tracking).toBe('None (absent)')
    })
})

describe('wallet and apps', () => {
    it('reads amount.amount and an enum unit', () => {
        const op = describeCaptured('transfer-offer-create')
        expect(intentText(op)).toBe(`Offer 12.5000000000 USD to ${BOB}: Lunch`)
    })

    it('words a choice without arguments from the contract alone', () => {
        const op = describeCaptured('transfer-offer-accept')
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(`Accept 12.5000000000 USD from ${ALICE}`)
        expect(op.fields).toEqual([])
    })

    it('formats an optional enum and counts an optional list', () => {
        const op = describeCaptured('featured-app-right-create')
        expect(fields(op)).toMatchObject({
            Kind: 'Asset mover',
            'Activity weight': '2.5000000000',
            'Number of operational parties': '1',
        })
    })

    it('words V1 and V2 activity markers the same; weight is V2 only', () => {
        const v1 = describeCaptured('activity-marker-v1')
        const v2 = describeCaptured('activity-marker-v2')
        expect(intentText(v1)).toBe(
            `Record activity of ${PROVIDER} for 2 beneficiaries`
        )
        expect(fields(v1).Weight).toBe('None (absent)')
        expect(fields(v2).Weight).toBe('3.0000000000')
    })

    it('indexes a TextMap of records with a quoted key', () => {
        const op = describeCaptured('otc-trade-proposal-create')
        expect(intentText(op)).toBe(
            `Trade 100.0000000000 Amulet from ${ALICE} to ${BOB}, one of 2 legs`
        )
        expect(fields(op)['Leg 0 note']).toBe('csalice pays')
    })

    it('counts the legs of the contract an accept acts on', () => {
        const op = describeCaptured('otc-trade-proposal-accept')
        expect(intentText(op)).toBe(
            `Approve, as ${BOB}, a trade of 2 legs at ${PROVIDER}`
        )
    })

    it('reads the label of a positional newtype, and selects by constructor', () => {
        const transfer = describeCaptured('balance-update-create-transfer')
        const netting = describeCaptured('balance-update-create-netting')
        expect(intentText(transfer)).toBe(
            `Record a balance update in group flatmates of ${ALICE}`
        )
        expect(fields(transfer)).toMatchObject({
            Transferred: '42.0000000000',
            'Balance changes': "error: variant is 'Transfer', not 'Netting'",
        })
        expect(fields(netting)).toMatchObject({
            Transferred: "error: variant is 'Netting', not 'Transfer'",
            'Balance changes': `[["${ALICE}",[["${ALICE}","-5.0000000000"],["${BOB}","5.0000000000"]]]]`,
        })
    })

    it('counts a list of variants, and shows it only as a whole', () => {
        const op = describeCaptured('batching-utility-execute')
        expect(intentText(op)).toBe(
            `Execute 2 token standard actions as ${ALICE}`
        )
        const actions = JSON.parse(fields(op).Actions!) as object[]
        expect(actions.map((a) => Object.keys(a)[0])).toEqual([
            'TSA_TransferInstruction_RejectV1',
            'TSA_TransferInstruction_RejectV2',
        ])
    })

    it('reads five levels into a generic proxy argument', () => {
        const op = describeOne(simulated['wallet-user-proxy-transfer']())
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(
            `Transfer 30.0000000000 Amulet from ${ALICE} to ${BOB} via ${PROVIDER}`
        )
    })

    it('reads a memo through an optional Metadata', () => {
        const op = describeOne(simulated['preapproval-send-v2-memo']())
        expect(intentText(op)).toBe(
            `Send 25.0000000000 Amulet from ${ALICE} to ${BOB}`
        )
        expect(fields(op)).toMatchObject({
            Description: 'Rent',
            Memo: 'Rent for November',
            'Number of inputs': '2',
        })
    })

    it('shows trailing None fields, which the ledger leaves out, as absent', () => {
        const tx = simulated['preapproval-send-v2-plain']()
        const op = describeOne(tx)
        expect(op.status).toBe('described')
        expect(fields(op)).toMatchObject({
            Description: 'None (absent)',
            Memo: 'None (absent)',
        })
        // An absent field is not a failure: the transaction is still completely described
        expect(clearSign(tx, spliceDescriptors).complete).toBe(true)
    })

    it('describes the input contracts the simulations use', () => {
        for (const id of [
            'external-party-amulet-rules-create',
            'transfer-preapproval-create',
            'wallet-user-proxy-create',
        ]) {
            expect(describeCaptured(id).status).toBe('described')
        }
        expect(
            intentText(describeCaptured('external-party-amulet-rules-create'))
        ).toBe(`Amulet rules for external parties, administered by ${DSO}`)
    })
})
