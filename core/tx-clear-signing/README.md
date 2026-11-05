# @canton-network/core-tx-clear-signing

Describes what a Canton prepared transaction does, in words, before it is signed. Each root node of the transaction (a create or an exercise) is described by a _clear-signing descriptor_: a JSON document bound to one exact Daml template (package ID, module and entity), with a stable intent, an interpolated intent and typed fields. Child nodes are consequences of the root and are not described.

The descriptor format is the v1 _Canton Clear Signing Descriptor_ schema, modelled on ERC-7730.

## Usage

```typescript
import {
    clearSign,
    parseDescriptor,
    requiredTemplates,
} from '@canton-network/core-tx-clear-signing'

// preparedTransaction: base64, as returned by /v2/interactive-submission/prepare
const needed = requiredTemplates(preparedTransaction)
const descriptors = needed.flatMap(lookUpDescriptorJson).map(parseDescriptor)

const { complete, operations } = clearSign(preparedTransaction, descriptors)
for (const op of operations) {
    console.log(op.status, op.intent, op.fields)
}
```

- `requiredTemplates` returns the template of each root node, de-duplicated.
- `parseDescriptor` validates descriptor JSON, including the rules a JSON Schema cannot express (placeholders name declared fields, enum references exist). It throws `DescriptorError`.
- `clearSign` returns one `OperationDescription` per root node:
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
| `choiceId`         | the exercised choice's own name (exercise only)                                                                                | transaction |
| `interface`        | the interface the choice is exercised through, if any (exercise only)                                                          | transaction |
| `choice`           | the descriptor lookup key: `choiceId`, or `Module:Entity:ChoiceId` of the interface when there is one                          | transaction |
| `descriptor`       | `name`, `publisher`, `version` and `url?` from the bound descriptor's `metadata`, whether or not it has an entry for this node | descriptor  |
| `intent`, `fields` | the wording and values                                                                                                         | descriptor  |

A wallet should show `kind`, `choiceId`, `interface` and `template` next to the intent, and show `descriptor` as the descriptor's own claim (`Described by <name> v<version> by <publisher>`). The first group is read from the signed transaction, so a descriptor cannot change which action or choice the user is told about. `descriptor` is unauthenticated in v1, because descriptors carry no verified signature yet.

The description is only as trustworthy as its binding to what is signed: compare the transaction's hash with the hash you sign (see `@canton-network/core-tx-hashing`). Transactions with unknown protobuf fields are rejected.
