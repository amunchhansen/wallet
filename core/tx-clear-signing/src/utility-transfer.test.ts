// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { parseDescriptor } from './descriptor.js'
import { described, intentText, shown } from './__tests__/helpers.js'
import { utilityTransferAccept } from './__tests__/fixtures/utility-transfer-accept.js'
import transferOffer from './__tests__/schema-examples/utility-transfer-offer.json'

const SENDER =
    'bd::1220ad50383861f0a5307729a8d5aa3c68d901f40f74c7577ef6e6d6023d962fb3b8'
const RECEIVER =
    'bd::12203b998e47224bc01df455f24bb33cca1aa1d6144a7f735206824fddb2fb58700b'
const TRANSFER_RULE =
    '00668dfdb083bfbd87aa6ddedcaea0c31623cb849373b15b6f498d2a2392af628bca1212206c197fdabdcab626a128f5cf7cb36dfc4f180a388d812befc326c90e309f29ef'

describe('TransferInstruction_Accept on a utility TransferOffer', () => {
    it('is described by the schema example descriptor', async () => {
        const result = await described(utilityTransferAccept, [
            parseDescriptor(transferOffer),
        ])

        expect(result.complete).toBe(true)
        const [op] = result.operations
        expect(op).toMatchObject({
            kind: 'exercise',
            choiceId: 'TransferInstruction_Accept',
            interface: {
                moduleName: 'Splice.Api.Token.TransferInstructionV1',
                entityName: 'TransferInstruction',
            },
            status: 'described',
        })
        expect(op?.fields.map((f) => [f.label, shown(f)])).toEqual([
            ['Amount', '0.0000000421'],
            ['Instrument', '"Tebirkes"'],
            ['From', SENDER],
            ['To', RECEIVER],
            ['Transfer rule', TRANSFER_RULE],
        ])
        expect(intentText(op)).toBe(
            `Accept 0.0000000421 "Tebirkes" from ${SENDER} to ${RECEIVER}, settled according to the transfer rule at ${TRANSFER_RULE}`
        )
    })
})
