# The proof ledger

A daily count of the machine-checked proofs in the [Phil](https://github.com/abiggerhammer/phil) repository. The page is at `/proofs/` on the site.

```
npm run proofs -- ../phil      # a checkout of abiggerhammer/phil with some history
```

It writes `proofs/data.json`, which the page renders.

## What is counted

At the last commit of each day, in every `.v` file under `proof/`:

- **theorems**: lines that open with `Theorem`, `Lemma`, `Corollary`, `Proposition`, `Fact` or `Remark`;
- **unfinished proofs**: lines that open with `Admitted.` or `Abort.`;
- **declared assumptions**: lines that open with `Axiom` or `Conjecture`;
- lines and files.

"Proved since yesterday" is every theorem name present now that was absent at the last commit of the day before.

## What it is not

It is a text search, not a proof check. We do not run Rocq; Phil's own build does, and it is the authority on whether a proof holds. A count says nothing about how much a theorem is worth. `Parameter` and section `Hypothesis` declarations, which Phil's proofs use for abstract interfaces, are not counted as assumptions.

Unofficial, and independent of the Phil project.
