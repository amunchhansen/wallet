# Preview transactions

Paste one of these files into the ping example's "Prepare response JSON or base64 preparedTransaction" box and choose "preview on approve page". Each file is a prepare response with only `preparedTransaction` set, so the page describes it and does not check a hash.

The approve page describes a node only when a descriptor for its package ID is loaded. The wallet ships the ping descriptor and [external-party-amulet-rules.json](../external-party-amulet-rules.json). The other descriptors have to be uploaded on the wallet's Descriptors page first.

| File | Upload first | What it shows |
|---|---|---|
| [ping-create-then-respond.json](ping-create-then-respond.json) | nothing | Two roots. The first creates a ping. The second responds to that same contract, so the sentence reads the ping id and the initiator from the create through `@.contract`. |
| [shipped-amulet-two-roots.json](shipped-amulet-two-roots.json) | nothing | Two exercises of one `ExternalPartyAmuletRules` contract, through different interfaces. A V1 transfer whose metadata carries a CIP-127 memo, and a V2 allocation of two legs whose settlement deadline is a `Some` shown as a `dateTime` and whose commitment comes from the enum table. |
| [splice-showcase.json](splice-showcase.json) | [governance-lock.json](../splice/governance-lock.json), [featured-app-right.json](../splice/featured-app-right.json), [splitwell-balance-update.json](../splice/splitwell-balance-update.json), [dso-rules.json](../splice/dso-rules.json) | Five roots. A vesting governance lock (the lock type shown whole with `raw`, and an optional contract id left out, shown as `None`). A featured app right whose kind is an optional enum and whose weight and operational parties are optional. An activity marker exercised on that same right, reading the provider from the create and showing a V2 weight. A Splitwell netting, shown whole with `raw`. A DSO vote on a configuration change: a three-day voting period, an effective time the record leaves out, and the action shown whole with `raw`. |
