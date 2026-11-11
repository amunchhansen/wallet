// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Descriptor } from './descriptor.js'
import {
    decode,
    rootNodes,
    templateKey,
    templateRef,
    type RootNode,
    type TemplateRef,
} from './roots.js'

/**
 * Indexes descriptors by the template they bind to.
 *
 * @throws Error when two descriptors bind the same template. `clearSign` allows one per template.
 */
export function indexByTemplate(
    descriptors: readonly Descriptor[]
): Map<string, Descriptor> {
    const byTemplate = new Map<string, Descriptor>()
    for (const descriptor of descriptors) {
        const key = templateKey(descriptor.context.template)
        if (byTemplate.has(key)) {
            throw new Error(`more than one descriptor for template '${key}'`)
        }
        byTemplate.set(key, descriptor)
    }
    return byTemplate
}

/**
 * The candidates bound to the templates of the transaction's root nodes, one per template, in root
 * order. A root template with no candidate is left out; `clearSign` reports that root as undescribed.
 * Child nodes are not selected, because only roots are described.
 *
 * Selection does not check the hash and decides nothing about trust. `clearSign` still binds every
 * root to its descriptor by exact package ID, module and entity, and checks the hash.
 *
 * @throws Error when two candidates bind the same template
 * @throws TransactionShapeError when the transaction cannot be read
 */
export function selectDescriptors(
    tx: string,
    candidates: readonly Descriptor[]
): Descriptor[] {
    const byTemplate = indexByTemplate(candidates)
    const selected: Descriptor[] = []
    const seen = new Set<string>()
    for (const node of rootNodes(decode(tx))) {
        const template = rootTemplate(node)
        if (!template) continue
        const key = templateKey(template)
        if (seen.has(key)) continue
        seen.add(key)
        const descriptor = byTemplate.get(key)
        if (descriptor) selected.push(descriptor)
    }
    return selected
}

function rootTemplate(node: RootNode): TemplateRef | undefined {
    if (node.kind === 'create') {
        return templateRef(node.create.templateId, node.nodeId)
    }
    if (node.kind === 'exercise') {
        return templateRef(node.exercise.templateId, node.nodeId)
    }
    return undefined
}
