// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Captures the prepared transactions behind src/__tests__/splice-contracts.test.ts from the wallet
// repo's local Canton. The `dso` party here is a local party, so contracts that only the DSO can
// create (DsoRules, FeaturedAppRight, governance locks) can be seeded directly.
//
//   pnpm start:canton   # in the wallet repo root, with mock-oauth2 running
//   node core/tx-clear-signing/scripts/capture-splice.ts
//
// Fixtures are written to src/__tests__/fixtures/splice/<id>.json.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    type Command,
    create,
    type PrepareOptions,
    exercise,
    grantActAs,
    party,
    prepare,
    submit,
    uploadDar,
} from './ledger.ts'

const SPLICE_DARS =
    process.env.SPLICE_DARS ?? '/Users/alex/projects/splice/daml/dars'
const OUT = join(
    dirname(fileURLToPath(import.meta.url)),
    '../src/__tests__/fixtures/splice'
)

const DARS = [
    'splice-dso-governance-0.1.31',
    'splice-wallet-0.1.26',
    'splice-util-token-standard-wallet-1.1.2',
    'splice-util-featured-app-proxies-1.2.5',
    'splitwell-0.1.26',
    'splice-token-test-trading-app-1.0.4',
]

const T = {
    amulet: (entity: string) => `#splice-amulet:${entity}`,
    dso: (entity: string) => `#splice-dso-governance:${entity}`,
}
const GL = T.amulet('Splice.GovernanceLock:GovernanceLock')
const GL_TRANSFER = T.amulet(
    'Splice.GovernanceLock.Transfer:GovernanceLockTransfer'
)
const GL_SUBSTITUTION = T.amulet(
    'Splice.GovernanceLock.Substitution:GovernanceLockSubstitution'
)
const LOCKED_AMULET = T.amulet('Splice.Amulet:LockedAmulet')
const FEATURED_APP_RIGHT = T.amulet('Splice.Amulet:FeaturedAppRight')
const EXTERNAL_PARTY_AMULET_RULES = T.amulet(
    'Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules'
)
const TRANSFER_PREAPPROVAL = T.amulet('Splice.AmuletRules:TransferPreapproval')
const DSO_RULES = T.dso('Splice.DsoRules:DsoRules')
const VOTE_REQUEST = T.dso('Splice.DsoRules:VoteRequest')
const SV_NODE_STATE = T.dso('Splice.DSO.SvState:SvNodeState')
const TRANSFER_OFFER =
    '#splice-wallet:Splice.Wallet.TransferOffer:TransferOffer'
const BATCHING_UTILITY =
    '#splice-util-token-standard-wallet:Splice.Util.Token.Wallet.BatchingUtilityV2:BatchingUtility'
const WALLET_USER_PROXY =
    '#splice-util-featured-app-proxies:Splice.Util.FeaturedApp.WalletUserProxy:WalletUserProxy'
const OTC_PROPOSAL =
    '#splice-token-test-trading-app:Splice.Testing.Apps.TradingApp:OTCTradeProposal'
const BALANCE_UPDATE = '#splitwell:Splice.Splitwell:BalanceUpdate'
const FEATURED_APP_V1 =
    '#splice-api-featured-app-v1:Splice.Api.FeaturedAppRightV1:FeaturedAppRight'
const FEATURED_APP_V2 =
    '#splice-api-featured-app-v2:Splice.Api.FeaturedAppRightV2:FeaturedAppRight'
const TRANSFER_INSTRUCTION_V1 =
    '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction'

// JSON Ledger API value helpers
const relTime = (seconds: number) => ({
    microseconds: String(seconds * 1_000_000),
})
const DAY = 86_400
const variant = (tag: string, value: unknown = {}) => ({ tag, value })
const emptyMeta = { values: {} }
const emptyExtraArgs = { context: { values: {} }, meta: emptyMeta }
const at = (offsetSeconds: number) =>
    new Date(Math.floor(Date.now() / 1000 + offsetSeconds) * 1000).toISOString()

