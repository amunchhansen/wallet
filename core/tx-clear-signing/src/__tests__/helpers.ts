// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { OperationDescription } from '../clear-sign.js'
import { type Descriptor, parseDescriptor } from '../descriptor.js'

/** Package of the templates in the core-tx-hashing vectors copied to fixtures/. */
export const VECTOR_PACKAGE =
    '7ac0650ef4d386a42bcbc7fe129f41806daa04063ff0970a5a3cdd6f4f829e68'
export const OWNER =
    'hash-vectors-owner::1220ed3b217454bb6df71539d8119d679210ef528ca8d36711779eb09d5d7337b095'
export const OTHER =
    'hash-vectors-other::122034539ff7a7f4d1754374fd16165642ea6eecb54acef3f7d32f67e188273f8916'

/** A descriptor for a template of the hash-vector fixtures. */
export function vectorDescriptor(
    entityName: string,
    display: unknown,
    enums?: Record<string, Record<string, string>>
): Descriptor {
    return parseDescriptor({
        $schema: 'https://example.org/canton-clear-signing/v1/schema.json',
        context: {
            template: {
                packageId: VECTOR_PACKAGE,
                moduleName: 'HashVectors',
                entityName,
            },
        },
        metadata: {
            version: '1.0.0',
            publisher: 'test',
            name: entityName,
            ...(enums && { enums }),
        },
        display,
    })
}

/** The intent as one string, for assertions on its wording. */
export function intentText(op: OperationDescription | undefined): string {
    return (op?.intent ?? [])
        .map((part) => (part.kind === 'text' ? part.text : part.value))
        .join('')
}
