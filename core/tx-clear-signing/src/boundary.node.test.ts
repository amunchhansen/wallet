// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const ALLOWED = new Set([
    '@canton-network/core-ledger-proto',
    '@canton-network/core-tx-hashing',
])

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return sourceFiles(path)
        return path.endsWith('.ts') ? [path] : []
    })
}

describe('package boundary', () => {
    it('depends only on the protobuf bindings, the hasher and zod', () => {
        const pkg: { dependencies: Record<string, string> } = JSON.parse(
            readFileSync(join(root, 'package.json'), 'utf8')
        )
        expect(Object.keys(pkg.dependencies).sort()).toEqual([
            '@canton-network/core-ledger-proto',
            '@canton-network/core-tx-hashing',
            'zod',
        ])
    })

    it('imports no other @canton-network package', () => {
        const specifier =
            /(?:import|export)[\s\S]*?from\s+['"](@canton-network\/[^'"]+)['"]/g
        const offenders: string[] = []
        for (const file of sourceFiles(join(root, 'src'))) {
            const text = readFileSync(file, 'utf8')
            for (const match of text.matchAll(specifier)) {
                const imported = match[1]
                if (imported !== undefined && !ALLOWED.has(imported)) {
                    offenders.push(`${file}: ${imported}`)
                }
            }
        }
        expect(offenders).toEqual([])
    })
})