async function main() {
    for (const dar of DARS) await uploadDar(join(SPLICE_DARS, `${dar}.dar`))
    const dso = await party('csdso')
    const alice = await party('csalice')
    const bob = await party('csbob')
    const provider = await party('csprovider')
    await grantActAs([dso, alice, bob, provider])
    await mkdir(OUT, { recursive: true })

    const fixtures: { id: string; about: string }[] = []
    async function capture(
        id: string,
        about: string,
        actAs: string[],
        commands: Command[],
        options?: PrepareOptions
    ) {
        try {
            const prepared = await prepare(actAs, commands, options)
            await writeFile(
                join(OUT, `${id}.json`),
                `${JSON.stringify({ id, source: 'captured', about, commands, ...prepared }, null, 4)}\n`
            )
            fixtures.push({ id, about })
            console.log('captured', id)
        } catch (error) {
            console.log('FAILED', id, String(error).slice(0, 1500))
        }
    }

    // Seed contracts --------------------------------------------------------------------------

    const amulet = {
        dso,
        owner: alice,
        amount: {
            initialAmount: '1000.0',
            createdAt: { number: '1' },
            ratePerRound: { rate: '0.0' },
        },
    }
    const { LockedAmulet: lockedAmuletCid } = await submit(
        [dso, alice],
        [
            create(LOCKED_AMULET, {
                amulet,
                lock: {
                    holders: [dso],
                    expiresAt: at(365 * DAY),
                    optContext: 'governance lock',
                },
            }),
        ]
    )
    const faVesting = variant('GLS_VestingLock', {
        kind: variant('GLK_FeaturedApp', { provider }),
        vestingPeriod: relTime(60 * DAY),
        endTime: at(60 * DAY),
    })
    const svFull = variant('GLS_FullLock', {
        kind: variant('GLK_SuperValidatorRightsOwner', { svName: 'sv-1' }),
    })
    const provisionalFull = variant('GLS_FullLock', {
        kind: variant('GLK_ProvisionalFeaturedApp', { provider }),
    })
    const substitution = (
        specification: unknown,
        owner: string,
        lockedAmulet: string | null
    ) => ({
        target: { dso, owner: alice, specification },
        owner,
        amount: '250.0',
        lockedAmulet,
        requestedAt: at(-60),
        expiresAt: at(7 * DAY),
        originalSubstitutionCid: null,
    })
    const lockTransfer = (receiver: string, owner: string) => ({
        source: { dso, owner, specification: faVesting },
        receiver,
        amount: '100.0',
        requestedAt: at(-60),
        expiresAt: at(7 * DAY),
    })
    const { GovernanceLockSubstitution: substitutionCid } = await submit(
        [dso, bob],
        [
            create(
                GL_SUBSTITUTION,
                substitution(faVesting, bob, lockedAmuletCid ?? null)
            ),
        ]
    )
    const { GovernanceLockTransfer: lockTransferV1Cid } = await submit(
        [dso, bob],
        [create(GL_TRANSFER, lockTransfer(alice, bob))]
    )
    const { GovernanceLockTransfer: lockTransferV2Cid } = await submit(
        [dso, bob],
        [create(GL_TRANSFER, lockTransfer(alice, bob))]
    )

    const synchronizerId = 'global-domain::1220c0ffee'
    const dsoRulesConfig = (maxTextLength: string, cooldown: unknown) => ({
        numUnclaimedRewardsThreshold: '10',
        numMemberTrafficContractsThreshold: '5',
        actionConfirmationTimeout: relTime(3600),
        svOnboardingRequestTimeout: relTime(3600),
        svOnboardingConfirmedTimeout: relTime(3600),
        voteRequestTimeout: relTime(7 * DAY),
        dsoDelegateInactiveTimeout: relTime(70),
        synchronizerNodeConfigLimits: {
            cometBft: {
                maxNumCometBftNodes: '2',
                maxNumGovernanceKeys: '2',
                maxNumSequencingKeys: '2',
                maxNodeIdLength: '50',
                maxPubKeyLength: '256',
            },
        },
        maxTextLength,
        decentralizedSynchronizer: {
            synchronizers: [
                [
                    synchronizerId,
                    {
                        state: 'DS_Operational',
                        cometBftGenesisJson: '{}',
                        acsCommitmentReconciliationInterval: '1800',
                    },
                ],
            ],
            lastSynchronizerId: synchronizerId,
            activeSynchronizerId: synchronizerId,
        },
        nextScheduledSynchronizerUpgrade: null,
        voteCooldownTime: cooldown,
        nextScheduledLogicalSynchronizerUpgrade: {
            topologyFreezeTime: at(30 * DAY),
            upgradeTime: at(31 * DAY),
            newPhysicalSynchronizerSerial: '2',
            newPhysicalSynchronizerProtocolVersion: '35',
        },
        svOperationsSwitchOverTimes: { 'cip-0104': at(10 * DAY) },
    })
    const baseConfig = dsoRulesConfig('1024', null)
    const newConfig = dsoRulesConfig('2048', relTime(60))
    const { DsoRules: dsoRulesCid } = await submit(
        [dso],
        [
            create(DSO_RULES, {
                dso,
                epoch: '0',
                svs: [
                    [
                        alice,
                        {
                            name: 'sv-1',
                            joinedAsOfRound: { number: '0' },
                            svRewardWeight: '10',
                            participantId: 'PAR::sv-1::1220',
                        },
                    ],
                ],
                offboardedSvs: [],
                dsoDelegate: alice,
                config: baseConfig,
                initialTrafficState: [],
                isDevNet: true,
            }),
        ]
    )
    const { SvNodeState: svNodeStateCid } = await submit(
        [dso],
        [
            create(SV_NODE_STATE, {
                dso,
                sv: alice,
                svName: 'sv-1',
                state: { synchronizerNodes: [] },
            }),
        ]
    )
    const { TransferOffer: transferOfferCid } = await submit(
        [alice],
        [
            create(TRANSFER_OFFER, {
                sender: alice,
                receiver: bob,
                dso,
                amount: { amount: '12.5', unit: 'USDUnit' },
                description: 'Lunch',
                expiresAt: at(7 * DAY),
                trackingId: 'offer-1',
            }),
        ]
    )
    const featuredAppRight = {
        dso,
        provider,
        activityWeight: '2.5',
        appKind: 'FAK_AssetMoving',
        opsParties: [bob],
    }
    const { FeaturedAppRight: featuredAppRightCid } = await submit(
        [dso],
        [create(FEATURED_APP_RIGHT, featuredAppRight)]
    )
    const transferLeg = (sender: string, receiver: string, amount: string) => ({
        sender,
        receiver,
        amount,
        instrumentId: { admin: dso, id: 'Amulet' },
        meta: {
            values: { 'example.com/note': `${sender.split('::')[0]} pays` },
        },
    })
    const otcProposal = {
        venue: provider,
        tradeCid: null,
        transferLegs: {
            leg0: transferLeg(alice, bob, '100.0'),
            leg1: transferLeg(bob, alice, '20.0'),
        },
        approvers: [alice],
    }
    const { OTCTradeProposal: otcProposalCid } = await submit(
        [alice],
        [create(OTC_PROPOSAL, otcProposal)]
    )
    const { BatchingUtility: batchingCid } = await submit(
        [alice],
        [create(BATCHING_UTILITY, { user: alice })]
    )

    // Creates --------------------------------------------------------------------------------

    await capture(
        'gl-substitution-create-fa-vesting',
        'GovernanceLockSubstitution proposed by bob for an FA vesting lock of alice',
        [dso, bob],
        [
            create(
                GL_SUBSTITUTION,
                substitution(faVesting, bob, lockedAmuletCid ?? null)
            ),
        ]
    )
    await capture(
        'gl-substitution-create-sv-full',
        'GovernanceLockSubstitution proposed by the owner of an SV full lock',
        [dso, alice],
        [create(GL_SUBSTITUTION, substitution(svFull, alice, null))]
    )
    await capture(
        'gl-lock-create',
        'GovernanceLock: provisional FA full lock that replaces an earlier lock',
        [dso, alice],
        [
            create(GL, {
                dso,
                owner: alice,
                amount: '10000.0',
                lockedAmulet: lockedAmuletCid,
                specification: provisionalFull,
                originalLockCid: substitutionCid,
                requestedAt: at(-60),
            }),
        ],
        { hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V3' }
    )
    await capture(
        'gl-transfer-create',
        'GovernanceLockTransfer of an FA vesting lock from alice to bob',
        [dso, alice],
        [create(GL_TRANSFER, lockTransfer(bob, alice))]
    )
    await capture(
        'vote-request-create',
        'VoteRequest with two votes, keyed by SV name in a GenMap',
        [dso],
        [
            create(VOTE_REQUEST, {
                dso,
                requester: 'sv-1',
                action: variant('ARC_DsoRules', {
                    dsoAction: variant('SRARC_SetConfig', {
                        newConfig,
                        baseConfig,
                    }),
                }),
                reason: {
                    url: 'https://example.com/vote',
                    body: 'Raise maxTextLength',
                },
                voteBefore: at(7 * DAY),
                votes: [
                    [
                        'sv-1',
                        {
                            sv: alice,
                            accept: true,
                            reason: { url: '', body: 'I requested it' },
                            optCastAt: at(-60),
                        },
                    ],
                    [
                        'sv-2',
                        {
                            sv: bob,
                            accept: false,
                            reason: {
                                url: 'https://example.com/no',
                                body: 'Too large',
                            },
                            optCastAt: null,
                        },
                    ],
                ],
                trackingCid: null,
                targetEffectiveAt: null,
            }),
        ]
    )
    await capture(
        'transfer-offer-create',
        'TransferOffer of 12.5 USD from alice to bob',
        [alice],
        [
            create(TRANSFER_OFFER, {
                sender: alice,
                receiver: bob,
                dso,
                amount: { amount: '12.5', unit: 'USDUnit' },
                description: 'Lunch',
                expiresAt: at(7 * DAY),
                trackingId: 'offer-2',
            }),
        ]
    )
    await capture(
        'featured-app-right-create',
        'FeaturedAppRight with all optional config set',
        [dso],
        [create(FEATURED_APP_RIGHT, featuredAppRight)]
    )
    await capture(
        'otc-trade-proposal-create',
        'OTCTradeProposal with two transfer legs in a TextMap',
        [alice],
        [create(OTC_PROPOSAL, otcProposal)]
    )
    const group = {
        owner: alice,
        dso,
        members: [bob],
        id: { unpack: 'flatmates' },
        provider,
        acceptDuration: relTime(DAY),
    }
    await capture(
        'balance-update-create-transfer',
        'Splitwell BalanceUpdate recording a transfer',
        [provider, alice, bob],
        [
            create(BALANCE_UPDATE, {
                group,
                update: variant('Transfer', {
                    sender: bob,
                    receiver: alice,
                    amount: '42.0',
                }),
            }),
        ]
    )
    await capture(
        'balance-update-create-netting',
        'Splitwell BalanceUpdate recording a netting, a nested GenMap',
        [provider, alice, bob],
        [
            create(BALANCE_UPDATE, {
                group,
                update: variant('Netting', {
                    balanceChanges: [
                        [
                            alice,
                            [
                                [alice, '-5.0'],
                                [bob, '5.0'],
                            ],
                        ],
                    ],
                }),
            }),
        ]
    )
    await capture(
        'external-party-amulet-rules-create',
        'ExternalPartyAmuletRules, the input contract of the simulated factory calls',
        [dso],
        [create(EXTERNAL_PARTY_AMULET_RULES, { dso })]
    )
    await capture(
        'transfer-preapproval-create',
        'TransferPreapproval, the input contract of the simulated SendV2',
        [dso, bob, provider],
        [
            create(TRANSFER_PREAPPROVAL, {
                dso,
                receiver: bob,
                provider,
                validFrom: at(-DAY),
                lastRenewedAt: at(-DAY),
                expiresAt: at(90 * DAY),
            }),
        ]
    )
    await capture(
        'wallet-user-proxy-create',
        'WalletUserProxy, the input contract of the simulated proxied transfer',
        [provider],
        [
            create(WALLET_USER_PROXY, {
                provider,
                providerWeight: '0.8',
                userWeight: '0.2',
                extraBeneficiaries: [],
                optAllowList: [alice, bob],
            }),
        ]
    )

    // Exercises ------------------------------------------------------------------------------

    await capture(
        'dso-request-vote-set-config',
        'DsoRules_RequestVote for SRARC_SetConfig (two DsoRulesConfig trees)',
        [alice],
        [
            exercise(DSO_RULES, dsoRulesCid ?? '', 'DsoRules_RequestVote', {
                requester: alice,
                action: variant('ARC_DsoRules', {
                    dsoAction: variant('SRARC_SetConfig', {
                        newConfig,
                        baseConfig,
                    }),
                }),
                reason: {
                    url: 'https://example.com/vote',
                    body: 'Raise maxTextLength',
                },
                voteRequestTimeout: relTime(3 * DAY),
                targetEffectiveAt: null,
            }),
        ],
        { readAs: [dso] }
    )
    await capture(
        'dso-request-vote-amulet-schedule',
        'DsoRules_RequestVote for CRARC_AddFutureAmuletConfigSchedule, a (Time, AmuletConfig) tuple',
        [alice],
        [
            exercise(DSO_RULES, dsoRulesCid ?? '', 'DsoRules_RequestVote', {
                requester: alice,
                action: variant('ARC_AmuletRules', {
                    amuletRulesAction: variant(
                        'CRARC_AddFutureAmuletConfigSchedule',
                        {
                            newScheduleItem: {
                                _1: at(14 * DAY),
                                _2: amuletConfig(),
                            },
                        }
                    ),
                }),
                reason: {
                    url: 'https://example.com/fees',
                    body: 'New traffic price',
                },
                voteRequestTimeout: null,
                targetEffectiveAt: at(14 * DAY),
            }),
        ],
        { readAs: [dso] }
    )
    await capture(
        'dso-set-synchronizer-node-config',
        'DsoRules_SetSynchronizerNodeConfig with every optional node config set',
        [alice],
        [
            exercise(
                DSO_RULES,
                dsoRulesCid ?? '',
                'DsoRules_SetSynchronizerNodeConfig',
                {
                    sv: alice,
                    synchronizerId,
                    newNodeConfig: {
                        cometBft: {
                            nodes: [
                                [
                                    'node-1',
                                    {
                                        validatorPubKey: 'pk-validator',
                                        votingPower: '1',
                                    },
                                ],
                            ],
                            governanceKeys: [{ pubKey: 'pk-governance' }],
                            sequencingKeys: [{ pubKey: 'pk-sequencing' }],
                        },
                        sequencer: {
                            migrationId: '3',
                            sequencerId: 'SEQ::current',
                            url: 'https://sequencer.example.com',
                            availableAfter: at(-DAY),
                        },
                        mediator: { mediatorId: 'MED::current' },
                        scan: { publicUrl: 'https://scan.example.com' },
                        legacySequencerConfig: {
                            migrationId: '2',
                            sequencerId: 'SEQ::legacy',
                            url: 'https://legacy-sequencer.example.com',
                        },
                        sequencerIdentity: {
                            sequencerId: 'SEQ::identity',
                            availableAfter: null,
                        },
                        physicalSynchronizers: [
                            [
                                '1',
                                {
                                    sequencer: {
                                        url: 'https://psid-1.example.com',
                                    },
                                },
                            ],
                        ],
                    },
                    nodeStateCid: svNodeStateCid,
                }
            ),
        ],
        { readAs: [dso] }
    )
    await capture(
        'transfer-offer-accept',
        'TransferOffer_Accept, a choice with no arguments',
        [bob],
        [
            exercise(
                TRANSFER_OFFER,
                transferOfferCid ?? '',
                'TransferOffer_Accept',
                {}
            ),
        ]
    )
    await capture(
        'activity-marker-v1',
        'FeaturedAppRight_CreateActivityMarker through FeaturedAppRightV1',
        [provider],
        [
            exercise(
                FEATURED_APP_V1,
                featuredAppRightCid ?? '',
                'FeaturedAppRight_CreateActivityMarker',
                {
                    beneficiaries: [
                        { beneficiary: provider, weight: '0.7' },
                        { beneficiary: alice, weight: '0.3' },
                    ],
                }
            ),
        ]
    )
    await capture(
        'activity-marker-v2',
        'FeaturedAppRight_CreateActivityMarker through FeaturedAppRightV2, with a weight',
        [provider],
        [
            exercise(
                FEATURED_APP_V2,
                featuredAppRightCid ?? '',
                'FeaturedAppRight_CreateActivityMarker',
                {
                    beneficiaries: [{ beneficiary: provider, weight: '1.0' }],
                    weight: '3.0',
                }
            ),
        ]
    )
    await capture(
        'otc-trade-proposal-accept',
        'OTCTradeProposal_Accept by the second trader',
        [bob],
        [
            exercise(
                OTC_PROPOSAL,
                otcProposalCid ?? '',
                'OTCTradeProposal_Accept',
                {
                    approver: bob,
                }
            ),
        ]
    )
    await capture(
        'batching-utility-execute',
        'BatchingUtility_ExecuteBatch rejecting two governance lock transfers, V1 and V2',
        [alice],
        [
            exercise(
                BATCHING_UTILITY,
                batchingCid ?? '',
                'BatchingUtility_ExecuteBatch',
                {
                    inputHoldingMap: { byAdminAndAccount: [] },
                    actions: [
                        variant('TSA_TransferInstruction_RejectV1', {
                            cid: lockTransferV1Cid,
                            arg: { extraArgs: emptyExtraArgs },
                        }),
                        variant('TSA_TransferInstruction_RejectV2', {
                            cid: lockTransferV2Cid,
                            arg: { actors: [alice], extraArgs: emptyExtraArgs },
                        }),
                    ],
                    archiveAfterExecution: false,
                }
            ),
        ]
    )
    await capture(
        'gl-transfer-reject-v1',
        'TransferInstruction_Reject V1 on a GovernanceLockTransfer, through the interface',
        [alice],
        [
            exercise(
                TRANSFER_INSTRUCTION_V1,
                lockTransferV1Cid ?? '',
                'TransferInstruction_Reject',
                { extraArgs: emptyExtraArgs }
            ),
        ]
    )

    await writeFile(
        join(OUT, 'index.json'),
        `${JSON.stringify(fixtures, null, 4)}\n`
    )
}

function amuletConfig() {
    const issuance = (amuletToIssuePerYear: string) => ({
        amuletToIssuePerYear,
        validatorRewardPercentage: '0.05',
        appRewardPercentage: '0.15',
        validatorRewardCap: '0.2',
        featuredAppRewardCap: '100.0',
        unfeaturedAppRewardCap: '0.6',
        optValidatorFaucetCap: '2.85',
        optDevelopmentFundPercentage: null,
    })
    return {
        transferConfig: {
            createFee: { fee: '0.0' },
            holdingFee: { rate: '0.0000190259' },
            transferFee: {
                initialRate: '0.0',
                steps: [
                    { _1: '100.0', _2: '0.0' },
                    { _1: '1000.0', _2: '0.0' },
                ],
            },
            lockHolderFee: { fee: '0.0' },
            extraFeaturedAppRewardAmount: '1.0',
            maxNumInputs: '100',
            maxNumOutputs: '100',
            maxNumLockHolders: '50',
            tokenStandardMaxTTL: relTime(90 * DAY),
        },
        issuanceCurve: {
            initialValue: issuance('40000000000.0'),
            futureValues: [
                { _1: relTime(365 * DAY), _2: issuance('20000000000.0') },
            ],
        },
        decentralizedSynchronizer: {
            requiredSynchronizers: { map: [['global-domain::1220c0ffee', {}]] },
            activeSynchronizer: 'global-domain::1220c0ffee',
            fees: {
                baseRateTrafficLimits: {
                    burstAmount: '400000',
                    burstWindow: relTime(1200),
                },
                extraTrafficPrice: '16.67',
                readVsWriteScalingFactor: '4',
                minTopupAmount: '200000',
            },
        },
        tickDuration: relTime(600),
        packageConfig: {
            amulet: '0.1.25',
            amuletNameService: '0.1.26',
            dsoGovernance: '0.1.31',
            validatorLifecycle: '0.1.10',
            wallet: '0.1.26',
            walletPayments: '0.1.25',
        },
        transferPreapprovalFee: null,
        featuredAppActivityMarkerAmount: '1.0',
        optDevelopmentFundManager: null,
        externalPartyConfigStateTickDuration: null,
        rewardConfig: {
            mintingVersion: 'RewardVersion_TrafficBasedAppRewards',
            dryRunVersion: 'RewardVersion_FeaturedAppMarkers',
            batchSize: '100',
            rewardCouponTimeToLive: relTime(36 * 3600),
            appRewardCouponThreshold: '0.5',
            extraFeaturedAssetActivityWeight: null,
            maxExtraFeaturedAssetActivityWeightPerAsset: null,
            dsoAppActivityWeight: null,
        },
        transferPreapprovalBaseDuration: null,
        developmentFundManagerBlacklist: [],
        minDevelopmentFundMintingDelay: null,
        amuletSwitchOverTimes: null,
        governanceLockConfig: {
            minimumLockAmount: '10000.0',
            superValidatorLockVestingDuration: null,
            featuredAppLockVestingDuration: relTime(60 * DAY),
        },
    }
}

await main()
