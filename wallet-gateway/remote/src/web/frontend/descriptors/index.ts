// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { css, html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'

import { BaseElement } from '@canton-network/core-wallet-ui-components'
import {
    type Descriptor,
    DescriptorError,
} from '@canton-network/core-tx-clear-signing'

import '../index'
import {
    activeDescriptors,
    type ActiveDescriptor,
    addDescriptor,
    removeDescriptor,
} from '../descriptors-store.js'
import { showToast } from '../utils.js'

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
            showToast('', `Added '${d.metadata.name}' (${origin})`, 'success')
            return true
        } catch (error) {
            const problems =
                error instanceof DescriptorError
                    ? error.problems
                    : [error instanceof Error ? error.message : String(error)]
            this.problems = [
                ...this.problems,
                ...problems.map((p) => `${origin}: ${p}`),
            ]
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
        showToast('', `Removed '${d.metadata.name}'`, 'success')
        this.reload()
    }

    protected render() {
        return html`
            <h1 class="h4 fw-semibold">Clear-signing descriptors</h1>
            <p class="text-body-secondary small">
                Uploaded descriptors are stored in this browser only and are
                used by the approve page here. They are not verified. An upload
                for the template of a built-in descriptor replaces it.
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

            ${this.descriptors.map((a) => this.renderDescriptor(a))}
        `
    }

    private renderDescriptor({ descriptor, source }: ActiveDescriptor) {
        const { metadata, context, display } = descriptor
        const { packageId, moduleName, entityName } = context.template
        const choices = (display.exercises ?? []).map((entry) =>
            entry.interface
                ? `${entry.choice} via ${entry.interface.moduleName}:${entry.interface.entityName}`
                : entry.choice
        )
        return html`
            <section class="descriptor">
                <div class="descriptor-heading">
                    <h2 class="h6 fw-semibold mb-0">${metadata.name}</h2>
                    <span class="badge rounded-pill ${SOURCE_BADGE[source]}"
                        >${source}</span
                    >
                </div>
                <dl class="small">
                    <dt>Version</dt>
                    <dd>${metadata.version}</dd>
                    <dt>Publisher</dt>
                    <dd>${metadata.publisher}</dd>
                    <dt>Template</dt>
                    <dd class="identifier">${moduleName}:${entityName}</dd>
                    <dt>Package</dt>
                    <dd class="identifier">${packageId}</dd>
                    <dt>Create</dt>
                    <dd>${display.create ? 'described' : 'not described'}</dd>
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
