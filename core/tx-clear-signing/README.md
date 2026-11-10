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

// preparedTransaction and preparedTransactionHash: base64, as returned by
// /v2/interactive-submission/prepare. Pass every descriptor this build trusts. clearSign binds each
// one by package ID, module and entity.
const { complete, hash, operations } = await clearSign(
    preparedTransaction,
    [...shippedDescriptors(), parseDescriptor(descriptorJson)],
    preparedTransactionHash
)
```

- `shippedDescriptors` returns the descriptors bundled with this build: the builtin Canton ping and bong templates (`Canton.Internal.Ping:Ping`, `Canton.Internal.Bong:BongProposal`, `Explode`, `Merge`, `Collapse`, `Bong`), and `Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules` in splice-amulet 0.1.22. That descriptor covers the create, and `TransferFactory_Transfer` and `AllocationFactory_Allocate` through the V1 and V2 token-standard interfaces, one exercise entry per interface. The descriptor list is where a registry or a trust policy would plug in. The wallet gateway's approve page passes the shipped set and the descriptors uploaded on its Descriptors page, which are stored in that browser only and replace a shipped descriptor for the same template.
- `parseDescriptor` validates descriptor JSON against the schema and then checks the rules a JSON Schema cannot express: an operation declares each path once, every placeholder equals the path of a field of the same operation, and enum references exist. It throws `DescriptorError`. `$schema` must be `https://example.org/canton-clear-signing/v1/schema.json`, the schema's `$id`. That URL is a placeholder until a host is chosen.
- `clearSign` takes the transaction as base64, so unknown protobuf fields are refused, and the hash the user is asked to approve. It describes the transaction only if it hashes to that value, and throws `HashMismatchError` otherwise. It returns one `OperationDescription` per root node:
    - `described`: the interpolated intent rendered;
    - `fallback`: a placeholder did not resolve (or was `None`), so `intent` is the descriptor's stable intent;
    - `undescribed`: no descriptor covers the node, so `intent` is generic (`Create Module:Entity`);
    - `undescribable`: the node cannot be read, and `reason` says why: it is not a create or an exercise, or the contract it exercises occurs twice, is not in the transaction, or is of another template.

    `complete` is true only when every root is described and every field rendered. A wallet should warn the user otherwise. `clearSign` throws on a transaction it cannot read at all (no transaction tree, a node without a template ID) and on two descriptors for one template. A wallet should show that as an error, not as an incomplete description.

