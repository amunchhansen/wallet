// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { PreparedTransaction } from '@canton-network/core-ledger-proto'
import {
    parseDescriptor,
    type Descriptor,
} from '../../../tx-clear-signing/src/descriptor.js'
import {
    decode,
    templateKey,
    type TemplateRef,
} from '../../../tx-clear-signing/src/roots.js'
import {
    encode,
    vectorDescriptor,
} from '../../../tx-clear-signing/src/__tests__/helpers.js'
import allValues from '../../../tx-clear-signing/src/__tests__/fixtures/v2-create-all-values.json'
import createAndExercise from '../../../tx-clear-signing/src/__tests__/fixtures/v2-create-and-exercise.json'
import nestedCreates from '../../../tx-clear-signing/src/__tests__/fixtures/v2-exercise-nested-creates.json'
import { builtinPingCreate } from '../../../tx-clear-signing/src/__tests__/fixtures/ping.js'
import { selectDescriptors } from './select.js'

function names(descriptors: readonly Descriptor[]): string[] {
    return descriptors.map(
        (descriptor) => descriptor.context.template.entityName
    )
}

/** The fixture's create, plus a second create root of `entityName`. */
function withSecondCreate(tx: string, entityName: string): string {
    const prepared = decode(tx)
    const transaction = prepared.transaction
    if (!transaction) throw new Error('fixture has no transaction')
    const root = transaction.nodes.find(
        (node) => node.nodeId === transaction.roots[0]
    )
    if (!root) throw new Error('fixture has no root node')
    const copy = structuredClone(root)
    copy.nodeId = 'second'
    const versioned = copy.versionedNode
    if (versioned.oneofKind !== 'v1') throw new Error('fixture root is not v1')
    const nodeType = versioned.v1.nodeType
    if (nodeType.oneofKind !== 'create' || !nodeType.create.templateId) {
        throw new Error('fixture root is not a create')
    }
    nodeType.create.templateId.entityName = entityName
    transaction.roots.push(copy.nodeId)
    transaction.nodes.push(copy)
    return encode(prepared)
}

function descriptorFor(template: TemplateRef): Descriptor {
    return parseDescriptor({
        $schema: 'https://example.org/canton-clear-signing/v1/schema.json',
        context: { template },
        metadata: {
            version: '1.0.0',
            publisher: 'test',
            name: template.entityName,
        },
        display: { create: { intent: `Create ${template.entityName}` } },
    })
}

describe('selectDescriptors', () => {
    const allKinds = vectorDescriptor('AllKinds', {
        create: { intent: 'All kinds' },
    })
    const other = vectorDescriptor('Other', { create: { intent: 'Other' } })

    it('returns one descriptor per root template, in root order', () => {
        const tx = withSecondCreate(allValues.preparedTransaction, 'Other')
        expect(names(selectDescriptors(tx, [other, allKinds]))).toEqual([
            'AllKinds',
            'Other',
        ])
    })

    it('returns one descriptor when a later root exercises the created template', () => {
        const plain = vectorDescriptor('Plain', {
            create: { intent: 'Create a plain contract' },
        })
        expect(
            names(
                selectDescriptors(createAndExercise.preparedTransaction, [
                    other,
                    plain,
                ])
            )
        ).toEqual(['Plain'])
    })

    it('omits a root template that has no candidate', () => {
        const tx = withSecondCreate(allValues.preparedTransaction, 'Other')
        expect(names(selectDescriptors(tx, [other]))).toEqual(['Other'])
    })

    it('does not select a template that only a child node creates', () => {
        const tx = nestedCreates.preparedTransaction
        const transaction = decode(tx).transaction
        if (!transaction) throw new Error('fixture has no transaction')
        const rootIds = new Set(transaction.roots)
        const children = new Map<string, TemplateRef>()
        for (const node of transaction.nodes) {
            if (rootIds.has(node.nodeId)) continue
            if (node.versionedNode.oneofKind !== 'v1') continue
            const nodeType = node.versionedNode.v1.nodeType
            if (
                nodeType.oneofKind !== 'create' ||
                !nodeType.create.templateId
            ) {
                continue
            }
            const template: TemplateRef = {
                packageId: nodeType.create.templateId.packageId,
                moduleName: nodeType.create.templateId.moduleName,
                entityName: nodeType.create.templateId.entityName,
            }
            children.set(templateKey(template), template)
        }
        expect(children.size).toBeGreaterThan(0)

        const driver = vectorDescriptor('Driver', {
            exercises: [
                { choice: 'NestedCreates', intent: 'Create nested contracts' },
            ],
        })
        const childDescriptors = [...children.values()].map(descriptorFor)
        expect(
            childDescriptors.every(
                (descriptor) =>
                    descriptor.context.template.entityName !== 'Driver'
            )
        ).toBe(true)
        expect(
            names(selectDescriptors(tx, [driver, ...childDescriptors]))
        ).toEqual(['Driver'])
    })

    it('rejects two candidates for one template, even when the transaction lacks it', () => {
        const first = vectorDescriptor('Plain', { create: { intent: 'First' } })
        const second = vectorDescriptor('Plain', {
            create: { intent: 'Second' },
        })
        expect(() =>
            selectDescriptors(builtinPingCreate, [first, second])
        ).toThrow(/more than one descriptor for template/)
    })

    it('rejects a candidate that names no template', () => {
        expect(() =>
            selectDescriptors(builtinPingCreate, [{} as Descriptor])
        ).toThrow(/no template/)
    })

    it('rejects a transaction without a tree', () => {
        const tx = encode(PreparedTransaction.create({}))
        expect(() => selectDescriptors(tx, [])).toThrow(
            /prepared transaction has no transaction/
        )
    })
})
