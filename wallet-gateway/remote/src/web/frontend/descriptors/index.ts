// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { css, html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'

import { BaseElement } from '@canton-network/core-wallet-ui-components'
import type { Descriptor } from '@canton-network/core-wallet-services/clear-signing'

import '../index'
import {
    activeDescriptors,
    type ActiveDescriptor,
    addDescriptor,
    removeDescriptor,
} from '../descriptors-store.js'
import { showToast } from '../utils.js'

function choiceLabel(entry: unknown): string {
    if (entry === null || typeof entry !== 'object') return ''
    const choice = 'choice' in entry ? entry.choice : undefined
    if (typeof choice !== 'string') return ''
    const iface = 'interface' in entry ? entry.interface : undefined
    if (iface === null || typeof iface !== 'object') return choice
    const moduleName = 'moduleName' in iface ? iface.moduleName : undefined
    const entityName = 'entityName' in iface ? iface.entityName : undefined
    return typeof moduleName === 'string' && typeof entityName === 'string'
        ? `${choice} via ${moduleName}:${entityName}`
        : choice
}

const SOURCE_BADGE: Record<ActiveDescriptor['source'], string> = {
    'built-in': 'text-bg-secondary',
    uploaded: 'text-bg-primary',
    'replaces built-in': 'text-bg-warning',
}

@customElement('user-ui-descriptors')
export class UserUiDescriptors extends BaseElement {
    @state() accessor descriptors: ActiveDescriptor[] = []
    @state() accessor pasted = ''
    /** Why the last upload was rejected, one line per problem. */
    @state() accessor problems: string[] = []

    static styles = [
        BaseElement.styles,
        css`
            :host {
                display: block;
                max-width: 900px;
                margin: 0 auto;
            }

            .upload,
            .descriptor {
                display: flex;
                flex-direction: column;
                gap: var(--wg-space-2);
                padding: var(--wg-space-4);
                margin-bottom: var(--wg-space-4);
                border: 1px solid var(--wg-border);
                border-radius: var(--wg-radius-lg);
            }

            .descriptor-heading {
                display: flex;
                align-items: baseline;
                gap: var(--wg-space-2);
            }

            dl {
                display: grid;
                grid-template-columns: minmax(0, 8.5rem) minmax(0, 1fr);
                gap: var(--wg-space-1) var(--wg-space-3);
                margin: 0;
            }

            dd {
                margin: 0;
                word-break: break-word;
            }

            .identifier,
            pre {
                font-family: var(--bs-font-monospace);
                font-size: var(--wg-font-size-sm);
            }

            textarea {
                font-family: var(--bs-font-monospace);
            }
        `,
    ]

    connectedCallback(): void {
        super.connectedCallback()
        this.reload()
    }

    private reload() {
        this.descriptors = activeDescriptors()
    }

