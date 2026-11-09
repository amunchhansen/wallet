// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// A minimal client for the wallet repo's local Canton (`pnpm start:canton`): JSON Ledger API on
// 5003, tokens from mock-oauth2 on 8889.

import { readFile } from 'node:fs/promises'

const LEDGER = process.env.LEDGER_URL ?? 'http://127.0.0.1:5003'
const TOKEN_URL = process.env.TOKEN_URL ?? 'http://127.0.0.1:8889/token'
const AUDIENCE =
    'https://daml.com/jwt/aud/participant/participant1::1220d44fc1c3ba0b5bdf7b956ee71bc94ebe2d23258dc268fdf0824fbaeff2c61424'
export const SYNCHRONIZER_ID =
    'wallet::1220e7b23ea52eb5c672fb0b1cdbc916922ffed3dd7676c223a605664315e2d43edd'
export const USER_ID = 'participant_admin'

let token: string | undefined

async function bearer(): Promise<string> {
    if (token) return token
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: USER_ID,
            client_secret: 'unused',
            audience: AUDIENCE,
            scope: 'daml_ledger_api',
        }),
    })
    const body = (await response.json()) as { access_token: string }
    token = body.access_token
    return token
}

export async function api<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
): Promise<T> {
    const response = await fetch(`${LEDGER}${path}`, {
        method,
        headers: {
            authorization: `Bearer ${await bearer()}`,
            'content-type': 'application/json',
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    if (!response.ok) {
        throw new Error(`${method} ${path}: ${response.status} ${text}`)
    }
    return JSON.parse(text) as T
}

export async function uploadDar(path: string): Promise<void> {
    const response = await fetch(
        `${LEDGER}/v2/packages?synchronizerId=${encodeURIComponent(SYNCHRONIZER_ID)}&vetAllPackages=true`,
        {
            method: 'POST',
            headers: {
                authorization: `Bearer ${await bearer()}`,
                'content-type': 'application/octet-stream',
            },
            body: await readFile(path),
        }
    )
    if (!response.ok) {
        throw new Error(
            `upload ${path}: ${response.status} ${await response.text()}`
        )
    }
}

/** Allocates `hint` on the participant, or returns it when it already exists. */
export async function party(hint: string): Promise<string> {
    const { partyDetails } = await api<{
        partyDetails: { party: string }[]
    }>('GET', '/v2/parties')
    const existing = partyDetails.find((p) => p.party.startsWith(`${hint}::`))
    if (existing) return existing.party
    const created = await api<{ partyDetails: { party: string } }>(
        'POST',
        '/v2/parties',
        { partyIdHint: hint, synchronizerId: SYNCHRONIZER_ID }
    )
    return created.partyDetails.party
}

export async function grantActAs(parties: string[]): Promise<void> {
    await api('POST', `/v2/users/${USER_ID}/rights`, {
        userId: USER_ID,
        rights: parties.map((p) => ({
            kind: { CanActAs: { value: { party: p } } },
        })),
    })
}

export type Command = Record<string, unknown>

export interface Prepared {
    preparedTransaction: string
    preparedTransactionHash: string
    hashingSchemeVersion: string
}

export interface PrepareOptions {
    readAs?: string[]
    /** Contract keys need V3: V2 cannot hash a node of LF serialization version V2. */
    hashingSchemeVersion?:
        | 'HASHING_SCHEME_VERSION_V2'
        | 'HASHING_SCHEME_VERSION_V3'
}

export async function prepare(
    actAs: string[],
    commands: Command[],
    options: PrepareOptions = {}
): Promise<Prepared> {
    return api<Prepared>('POST', '/v2/interactive-submission/prepare', {
        userId: USER_ID,
        commandId: crypto.randomUUID(),
        actAs,
        readAs: options.readAs ?? [],
        ...(options.hashingSchemeVersion
            ? { hashingSchemeVersion: options.hashingSchemeVersion }
            : {}),
        synchronizerId: SYNCHRONIZER_ID,
        commands,
        disclosedContracts: [],
        packageIdSelectionPreference: [],
        verboseHashing: false,
    })
}

/** Submits `commands` and returns the contract IDs of the created events, by template entity. */
export async function submit(
    actAs: string[],
    commands: Command[]
): Promise<Record<string, string>> {
    const result = await api<{
        transaction: {
            events: {
                CreatedEvent?: { contractId: string; templateId: string }
            }[]
        }
    }>('POST', '/v2/commands/submit-and-wait-for-transaction', {
        commands: {
            userId: USER_ID,
            commandId: crypto.randomUUID(),
            actAs,
            readAs: [],
            synchronizerId: SYNCHRONIZER_ID,
            commands,
        },
    })
    const created: Record<string, string> = {}
    for (const event of result.transaction.events) {
        const c = event.CreatedEvent
        if (c) created[c.templateId.split(':').at(-1) ?? ''] = c.contractId
    }
    return created
}

export const create = (
    templateId: string,
    createArguments: unknown
): Command => ({ CreateCommand: { templateId, createArguments } })

export const exercise = (
    templateId: string,
    contractId: string,
    choice: string,
    choiceArgument: unknown
): Command => ({
    ExerciseCommand: { templateId, contractId, choice, choiceArgument },
})
