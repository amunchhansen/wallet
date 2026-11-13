# @canton-network/core-wallet-services

Services needed to implement a wallet. Both wallet gateways use this package: the server-side gateway (`wallet-gateway/remote`) and the browser extension (`wallet-gateway/extension`).

## Clear signing

`@canton-network/core-wallet-services/clear-signing` is the browser-safe entry for the descriptor set the gateways share. It does not load the ledger client or the logger.

- `shippedDescriptors` is the initial set bundled with the gateways: the builtin Canton ping and bong templates, and `Splice.ExternalPartyAmuletRules`.
- `templateKeyOf` reads `context.template` (`packageId`, `moduleName`, `entityName`) so an upload can be stored and can replace another descriptor for that template. It does not validate the rest.
- `mergeDescriptors` lays uploaded descriptors over the shipped set. An upload for the same template replaces the shipped one.

`clearSign` in `@canton-network/core-tx-clear-signing` takes the merged list. It checks the hash, binds each root to the descriptor for its template, ignores the rest, and describes each root.
