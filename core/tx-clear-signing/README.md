# @canton-network/core-tx-clear-signing

Describes what a Canton prepared transaction does, in words, before it is signed. Each root node of the transaction (a create or an exercise) is described by a _clear-signing descriptor_: a JSON document bound to one exact Daml template (package ID, module and entity), with a stable intent, an interpolated intent and typed fields.

The descriptor format is the v1 _Canton Clear Signing Descriptor_ schema, modelled on ERC-7730. The tests run the schema's own valid and invalid examples (`src/__tests__/schema-examples`, copied unchanged from the schema's repository) through `parseDescriptor`, so the parser and the schema cannot drift apart.

The package depends on the Canton protobuf bindings and on prepared-transaction hash recomputation. It does not depend on the wallet gateway.

## Usage

```typescript
import {
    clearSign,
    parseDescriptor,
    shippedDescriptors,
} from '@canton-network/core-tx-clear-signing'

// preparedTransaction and preparedTransactionHash: base64, as returned by
// /v2/interactive-submission/prepare. Merging descriptor sources (shipped, uploaded, a registry)
// is the caller's job. Two descriptors for one template throw. clearSign binds each one by package
// ID, module and entity, ignores a descriptor the transaction does not use, and checks the hash.
const { complete, hash, operations } = await clearSign(
    preparedTransaction,
    [...shippedDescriptors(), parseDescriptor(descriptorJson)],
    preparedTransactionHash
)
// operations[0].interpolatedIntent is the sentence, with values filled in.
```

`clearSign` is the call. `parseDescriptor` turns descriptor JSON into the values it takes, and `shippedDescriptors` is the set bundled with this build. Three fixed transactions in [examples/](examples) run that call on their own:

```bash
pnpm exec tsx core/tx-clear-signing/examples/ping.ts
pnpm exec tsx core/tx-clear-signing/examples/allocation.ts
pnpm exec tsx core/tx-clear-signing/examples/showcase.ts
```

`ping.ts` describes a create of `Canton.Internal.Ping:Ping`. `allocation.ts` describes an `AllocationFactory_Allocate` exercise through the V2 token-standard interface. `showcase.ts` describes five roots with descriptors this build does not ship: a governance lock, a featured app right and an activity marker exercised on that right, a Splitwell balance update, and a DSO vote. Each prints the wording and exits with an error if that wording changes.

The ping example's preview opens the approve page with the pasted transaction. That page computes the transaction's hash and calls `clearSign`.

The wallet gateway uses one more function. A caller describing a transaction leaves it unused. `selectDescriptors` narrows the approve page's descriptor list to the transaction's root templates. `clearSign` matches those roots itself.

The transaction detail renders the types `clearSign` returns (`TransactionDescription`, `OperationDescription`, `IntentPart`, `DescribedField`, `TemplateRef`). It calls none of these functions. The browser extension's approve page does not use this package.

## Behavior

- `shippedDescriptors` returns the descriptors bundled with this build: the builtin Canton ping and bong templates (`Canton.Internal.Ping:Ping`, `Canton.Internal.Bong:BongProposal`, `Explode`, `Merge`, `Collapse`, `Bong`), and `Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules` in splice-amulet 0.1.22. That descriptor covers the create, and `TransferFactory_Transfer` and `AllocationFactory_Allocate` through the V1 and V2 token-standard interfaces, one exercise entry per interface. A registry or a trust policy plugs in by adding to the list the caller passes. The wallet gateway's approve page passes the shipped set and the descriptors uploaded on its Descriptors page, which are stored in that browser only and replace a shipped descriptor for the same template. The gateway merges those sources itself, then calls `selectDescriptors`.
- `parseDescriptor` validates descriptor JSON against the schema and then checks the rules a JSON Schema cannot express: an operation declares each path once, every placeholder equals the path of a field of the same operation, and enum references exist. It throws `DescriptorError`. `$schema` must be `https://example.org/canton-clear-signing/v1/schema.json`, the schema's `$id`. That URL is a placeholder until a host is chosen.
- `selectDescriptors` takes the transaction as base64 and the caller's candidates. It returns the candidates bound to the templates of the root nodes, one per template, in root order. A root template with no candidate is left out. It does not check the hash: choosing a descriptor decides nothing about trust. Two candidates for one template throw, whether or not the transaction uses that template.
- `clearSign` takes the transaction as base64, so unknown protobuf fields are refused, and the hash the user is asked to approve. It recomputes the hash, trying scheme V3 and then V2, and the given hash only selects the scheme. It describes the transaction only if the bytes hash to that value, and throws `HashMismatchError` otherwise. A transaction that cannot be hashed throws. Passing descriptors that the transaction does not use gives the same description as passing the result of `selectDescriptors`. It returns one `OperationDescription` per root node:
    - `described`: the interpolated intent rendered;
    - `fallback`: a placeholder did not resolve (or was `None`), so `intent` is the descriptor's stable intent;
    - `undescribed`: no descriptor covers the node, so `intent` is generic (`Create Module:Entity`);
    - `undescribable`: the node cannot be read, and `reason` says why: it is not a create or an exercise, or the contract it exercises occurs twice, is not in the transaction, or is of another template.

    `complete` is true only when every root is described and every field rendered. A wallet should warn the user otherwise. `clearSign` throws on a transaction it cannot read at all (no transaction tree, a node without a template ID), on a transaction that cannot be hashed, and on two descriptors for one template. A wallet should show that as an error, not as an incomplete description.

