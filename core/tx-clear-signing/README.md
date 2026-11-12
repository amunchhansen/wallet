# @canton-network/core-tx-clear-signing

Describes what a Canton prepared transaction does, in words, before it is signed. Each root node of the transaction (a create or an exercise) is described by a _clear-signing descriptor_: a JSON document bound to one exact Daml template (package ID, module and entity), with a stable intent, an interpolated intent and typed fields.

The descriptor format is the v1 _Canton Clear Signing Descriptor_ schema, modelled on ERC-7730. The tests run the schema's own valid and invalid examples (`src/__tests__/schema-examples`, copied unchanged from the schema's repository) through the parser `clearSign` uses, so the parser and the schema cannot drift apart.

The package depends on the Canton protobuf bindings and on prepared-transaction hash recomputation. It does not depend on the wallet gateway. The public call is `clearSign`. The `Descriptor` type describes a descriptor. The result types and `HashMismatchError` and `ExtraDescriptorsError` are what a caller handles.

The descriptors shipped with the wallet gateways, merging uploads over that set, and choosing the descriptors a transaction uses live in `@canton-network/core-wallet-services/clear-signing`. Both gateways depend on that package.

## Usage

```typescript
import {
    clearSign,
    type Descriptor,
} from '@canton-network/core-tx-clear-signing'

// preparedTransaction and preparedTransactionHash: base64, as returned by
// /v2/interactive-submission/prepare. Pass one descriptor per create or exercise
// root template. clearSign validates them, binds each by package ID, module and
// entity, and checks the hash before it describes.
const { complete, hash, operations } = await clearSign(
    preparedTransaction,
    descriptors as Descriptor[],
    preparedTransactionHash
)
// operations[0].interpolatedIntent is the sentence, with values filled in.
```

`clearSign` is the call. Three fixed transactions in [examples/](examples) run it on their own:

```bash
pnpm exec tsx core/tx-clear-signing/examples/ping.ts
pnpm exec tsx core/tx-clear-signing/examples/allocation.ts
pnpm exec tsx core/tx-clear-signing/examples/showcase.ts
```

`ping.ts` describes a create of `Canton.Internal.Ping:Ping`. `allocation.ts` describes an `AllocationFactory_Allocate` exercise through the V2 token-standard interface. `showcase.ts` describes five roots with descriptors this build does not ship: a governance lock, a featured app right and an activity marker exercised on that right, a Splitwell balance update, and a DSO vote. Each prints the wording and exits with an error if that wording changes.

The ping example's preview opens the approve page with the pasted transaction. That page computes the transaction's hash and calls `clearSign`.

The wallet gateways keep the shipped descriptors, merge uploads, and select the descriptors for a transaction in `@canton-network/core-wallet-services/clear-signing`. The approve page passes the selected list to `clearSign`. The transaction detail renders the types `clearSign` returns (`TransactionDescription`, `OperationDescription`, `IntentPart`, `DescribedField`, `TemplateRef`). It calls none of these functions. The browser extension's approve page does not use this package.

## Behavior

`clearSign` takes the transaction as base64, so unknown protobuf fields are refused, and the hash the user is asked to approve. It recomputes the hash, trying scheme V3 and then V2, and the given hash only selects the scheme. The hash is checked first. The transaction is described only if the bytes hash to that value, and `clearSign` throws `HashMismatchError` otherwise. A transaction that cannot be hashed throws.

It then validates every descriptor. `$schema` must be `https://example.org/canton-clear-signing/v1/schema.json`, the schema's `$id`. That URL is a placeholder until a host is chosen. Validation also checks the rules a JSON Schema cannot express: an operation declares each path once, every placeholder equals the path of a field of the same operation, enum references exist, and no two exercise entries name the same choice and interface.

- A descriptor that names no template, names a template that is not a create or exercise root, or repeats a template is too many. `clearSign` throws `ExtraDescriptorsError` and does not describe the transaction. The message lists each one, and includes the validation problems when the descriptor is also invalid.
- A root with no descriptor is `undescribed`. `complete` is false.
- A descriptor that binds to a root but is not valid leaves that root `invalid`. `reason` lists the problems. When the metadata can still be read, `descriptor` carries it. `complete` is false.
- Otherwise it returns one `OperationDescription` per root node:
    - `described`: the interpolated intent rendered;
    - `fallback`: a placeholder did not resolve (or was `None`), so `intent` is the descriptor's stable intent;
    - `undescribed`: no descriptor covers the node, so `intent` is generic (`Create Module:Entity`);
    - `invalid`: the bound descriptor is not valid, so `intent` is generic and `reason` lists the problems;
    - `undescribable`: the node cannot be read, and `reason` says why: it is not a create or an exercise, or the contract it exercises occurs twice, is not in the transaction, or is of another template.