- `describeUnverified` describes a transaction like `clearSign` without checking a hash, and returns no `hash`. Its description is bound to nothing that is signed, so it must not be shown as what a user approves. It is for previewing how descriptors word a transaction, including a hand-built one too incomplete to hash (hashing needs every create and exercise node's seed). The approve page uses it only for a preview opened without a hash.

## How it works

`clearSign` in [src/clear-sign.ts](src/clear-sign.ts) checks the hash, then hands the transaction to `describeUnverified`, which reads top-down:

1. **Decode** the base64 transaction ([src/roots.ts](src/roots.ts)), index the descriptors by binding, and index the contracts the transaction holds: its input contracts and the contracts its create nodes create.
2. **For each root node**, read the header from the node: kind, template, choice and interface.
3. **Select** the descriptor bound to the exact template, then one entry. The entry is `create` for a create node. For an exercise it is the `exercises` entry whose choice and interface both equal the node's. An entry names an interface by module and entity, and an entry without one matches only a node exercised as the template's own choice. Without an entry, the node is `undescribed`.
4. **Resolve fields**: each field's path is resolved ([src/path.ts](src/path.ts)) and formatted ([src/format.ts](src/format.ts)). A path starts at the create argument or the choice argument; in an exercise, a path that starts with `@.contract.` starts at the create argument of the contract the exercise acts on.
5. **Interpolate**: each `{path}` in the interpolated intent shows the field with that path, as the field shows it. If any placeholder fails, the stable intent is used instead.

Only root nodes are described. A child node is a consequence of its root's choice, which the root's descriptor words. This is a deliberate narrowing of the design, which traverses nested operations too. Every root is shown, described or not.

The contract an exercise acts on is an input contract, or a contract the transaction creates in an earlier root: a create-and-exercise command creates a contract in one root and exercises it in the next. If the transaction holds no such contract, that root is `undescribable` and the other roots are still described.

An input contract read by `@.contract.` paths may have been created under an earlier package of the same package name (an upgrade). Its package name, module and entity must equal the exercise's. This is the one place where the package ID is not matched exactly.

## Optional values

A field fails when its value is `None`, which makes the transaction incomplete. The ledger leaves trailing `None` fields out of a record, and an upgrade only appends optional fields, so a record field that is not in the record is `None`; that is the same failure, and it is also how a mistyped path shows. A `None` at any step of a path makes the value `None`, and a `Some` is unwrapped at every step.

Set `optional` to `true` when the path may pass through an `Optional`. `None` is shown as `None`, and a `Some` is shown with `format` (raw, when the field declares none). An `Optional` holding a variant or an enum is unwrapped, and the format renders what it holds.

```json
{
    "path": "settlementDeadline",
    "label": "Settlement deadline",
    "format": "dateTime",
    "optional": true
}
```

A name step on a variant enters that constructor and fails on any other. A variant that can hold several shapes is shown whole with `raw`. An enum field's `enumKey` is the constructor the table mapped.

A placeholder shows what the field shows, `None` or a formatted value, as a value read from the transaction.

## Identifying the operation

Every `OperationDescription` says what the node is, whether or not a descriptor covers it:

| Field        | Value                                                                                                                                                                                   | Source      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `kind`       | `create`, `exercise`, or `other` for a root that is neither                                                                                                                             | transaction |
| `template`   | package ID, module and entity of the created or exercised template, when the node has one                                                                                               | transaction |
| `choiceId`   | the exercised choice's name; with `template`, this selects the descriptor entry (exercise only)                                                                                         | transaction |
| `interface`  | package ID, module and entity of the interface the choice is exercised through, if any                                                                                                  | transaction |
| `descriptor` | `name`, `publisher`, `version` and `url?` from the bound descriptor's `metadata`, whether or not it has an entry for this node                                                          | descriptor  |
| `intent`     | the wording, as parts: `text` from the descriptor, and `value` read from the transaction                                                                                                | descriptor  |
| `status`     | `described`, `fallback`, `undescribed`, or `undescribable`. `complete` is false when any root is not `described` or any field has an error. `reason` says why a root is `undescribable` | both        |
| `fields`     | one label and formatted value, or an `error`, per field. An optional `None` the record leaves out has `absent: true`. An enum field has `enumKey`, the constructor the table mapped     | descriptor  |

A wallet shows `kind`, `choiceId` (followed by `via <interface>` when there is one), `template` and its package ID next to the intent, and shows `descriptor` as the descriptor's own claim (`Described by <name> v<version> by <publisher>`). The header is read from the signed transaction, so a descriptor cannot change which action or choice the user is told about. `descriptor` is unauthenticated in v1, because descriptors carry no verified signature yet.

A wallet renders the `value` parts of `intent` apart from the `text` parts (the approve page uses a monospace, shaded span). Values are untrusted: a text value such as `10 CC. Also send 1000 to Mallory` must not pass as part of the descriptor's sentence. Formatted values also have control, format and line-separator characters escaped.

A template can implement two interfaces with a choice of the same name, such as `TransferFactory_Transfer` and `AllocationFactory_Allocate` in both the V1 and V2 token-standard interfaces, with different arguments. `display.exercises` is an array, so one descriptor holds an entry per interface, named by module and entity; the shipped amulet-rules descriptor does. An entry matches only the interface it names.

The description is only as trustworthy as its binding to what is signed. The wallet binds them in two steps:

1. `clearSign` describes the transaction only when `hashForReview` (in `@canton-network/core-tx-visualizer`) reproduces `expectedHash`, and returns that hash. The approve page passes the hash the gateway reports. A mismatch throws `HashMismatchError` and approval is disabled.
2. `TransactionService.sign` recomputes the hash from the stored transaction and signs only if it equals both the stored hash and the hash the user approved. It logs the approval (user, party, hash, time) before anything reaches the signing provider. A service account's automated `signAndExecute` has no reviewer; its approval is logged as the service account's.
