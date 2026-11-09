# @canton-network/core-tx-clear-signing

Describes what a Canton prepared transaction does, in words, before it is signed. Each root node of the transaction (a create or an exercise) is described by a _clear-signing descriptor_: a JSON document bound to one exact Daml template (package ID, module and entity), with a stable intent, an interpolated intent and typed fields.

The descriptor format is the v1 _Canton Clear Signing Descriptor_ schema, modelled on ERC-7730. The tests run the schema's own valid and invalid examples (`src/__tests__/schema-examples`, copied unchanged from the schema's repository) through `parseDescriptor`, so the parser and the schema cannot drift apart.

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

- `shippedDescriptors` returns the descriptors bundled with this build: the builtin Canton ping and bong templates (`Canton.Internal.Ping:Ping`, `Canton.Internal.Bong:BongProposal`, `Explode`, `Merge`, `Collapse`, `Bong`), and every exercise on `Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules` in splice-amulet 0.1.22. The descriptor list is where a registry or a trust policy would plug in: `TransactionService` passes the shipped set. The wallet gateway's approve page also passes descriptors uploaded on its Descriptors page, which are stored in that browser only and replace a shipped descriptor for the same template.
- `parseDescriptor` validates descriptor JSON against the schema and then checks the rules a JSON Schema cannot express: an operation declares each path once, placeholders name declared fields, and enum references exist. It throws `DescriptorError`. `$schema` must be `https://example.org/canton-clear-signing/v1/schema.json`, the schema's `$id`. That URL is a placeholder until a host is chosen.
- `clearSign` takes the transaction as base64, so unknown protobuf fields are refused, and returns one `OperationDescription` per root node:
    - `described`: the interpolated intent rendered;
    - `fallback`: a placeholder did not resolve (or was `None`), so `intent` is the descriptor's stable intent;
    - `undescribed`: no descriptor covers the node, so `intent` is generic (`Create Module:Entity`).

    `complete` is true only when every root is described and every field rendered. A wallet should warn the user otherwise. `clearSign` throws on a malformed transaction (a missing root, a contract ID that occurs twice, an `@.contract` contract of another template). A wallet should show that as an error, not as an incomplete description.

## How it works

`clearSign` in [src/clear-sign.ts](src/clear-sign.ts) reads top-down:

1. **Decode** the base64 transaction ([src/roots.ts](src/roots.ts)) and index the descriptors by template.
2. **For each root node**, read the header from the node: kind, template, choice and interface.
3. **Select** the descriptor bound to the exact template, then its `create` entry or the `exercises` entry with the node's choice name. Without one, the node is `undescribed`.
4. **Resolve fields**: each field's path is resolved against the create argument or the choice argument ([src/path.ts](src/path.ts)) and formatted ([src/format.ts](src/format.ts)).
5. **Interpolate**: each `{path}` in the interpolated intent is formatted like the field with that path. `{@.contract.<path>}` is the `create` field with `<path>`, resolved against the create argument of the contract the exercise acts on. If any placeholder fails, the stable intent is used instead.

Only root nodes are described. A child node is a consequence of its root's choice, which the root's descriptor words. This is a deliberate narrowing of the design, which traverses nested operations too. Every root is shown, described or not.

A root exercise can only act on an input contract of the transaction, since no earlier node can have created it. If the exercised contract is not an input contract, `clearSign` throws a `TransactionShapeError` and the approve page reports that the transaction cannot be described.

The contract read by `{@.contract.…}` may be an input contract created under an earlier package of the same package name (an upgrade). Its package name, module and entity must equal the exercise's. This is the one place where the package ID is not matched exactly.

## Identifying the operation

Every `OperationDescription` says what the node is, whether or not a descriptor covers it:

| Field        | Value                                                                                                                                                                                                                                                                                       | Source      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `kind`       | `create` or `exercise`                                                                                                                                                                                                                                                                      | transaction |
| `template`   | package ID, module and entity of the created or exercised template                                                                                                                                                                                                                          | transaction |
| `choiceId`   | the exercised choice's name; with `template`, this selects the descriptor entry (exercise only)                                                                                                                                                                                             | transaction |
| `interface`  | package ID, module and entity of the interface the choice is exercised through, if any                                                                                                                                                                                                      | transaction |
| `descriptor` | `name`, `publisher`, `version` and `url?` from the bound descriptor's `metadata`, whether or not it has an entry for this node                                                                                                                                                              | descriptor  |
| `intent`     | the wording, as parts: `text` from the descriptor, and `value` read from the transaction                                                                                                                                                                                                    | descriptor  |
| `fields`     | one label and formatted value per field; a `None` is shown as `None`, with `absent: true` when the field is not in the record (the ledger leaves trailing `None` fields out). A field with cases has `case` (the matched constructor, `Some` or `None`) and the matched case's own `fields` | descriptor  |

A wallet shows `kind`, `choiceId` (followed by `via <interface>` when there is one), `template` and its package ID next to the intent, and shows `descriptor` as the descriptor's own claim (`Described by <name> v<version> by <publisher>`). The header is read from the signed transaction, so a descriptor cannot change which action or choice the user is told about. `descriptor` is unauthenticated in v1, because descriptors carry no verified signature yet.

A wallet renders the `value` parts of `intent` apart from the `text` parts (the approve page uses a monospace, shaded span). Values are untrusted: a text value such as `10 CC. Also send 1000 to Mallory` must not pass as part of the descriptor's sentence. Formatted values also have control, format and line-separator characters escaped.

Exercise entries are selected by choice name alone. A template that implements two interfaces with a choice of the same name, such as `AllocationFactory_Allocate`, `TransferFactory_Transfer`, and the public-fetch choices in both the V1 and V2 token-standard interfaces, gets the same entry for both. When the argument shapes differ, the paths do not resolve and the node falls back to the stable intent. The amulet-rules entries describe the V2 argument.

The description is only as trustworthy as its binding to what is signed. The wallet binds them in two steps:

1. The approve page computes the hash from the transaction bytes it describes (`hashForReview` in `@canton-network/core-tx-visualizer`), shows that hash, and sends it with the user's `sign` request. If the bytes do not reproduce the hash the gateway reports, approval is disabled.
2. `TransactionService.sign` recomputes the hash from the stored transaction and signs only if it equals both the stored hash and the hash the user approved. It logs the approval (user, party, hash, time) before anything reaches the signing provider. A service account's automated `signAndExecute` has no reviewer; its approval is logged as the service account's.