`complete` is true only when every root is described and every field rendered. A wallet should warn the user otherwise. `clearSign` throws on a transaction it cannot read at all (no transaction tree, a node without a template ID), on a transaction that cannot be hashed, and on too many descriptors. A wallet should show that as an error, not as an incomplete description. Too few descriptors, and a descriptor that is invalid but bound to a root, are an incomplete description.

The descriptors bundled for the gateways are the builtin Canton ping and bong templates (`Canton.Internal.Ping:Ping`, `Canton.Internal.Bong:BongProposal`, `Explode`, `Merge`, `Collapse`, `Bong`), and `Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules` in splice-amulet 0.1.22. That descriptor covers the create, and `TransferFactory_Transfer` and `AllocationFactory_Allocate` through the V1 and V2 token-standard interfaces, one exercise entry per interface. The approve page merges descriptors uploaded in that browser over this set. An upload for the same template replaces the shipped one. `selectDescriptors` then keeps the descriptors bound to the transaction's create and exercise roots.

## How it works

`clearSign` in [src/clear-sign.ts](src/clear-sign.ts) checks the hash, then describes each root:

1. **Decode** the base64 transaction ([src/roots.ts](src/roots.ts)) and validate the descriptors. A descriptor that is unused, repeated, or names no template throws `ExtraDescriptorsError`. One that names a create or exercise root but is not valid is bound to that root as `invalid`. The contracts the transaction holds are indexed too: its input contracts and the contracts its create nodes create.
2. **For each root node**, read the header from the node: kind, template, choice and interface.
3. **Select** the operation of a valid descriptor bound to the exact template. An invalid descriptor is not entered. The entry is `create` for a create node. For an exercise it is the `exercises` entry whose choice and interface both equal the node's. An entry names an interface by module and entity, and an entry without one matches only a node exercised as the template's own choice. Without an entry, the node is `undescribed`.
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

| Field                | Value                                                                                                                                                                                                           | Source      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `kind`               | `create`, `exercise`, or `other` for a root that is neither                                                                                                                                                     | transaction |
| `template`           | package ID, module and entity of the created or exercised template, when the node has one                                                                                                                       | transaction |
| `choiceId`           | the exercised choice's name; with `template`, this selects the descriptor entry (exercise only)                                                                                                                 | transaction |
| `interface`          | package ID, module and entity of the interface the choice is exercised through, if any                                                                                                                          | transaction |
| `descriptor`         | `name`, `publisher`, `version` and `url?` from the bound descriptor's `metadata`, whether or not it has an entry for this node                                                                                  | descriptor  |
| `interpolatedIntent` | the sentence, with values filled in. On `fallback`, `undescribed`, `invalid` and `undescribable` it is the sentence `intent` shows                                                                              | both        |
| `intent`             | the same sentence as parts: `text` from the descriptor, and `value` read from the transaction. A wallet renders the values apart from the wording                                                               | descriptor  |
| `status`             | `described`, `fallback`, `undescribed`, `invalid`, or `undescribable`. `complete` is false when any root is not `described` or any field has an error. `reason` says why a root is `invalid` or `undescribable` | both        |
| `fields`             | one label and formatted value, or an `error`, per field. An optional `None` the record leaves out has `absent: true`. An enum field has `enumKey`, the constructor the table mapped                             | descriptor  |

A wallet shows `kind`, `choiceId` (followed by `via <interface>` when there is one), `template` and its package ID next to the intent, and shows `descriptor` as the descriptor's own claim (`Described by <name> v<version> by <publisher>`). The header is read from the signed transaction, so a descriptor cannot change which action or choice the user is told about. `descriptor` is unauthenticated in v1, because descriptors carry no verified signature yet.

A caller reads `interpolatedIntent`. A wallet renders the `value` parts of `intent` apart from the `text` parts (the approve page uses a monospace, shaded span). Values are untrusted: a text value such as `10 CC. Also send 1000 to Mallory` must not pass as part of the descriptor's sentence. Formatted values also have control, format and line-separator characters escaped.

A template can implement two interfaces with a choice of the same name, such as `TransferFactory_Transfer` and `AllocationFactory_Allocate` in both the V1 and V2 token-standard interfaces, with different arguments. `display.exercises` is an array, so one descriptor holds an entry per interface, named by module and entity; the shipped amulet-rules descriptor does. An entry matches only the interface it names.

The description is only as trustworthy as its binding to what is signed. The wallet binds them in two steps:

1. `clearSign` describes the transaction only when the bytes hash to `expectedHash`, and returns that hash. The approve page passes the hash the gateway reports. A preview has no reported hash, so that page computes the scheme V3 hash of the bytes and passes it. A mismatch throws `HashMismatchError` and approval is disabled.
2. `TransactionService.sign` recomputes the hash from the stored transaction and signs only if it equals both the stored hash and the hash the user approved. It logs the approval (user, party, hash, time) before anything reaches the signing provider. A service account's automated `signAndExecute` has no reviewer; its approval is logged as the service account's.
