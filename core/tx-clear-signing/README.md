# @canton-network/core-tx-clear-signing

Describes what a Canton prepared transaction does, in words, before it is signed. Each root node of the transaction (a create or an exercise) is described by a _clear-signing descriptor_: a JSON document bound to one exact Daml template (package ID, module and entity), with a stable intent, an interpolated intent and typed fields. Child nodes are consequences of the root and are not described.

The descriptor format is the v1 _Canton Clear Signing Descriptor_ schema, modelled on ERC-7730.

## Usage

```typescript
import {
    clearSign,
    parseDescriptor,
    shippedDescriptors,
} from '@canton-network/core-tx-clear-signing'

// preparedTransaction: base64, as returned by /v2/interactive-submission/prepare.
// Pass every descriptor this build trusts. clearSign binds each one by package ID, module and entity.
const { complete, operations } = clearSign(preparedTransaction, [
    ...shippedDescriptors(),
    parseDescriptor(descriptorJson),
])
```

- `parseDescriptor` validates descriptor JSON, including the rules a JSON Schema cannot express (placeholders name declared fields, enum references exist, constant paths name a scalar constant). It throws `DescriptorError`. `$schema` must be `https://example.org/canton-clear-signing/v1/schema.json`. That URL is a placeholder: this repository does not publish a JSON Schema document for it.
- `clearSign` takes the transaction as base64, so unknown protobuf fields are refused, and returns one `OperationDescription` per root node:
    - `described`: the interpolated intent rendered;
    - `fallback`: a placeholder did not resolve, so `intent` is the descriptor's stable intent;
    - `undescribed`: no descriptor covers the node, so `intent` is generic (`Create Module:Entity`).

    `complete` is true only when every root is described and every field rendered. A wallet should warn the user otherwise.

### Identifying the operation

Every `OperationDescription` says what the node is, whether or not a descriptor covers it:

| Field              | Value                                                                                                                          | Source      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `kind`             | `create` or `exercise`                                                                                                         | transaction |
| `template`         | package ID, module and entity of the created or exercised template                                                             | transaction |
| `choiceId`         | the exercised choice's name; with `template`, this selects the descriptor entry (exercise only)                                | transaction |
| `interface`        | package ID, module and entity of the interface the choice is exercised through, if any. Not used to select the descriptor      | transaction |
| `descriptor`       | `name`, `publisher`, `version` and `url?` from the bound descriptor's `metadata`, whether or not it has an entry for this node | descriptor  |
| `intent`, `fields` | the wording and values                                                                                                         | descriptor  |

A wallet should show `kind`, `choiceId`, `interface` and `template` next to the intent, and show `descriptor` as the descriptor's own claim (`Described by <name> v<version> by <publisher>`). The first group is read from the signed transaction, so a descriptor cannot change which action or choice the user is told about. `descriptor` is unauthenticated in v1, because descriptors carry no verified signature yet.

The description is only as trustworthy as its binding to what is signed: compare the transaction's hash with the hash you sign (see `@canton-network/core-tx-hashing`). Transactions with unknown protobuf fields are rejected.
