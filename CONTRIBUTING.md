# Contributing

Thanks for helping. This is an unofficial community project; Phil's own repository is the authority on the language.

## Setup

```sh
npm install
npm test
```

Some commands need a checkout of Phil next to this repository:

```sh
git clone --shallow-since="45 days ago" https://github.com/abiggerhammer/phil ../phil
npm run test:corpus -- ../phil     # checker vs. every .phil file in Phil
npm run conformance -- ../phil     # regenerates conformance/data.json
npm run changelog -- ../phil       # regenerates changelog/data.json
```

The fuzzer needs only the compiler build that is already in the repository: `npm run fuzz -- --seconds 60 --seed 1`.

## Where things live

- `core/`: lexer, parser, formatter, simulator, bug hunter, CLI and MCP server. Also the lists that drive the pages: examples, utilities (`sim/contracts.ts`) and hacks exhibits (`sim/hacks.ts`).
- `vscode/`: the editor extension.
- `playground/`: the playground web app, including the runner for Phil's compiler.
- `site/`: every other page (home, Learn, hacks, OTC, utilities, changelog, fuzzer, conformance) and the lessons.
- `otc/`, `contracts/`: programs written in Phil.
- `conformance/`, `changelog/`, `fuzz/`: the tools behind the three daily pages.
- `philc/`: the record of the last build of Phil's compiler for the browser.
- `docs/`: the built site, committed so GitHub Pages can serve it.
- `test/`: suites for all of it.

## Ground rules

- **Follow the grammar.** Parser changes must trace to `grammar/phase1-surface.ebnf` in the Phil repository. Do not accept syntax Phil does not define.
- **Label interpretation.** Anything in the simulator that is not stated in Phil's documents belongs in the README's list of simulator choices.
- **Tests with every change.** Anything written in Phil doubles as a test and declares what it must do: examples (`expect`), lessons (`starts`, plus a `solution` that must pass), utilities (scenarios with the lines they must print, and a bug hunt that must find nothing) and hacks exhibits (the mistake must be refused for the stated reason and the fix must run).
- **Say what is modelled and what is not.** A utility that simplifies something real lists the gaps in its `port` notes. One modelled on someone else's published rules names the source in `basis` and says it is not their code.
- **Sources for claims about real events.** A hacks exhibit needs at least two linked sources, and its text must be in our own words.
- **Regenerate, do not hand-edit:** `vscode/syntaxes/phil.tmLanguage.json` and `vscode/ERROR_CODES.md` come from `npm run gen`; `core/src/sim/otc-source.ts` and `contracts-source.ts` come from `npm run gen:otc`; everything under `docs/` comes from `npm run build`. CI fails if `docs/` does not match a fresh build.
- **Leave the daily files to the daily jobs:** `conformance/data.json`, `changelog/*.json`, `fuzz/*.json`, `philc/` and `docs/playground/philc.wasm` are written by the scheduled workflows.
- **Never commit fuzz findings or the conformance review file.** `fuzz/findings/` and `conformance/private-review.md` are ignored by git on purpose.
- **No token gating.** Tools stay free to use. Do not add wallet checks, paywalls or promotional content.
- **Do not use Phil's mascot artwork.** It is not covered by Phil's open-source license.

## Reporting problems

- A bug in these tools: open an issue with the Phil source that triggers it.
- A disagreement with Phil's real checker: open an issue here with both results.
- A program Phil itself wrongly accepts: report it privately through the process in Phil's `SECURITY.md`, not here.
- A crash or slowdown in Phil's compiler found by the fuzzer: Phil's policy treats ordinary bugs as public issues on the Phil repository, not this one.