## How it works

`clearSign` in [src/clear-sign.ts](src/clear-sign.ts) checks the hash, then describes each root:

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

| Field                | Value                                                                                                                                                                                   | Source      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `kind`               | `create`, `exercise`, or `other` for a root that is neither                                                                                                                             | transaction |
| `template`           | package ID, module and entity of the created or exercised template, when the node has one                                                                                               | transaction |
| `choiceId`           | the exercised choice's name; with `template`, this selects the descriptor entry (exercise only)                                                                                         | transaction |
| `interface`          | package ID, module and entity of the interface the choice is exercised through, if any                                                                                                  | transaction |
| `descriptor`         | `name`, `publisher`, `version` and `url?` from the bound descriptor's `metadata`, whether or not it has an entry for this node                                                          | descriptor  |
| `interpolatedIntent` | the sentence, with values filled in. On `fallback`, `undescribed` and `undescribable` it is the sentence `intent` shows                                                                 | both        |
| `intent`             | the same sentence as parts: `text` from the descriptor, and `value` read from the transaction. A wallet renders the values apart from the wording                                       | descriptor  |
| `status`             | `described`, `fallback`, `undescribed`, or `undescribable`. `complete` is false when any root is not `described` or any field has an error. `reason` says why a root is `undescribable` | both        |
| `fields`             | one label and formatted value, or an `error`, per field. An optional `None` the record leaves out has `absent: true`. An enum field has `enumKey`, the constructor the table mapped     | descriptor  |

A wallet shows `kind`, `choiceId` (followed by `via <interface>` when there is one), `template` and its package ID next to the intent, and shows `descriptor` as the descriptor's own claim (`Described by <name> v<version> by <publisher>`). The header is read from the signed transaction, so a descriptor cannot change which action or choice the user is told about. `descriptor` is unauthenticated in v1, because descriptors carry no verified signature yet.

A caller reads `interpolatedIntent`. A wallet renders the `value` parts of `intent` apart from the `text` parts (the approve page uses a monospace, shaded span). Values are untrusted: a text value such as `10 CC. Also send 1000 to Mallory` must not pass as part of the descriptor's sentence. Formatted values also have control, format and line-separator characters escaped.

A template can implement two interfaces with a choice of the same name, such as `TransferFactory_Transfer` and `AllocationFactory_Allocate` in both the V1 and V2 token-standard interfaces, with different arguments. `display.exercises` is an array, so one descriptor holds an entry per interface, named by module and entity; the shipped amulet-rules descriptor does. An entry matches only the interface it names.

The description is only as trustworthy as its binding to what is signed. The wallet binds them in two steps:

1. `clearSign` describes the transaction only when the bytes hash to `expectedHash`, and returns that hash. The approve page passes the hash the gateway reports. A preview has no reported hash, so that page computes the scheme V3 hash of the bytes and passes it. A mismatch throws `HashMismatchError` and approval is disabled.
2. `TransactionService.sign` recomputes the hash from the stored transaction and signs only if it equals both the stored hash and the hash the user approved. It logs the approval (user, party, hash, time) before anything reaches the signing provider. A service account's automated `signAndExecute` has no reviewer; its approval is logged as the service account's.
