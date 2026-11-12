# What changed in Phil

A day-by-day record of what landed in [abiggerhammer/phil](https://github.com/abiggerhammer/phil), counted from its git history.

```sh
git clone --shallow-since="45 days ago" https://github.com/abiggerhammer/phil ../phil
npm run conformance -- ../phil   # the changelog records these figures too
npm run changelog -- ../phil     # writes changelog/data.json, appends to changelog/history.json
npm run build                    # rebuilds docs/changelog/
```

The daily workflow does this and commits the result when it changes.

## What is counted, per day

Only the main line of history (`--first-parent`), so a merged pull request counts once, with its file changes.

| Fact | How it is found |
| --- | --- |
| Changes landed | commits on the main line; merges of pull requests are counted separately |
| Work areas | the prefix of the commit subject, for the prefixes listed in `STREAMS` |
| New test programs | `.phil` files added under `test/fixtures/`, split into accepted and rejected by the same naming rule as the conformance report |
| New design notes | `.md` files added under `docs/`, with their first heading as the title |
| Proofs | `.v` files added or modified under `proof/` |
| New compiler modules | `.hs` files added under `src/Phil/` |
| Grammar | any change under `grammar/` |

Nothing is summarised by hand or by a model. The page also shows a few commit subjects per day, verbatim and linked, so readers can see the repository's own description.

`history.json` keeps one row per Phil commit the job ran against, with our conformance figures and how many sample programs Phil's compiler accepted, so a drop is visible.
