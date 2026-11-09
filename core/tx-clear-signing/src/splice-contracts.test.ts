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

type Field = OperationDescription['fields'][number]

/**
 * Each field as label → value, `None (absent)` or `error: …`. The fields of a matched case follow
 * their field, labelled `<field label> › <case field label>`.
 */
function fields(op: OperationDescription): Record<string, string> {
    return Object.fromEntries(flatten(op.fields, ''))
}

function flatten(list: Field[], prefix: string): [string, string][] {
    return list.flatMap((f) => [
        [prefix + f.label, show(f)] as [string, string],
        ...flatten(f.fields ?? [], `${prefix}${f.label} › `),
    ])
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
    it('shows the fields of a vesting lock through nested cases', () => {
        const op = describeCaptured('gl-substitution-create-fa-vesting')
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(
            `Propose substituting 250.0000000000 of the vesting lock of ${ALICE}, proposed by ${BOB}`
        )
        expect(fields(op)).toEqual({
            Amount: '250.0000000000',
            'Lock owner': ALICE,
            'Proposed by': BOB,
            'Lock type': 'vesting lock',
            'Lock type › Lock for': 'featured app',
            'Lock type › Lock for › Provider': PROVIDER,
            'Lock type › Vesting period': '60d',
            'Lock type › Vesting ends': '2027-01-08T16:29:55Z',
            Funding: expect.stringMatching(/^003dc46d/),
            Expires: '2026-11-16T16:29:58Z',
            // A trailing None field is not in the prepared transaction, so it is shown as an inferred None
            'First proposal': 'None (absent)',
        })
        const lockType = op.fields.find((f) => f.label === 'Lock type')
        expect(lockType?.case).toBe('GLS_VestingLock')
    })

    it('shows only the fields of the full lock case, and a non-trailing None', () => {
        const op = describeCaptured('gl-substitution-create-sv-full')
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(
            `Propose substituting 250.0000000000 of the full lock of ${ALICE}, proposed by ${ALICE}`
        )
        const shown = fields(op)
        expect(shown).toMatchObject({
            'Lock type': 'full lock',
            'Lock type › Lock for': 'super validator',
            'Lock type › Lock for › SV': 'sv-1',
            Funding: 'None',
        })
        expect(shown).not.toHaveProperty(['Lock type › Vesting period'])
    })

    it('describes a lock with a contract key', () => {
        const op = describeCaptured('gl-lock-create')
        expect(intentText(op)).toBe(
            `Create a full lock of 10000.0000000000 for ${ALICE}`
        )
        expect(fields(op)).toMatchObject({
            'Lock type': 'full lock',
            'Lock type › Lock for': 'provisional featured app',
            'Lock type › Lock for › Provider': PROVIDER,
        })
    })

    it('keeps source.owner apart from receiver', () => {
        const op = describeCaptured('gl-transfer-create')
        expect(intentText(op)).toBe(
            `Transfer 100.0000000000 of the vesting locks of ${ALICE} to ${BOB}`
        )
    })

    it('words V1 and V2 accepts the same, from the contract', () => {
        const v1 = describeOne(simulated['gl-substitution-accept-v1']())
        const v2 = describeOne(simulated['gl-substitution-accept-v2']())
        const sentence = `Accept the substitution of 250.0000000000 of the vesting lock of ${ALICE}, proposed by ${BOB}`
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
            `Request a vote by ${ALICE} on the DSO rules: Raise maxTextLength`
        )
        const action = 'Votes on › Action'
        expect(fields(op)).toMatchObject({
            'Voting period': '3d',
            'Effective at': 'None (absent)',
            'Votes on': 'the DSO rules',
            [action]: 'change the DSO rules configuration',
            [`${action} › New max text length`]: '2048',
            [`${action} › Current configuration`]: 'set',
            [`${action} › Current configuration › Max text length`]: '1024',
            [`${action} › New vote cooldown`]: '1m',
            [`${action} › CIP-0104 switch-over`]: '2026-11-19T16:29:56Z',
        })
    })

    it('reads tuples, Sets and enums in an amulet config schedule', () => {
        const op = describeCaptured('dso-request-vote-amulet-schedule')
        expect(op.status).toBe('described')
        expect(intentText(op)).toBe(
            `Request a vote by ${ALICE} on the amulet rules: New traffic price`
        )
        const action = 'Votes on › Action'
        expect(fields(op)).toMatchObject({
            'Voting period': 'None',
            'Votes on': 'the amulet rules',
            [action]: 'schedule an amulet configuration',
            [`${action} › Extra traffic price`]: '16.6700000000',
            [`${action} › Burst window`]: '20m',
            [`${action} › Required synchronizers`]:
                '{"map":[["global-domain::1220c0ffee","()"]]}',
            [`${action} › Transfer fee steps`]:
                '[{"_1":"100.0000000000","_2":"0.0000000000"},{"_1":"1000.0000000000","_2":"0.0000000000"}]',
            [`${action} › Reward configuration`]: 'set',
            [`${action} › Reward configuration › Minting`]:
                'Traffic-based app rewards',
            [`${action} › Reward configuration › DSO app activity weight`]:
                'None (absent)',
        })
    })

    it('keeps sibling optional configs with the same field names apart', () => {
        const op = describeCaptured('dso-set-synchronizer-node-config')
        expect(op.status).toBe('described')
        expect(fields(op)).toMatchObject({
            Sequencer: 'set',
            'Sequencer › URL': 'https://sequencer.example.com',
            'Sequencer › Migration': '3',
            'Legacy sequencer': 'set',
            'Legacy sequencer › URL': 'https://legacy-sequencer.example.com',
            'Legacy sequencer › Migration': '2',
            'Sequencer identity': 'set',
            'Sequencer identity › Available after': 'None (absent)',
            Mediator: 'set',
            'Mediator › Mediator ID': 'MED::current',
            'Scan › Public URL': 'https://scan.example.com',
            'Governance keys': '1',
            'Physical synchronizers':
                '[["1",{"sequencer":{"url":"https://psid-1.example.com"}}]]',
        })
    })

    it('shows a GenMap keyed by text only as a whole', () => {
        const op = describeCaptured('vote-request-create')
        expect(intentText(op)).toMatch(
            /^Vote by sv-1 on the DSO rules, open until /
        )
        expect(fields(op)).toMatchObject({
            'Votes on': 'the DSO rules',
            'Votes on › Action': 'change the DSO rules configuration',
            'Votes on › Action › New max text length': '2048',
        })
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

    it('reads the label of a positional newtype, and shows each update type with its own fields', () => {
        const transfer = describeCaptured('balance-update-create-transfer')
        const netting = describeCaptured('balance-update-create-netting')
        expect(intentText(transfer)).toBe(
            `Record a transfer in group flatmates of ${ALICE}`
        )
        expect(intentText(netting)).toBe(
            `Record a netting in group flatmates of ${ALICE}`
        )
        expect(fields(transfer)).toMatchObject({
            Group: 'flatmates',
            Update: 'transfer',
            'Update › Sender': BOB,
            'Update › Amount': '42.0000000000',
        })
        expect(fields(netting)).toMatchObject({
            Update: 'netting',
            'Update › Balance changes': `[["${ALICE}",[["${ALICE}","-5.0000000000"],["${BOB}","5.0000000000"]]]]`,
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

    it('shows a memo in the Some case of an optional Metadata', () => {
        const op = describeOne(simulated['preapproval-send-v2-memo']())
        expect(intentText(op)).toBe(
            `Send 25.0000000000 Amulet from ${ALICE} to ${BOB}`
        )
        expect(fields(op)).toMatchObject({
            Description: 'Rent',
            Metadata: 'given',
            'Metadata › Memo': 'Rent for November',
            'Number of inputs': '2',
        })
    })

    it('shows trailing None fields, which the ledger leaves out, as absent', () => {
        const tx = simulated['preapproval-send-v2-plain']()
        const op = describeOne(tx)
        expect(op.status).toBe('described')
        expect(fields(op)).toMatchObject({
            Description: 'None (absent)',
            // The None case matches an Optional the ledger left out of the record
            Metadata: 'none (absent)',
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
