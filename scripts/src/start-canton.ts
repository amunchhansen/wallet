// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Start a local Canton participant using the config file in the canton/ directory.
 */

import {
    CANTON_PATH,
    SUPPORTED_VERSIONS,
    error,
    info,
    trimNewline,
    getNetworkArg,
    type Network,
    getArgValue,
    repoRoot,
} from './lib/utils.js'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import fs from 'fs'
import pm2 from 'pm2'
import path from 'path'

// Oracle JDK refuses the BouncyCastle classes shaded into the unsigned Canton
// fat jar. The signed provider jar has to be the first entry on the classpath.
// See the Canton install notes, "Run using the Oracle JDK".
const BCPROV_VERSION = '1.85'
const BCPROV_SHA256 =
    '20af26bf6060bb8005cc2389916812c1e0e998dc48d2ced7131b89461b54cff7'

interface CantonLauncher {
    progHome: string
    jar: string
    version: string
    revision: string
}

function cantonLauncher(binPath: string): CantonLauncher {
    const text = fs.readFileSync(binPath, 'utf8')
    const version = text.match(/^PROG_VERSION=(.+)$/m)?.[1]
    const revision = text.match(/^PROG_REVISION=(.+)$/m)?.[1]
    const jarName = text.match(
        /\$\{PROG_HOME\}\/lib\/([^$]+)\$\{CLASSPATH_SEPARATOR\}/
    )?.[1]
    if (!version || !revision || !jarName) {
        throw new Error(`Could not read the Canton launcher at '${binPath}'.`)
    }
    const progHome = path.resolve(path.dirname(binPath), '..')
    return {
        progHome,
        jar: path.join(progHome, 'lib', jarName),
        version,
        revision,
    }
}

async function signedBcprovJar(): Promise<string> {
    const dest = path.join(CANTON_PATH, `bcprov-jdk18on-${BCPROV_VERSION}.jar`)
    const current = fs.existsSync(dest) ? fs.readFileSync(dest) : undefined
    const currentHash = current
        ? createHash('sha256').update(current).digest('hex')
        : undefined
    if (currentHash === BCPROV_SHA256) return dest

    const url = `https://repo1.maven.org/maven2/org/bouncycastle/bcprov-jdk18on/${BCPROV_VERSION}/bcprov-jdk18on-${BCPROV_VERSION}.jar`
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(
            `Failed to download the signed BouncyCastle provider from '${url}': ${response.status}`
        )
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== BCPROV_SHA256) {
        throw new Error(
            `Signed BouncyCastle provider hash is '${hash}', expected '${BCPROV_SHA256}'.`
        )
    }
    fs.mkdirSync(CANTON_PATH, { recursive: true })
    fs.writeFileSync(dest, bytes)
    return dest
}

function javaCommand(): string {
    return execFileSync('which', ['java'], { encoding: 'utf8' }).trim()
}

const processName = 'canton'

async function main() {
    const network: Network = getNetworkArg()
    const tlsEnabled: boolean = getArgValue('tls') === 'true'

    const envConfig = SUPPORTED_VERSIONS[network]?.canton
    if (!envConfig) {
        console.error(
            error(
                `Unsupported canton version ${network}. Please use "mainnet" or "devnet. If no argument is supplied, will use mainnet as a default"`
            )
        )
        process.exit(1)
    }

    const networkDir = path.resolve(`canton/${network}`)
    const inputCantonConf = path.join(
        networkDir,
        tlsEnabled ? 'canton-tls-enabled.conf' : 'canton.conf'
    )

    const cantonBootstrap = path.join(networkDir, 'bootstrap.sc')

    const { version } = envConfig

    const CANTON_BIN = path.resolve(`.canton/${version}/bin/canton`)

    for (const file of [CANTON_BIN, inputCantonConf, cantonBootstrap]) {
        if (!fs.existsSync(file)) {
            console.error(error(`Required file not found: ${file}`))
            process.exit(1)
        }
    }

    const launcher = cantonLauncher(CANTON_BIN)
    if (!fs.existsSync(launcher.jar)) {
        console.error(error(`Required file not found: ${launcher.jar}`))
        process.exit(1)
    }
    const bcprov = await signedBcprovJar()
    const java = javaCommand()
    const classpath = `${bcprov}${path.delimiter}${launcher.jar}`

    console.log(
        info(`Using bootstrap: ${cantonBootstrap} and conf: ${inputCantonConf}`)
    )

    console.log(
        info(
            `Starting Canton participant with the signed BouncyCastle provider ahead of ${launcher.jar}...`
        )
    )
    pm2.connect(function (err) {
        if (err) {
            console.error(err)
            process.exit(2)
        }

        //delete old process if exists - this is useful for if we change networks
        pm2.delete(processName, () => {
            pm2.start(
                {
                    name: processName,
                    interpreter: 'none',
                    cwd: repoRoot,
                    script: java,
                    args: [
                        '-XX:+CrashOnOutOfMemoryError',
                        `-Dprog.home=${launcher.progHome}`,
                        `-Dprog.version=${launcher.version}`,
                        `-Dprog.revision=${launcher.revision}`,
                        '-cp',
                        classpath,
                        'com.digitalasset.canton.CantonCommunityApp',
                        'daemon',
                        '--no-tty',
                        '--config',
                        inputCantonConf,
                        '--bootstrap',
                        cantonBootstrap,
                        '--log-level-stdout=INFO',
                        '--log-level-canton=INFO',
                    ],
                },
                function (err) {
                    pm2.launchBus((err, bus) => {
                        // oxlint-disable-next-line typescript/no-explicit-any
                        bus.on('log:out', (packet: any) => {
                            if (packet.process.name == processName)
                                console.log(info(trimNewline(packet.data)))
                        })
                        // oxlint-disable-next-line typescript/no-explicit-any
                        bus.on('log:err', (packet: any) => {
                            if (packet.process.name == processName)
                                console.error(error(trimNewline(packet.data)))
                        })
                    })
                    if (err) {
                        console.error(err)
                        return pm2.disconnect()
                    }
                }
            )
        })
    })
}

void main()
