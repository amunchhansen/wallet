// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

export {
    clearSign,
    type ClearSigningResult,
    type DescribedField,
    type DescriptorInfo,
    type IntentPart,
    type OperationDescription,
} from './clear-sign.js'
export {
    DescriptorError,
    parseDescriptor,
    type Descriptor,
    type Field,
    type Format,
    type Operation,
} from './descriptor.js'
export {
    templateKey,
    TransactionShapeError,
    type TemplateRef,
} from './roots.js'
export { shippedDescriptors } from './shipped.js'
