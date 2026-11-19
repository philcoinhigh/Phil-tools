# Every bit

One honest upload to the Phil program from [Same Phil, every chain](../chains), then every version of it damaged in the plainest way: one bit flipped, for each of its 888 bits, and cut short, at each of its 111 lengths. 999 attacks and the honest one.

```
giveaway/native/build.sh out/phil-chains-native chains/runtime.c
npm run everybit -- local chains/phil_chains.bin out/everybit-expected.json
npm run everybit -- solana <rpc> <program id> <payer.json> out/everybit-expected.json everybit/data.json
```

- `local` runs all 1,000 through the native build and the RISC-V image. They must agree on every one, the honest upload must be accepted, and no attack may be.
- `solana` sends each as its own transaction, without preflight so that a refusal lands on the chain as a failed transaction, and records the signature and the answer. `.github/workflows/everybit.yml` does this on devnet from the `onchain` branch, where the devnet wallet is.
- `site/src/everybit-core.ts` builds the uploads and names each byte's field. The page uses the same file, so what it shows is what was run.

`data.json` says where its answers came from: `"cluster": "devnet"` with a transaction for each, or `"cluster": "local"` when they are from the off-chain run.

## What it is not

It is complete for one-bit changes and shortenings of one upload. It is not every possible attack. What runs is Phil's compiled upload server, unchanged, on a runtime of ours that has not been audited. Devnet only. Unofficial, and independent of the Phil project.
