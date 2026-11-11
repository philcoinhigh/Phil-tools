# Conformance report

Runs every `.phil` file in a checkout of [abiggerhammer/phil](https://github.com/abiggerhammer/phil) through this project's parser and simulator, and compares the result with the verdict Phil's own tests expect.

```sh
git clone --depth 1 https://github.com/abiggerhammer/phil ../phil
npm run conformance -- ../phil    # writes conformance/data.json
npm run build                     # rebuilds docs/conformance/ from it
```

A scheduled workflow does this daily and commits the result when it changes.

## How a file's expected verdict is decided

| Where the file is | Phil says |
| --- | --- |
| `test/fixtures/phase1-surface/accepted/` | must parse (syntax only) |
| `test/fixtures/phase1-surface/rejected/` | must not parse |
| `test/fixtures/<suite>/accepted*.phil` or `positive*.phil` | accepted |
| any other file in `test/fixtures/<suite>/` | rejected |
| `examples/rejected/` | rejected |
| other files under `examples/` and `handoff/` | accepted |

## What our tools report

- **Agree:** for an accepted program, it parses and a bounded search in the simulator finds no failure. For a rejected one, the parser or the simulator reports an error.
- **Parsed only:** the program parses, but there is nothing in it the simulator can run.
- **Not caught:** Phil rejects it and our tools do not. Expected for anything that needs Phil's static checker. The file names are published so the gaps are visible.
- **Under review:** Phil accepts it and our tools reject it.

## Why "under review" files are not named in public

A program Phil accepts and we reject is most likely a bug here. It could also mean Phil accepted something it should not have, and Phil's `SECURITY.md` asks for that kind of report to be made privately. So `data.json` and the page carry only the count. The details are written to `conformance/private-review.md`, which is ignored by git.