    private add(json: unknown, origin: string): boolean {
        try {
            const d = addDescriptor(json)
            showToast(
                '',
                `Added '${d.metadata?.name ?? 'descriptor'}' (${origin})`,
                'success'
            )
            return true
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error)
            this.problems = [...this.problems, `${origin}: ${message}`]
            return false
        }
    }

    private addPasted() {
        this.problems = []
        try {
            if (this.add(JSON.parse(this.pasted), 'pasted JSON')) {
                this.pasted = ''
            }
        } catch {
            this.problems = ['pasted JSON: not valid JSON']
        }
        this.reload()
    }

    private async addFiles(e: Event) {
        const input = e.target as HTMLInputElement
        this.problems = []
        for (const file of Array.from(input.files ?? [])) {
            try {
                this.add(JSON.parse(await file.text()), file.name)
            } catch {
                this.problems = [
                    ...this.problems,
                    `${file.name}: not valid JSON`,
                ]
            }
        }
        input.value = ''
        this.reload()
    }

    private deleteUpload(d: Descriptor) {
        removeDescriptor(d)
        showToast(
            '',
            `Removed '${d.metadata?.name ?? 'descriptor'}'`,
            'success'
        )
        this.reload()
    }

    protected render() {
        return html`
            <h1 class="h4 fw-semibold">Clear-signing descriptors</h1>
            <p class="text-body-secondary small">
                Uploaded descriptors are stored in this browser only and are
                used by the approve page here. They are not verified. An upload
                is kept when it names a template, and one for the template of a
                built-in descriptor replaces it. The approve page reports a
                descriptor that is not valid.
            </p>

            <section class="upload">
                <label class="form-label mb-0" for="descriptor-files"
                    >Upload descriptor files</label
                >
                <input
                    id="descriptor-files"
                    class="form-control"
                    type="file"
                    accept=".json,application/json"
                    multiple
                    @change=${this.addFiles}
                />
                <label class="form-label mb-0" for="descriptor-json"
                    >Or paste descriptor JSON</label
                >
                <textarea
                    id="descriptor-json"
                    class="form-control"
                    rows="6"
                    .value=${this.pasted}
                    @input=${(e: Event) =>
                        (this.pasted = (e.target as HTMLTextAreaElement).value)}
                ></textarea>
                <div>
                    <button
                        class="btn btn-primary btn-sm rounded-pill"
                        type="button"
                        ?disabled=${!this.pasted.trim()}
                        @click=${this.addPasted}
                    >
                        Add
                    </button>
                </div>
                ${
                    this.problems.length
                        ? html`<div
                              class="alert alert-danger small mb-0"
                              role="alert"
                          >
                              <ul class="mb-0">
                                  ${this.problems.map((p) => html`<li>${p}</li>`)}
                              </ul>
                          </div>`
                        : nothing
                }
            </section>

            ${this.descriptors.map((a) => this.renderCard(a))}
        `
    }

    private renderCard(active: ActiveDescriptor) {
        try {
            return this.renderDescriptor(active)
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error)
            return html`<section class="descriptor">
                <p class="text-danger mb-0">${message}</p>
            </section>`
        }
    }

    private renderDescriptor({ descriptor, source }: ActiveDescriptor) {
        // An upload is kept once it names a template, so exercises may not be a list.
        // Mapping a non-list throws, and Lit then draws no cards at all.
        const shown = descriptor as {
            metadata?: {
                name?: string
                version?: string
                publisher?: string
            }
            context?: { template?: Descriptor['context']['template'] }
            display?: { create?: unknown; exercises?: unknown }
        }
        const metadata = shown.metadata
        const template = shown.context?.template
        const exercises = shown.display?.exercises
        const choices = Array.isArray(exercises)
            ? exercises.flatMap((entry) => {
                  const label = choiceLabel(entry)
                  return label === '' ? [] : [label]
              })
            : []
        return html`
            <section class="descriptor">
                <div class="descriptor-heading">
                    <h2 class="h6 fw-semibold mb-0">
                        ${metadata?.name ?? 'Untitled descriptor'}
                    </h2>
                    <span class="badge rounded-pill ${SOURCE_BADGE[source]}"
                        >${source}</span
                    >
                </div>
                <dl class="small">
                    <dt>Version</dt>
                    <dd>${metadata?.version ?? ''}</dd>
                    <dt>Publisher</dt>
                    <dd>${metadata?.publisher ?? ''}</dd>
                    <dt>Template</dt>
                    <dd class="identifier">
                        ${
                            template
                                ? `${template.moduleName}:${template.entityName}`
                                : ''
                        }
                    </dd>
                    <dt>Package</dt>
                    <dd class="identifier">${template?.packageId ?? ''}</dd>
                    <dt>Create</dt>
                    <dd>
                        ${shown.display?.create ? 'described' : 'not described'}
                    </dd>
                    <dt>Choices</dt>
                    <dd class="identifier">
                        ${choices.length ? choices.join(', ') : 'none'}
                    </dd>
                </dl>
                <details>
                    <summary class="small">JSON</summary>
                    <pre class="mb-0">
${JSON.stringify(descriptor, null, 2)}</pre>
                </details>
                ${
                    source === 'built-in'
                        ? nothing
                        : html`<div>
                              <button
                                  class="btn btn-outline-danger btn-sm rounded-pill"
                                  type="button"
                                  @click=${() => this.deleteUpload(descriptor)}
                              >
                                  Delete
                              </button>
                          </div>`
                }
            </section>
        `
    }
}
