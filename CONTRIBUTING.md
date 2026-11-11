# Contributing

Thanks for helping. This is an unofficial community project; Phil's own repository is the authority on the language.

## Setup

```sh
npm install
npm test
```

For the corpus and conformance suites, clone Phil next to this repository and pass its path:

```sh
git clone https://github.com/abiggerhammer/phil ../phil
npm run test:corpus -- ../phil
npm run test:conformance -- ../phil
```

## Ground rules

- **Follow the grammar.** Parser changes must trace to `grammar/phase1-surface.ebnf` in the Phil repository. Do not accept syntax Phil does not define.
- **Label interpretation.** Anything in the simulator that is not stated in Phil's documents belongs in the README's list of simulator choices.
- **Tests with every change.** Examples in `src/sim/examples.ts` double as tests: each declares the outcome it must produce.
- **Regenerate, do not hand-edit:** `syntaxes/phil.tmLanguage.json` and `ERROR_CODES.md` come from `npm run gen`; `docs/index.html` comes from `npm run build`.
- **No token gating.** Tools stay free to use. Do not add wallet checks, paywalls or promotional content.
- **Do not use Phil's mascot artwork.** It is not covered by Phil's open-source license.

## Reporting problems

- A bug in these tools: open an issue with the Phil source that triggers it.
- A disagreement with Phil's real checker: open an issue here with both results.
- A program Phil itself wrongly accepts: report it privately through the process in Phil's `SECURITY.md`, not here.
