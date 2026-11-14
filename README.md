<p align="center"><img src="assets/banner.png" alt="Phil Tools: community tools for the Phil language" width="820"></p>

# Phil Tools

Open-source community tools for [Phil](https://github.com/abiggerhammer/phil), a systems language where architecture is executable and implementation is replaceable.

> **Unofficial.** This project is not part of, or endorsed by, the Phil project or its authors. Phil's own checker and documents are the authority on the language. Where these tools disagree with Phil, Phil is right and the disagreement is a bug here (please [open an issue](https://github.com/philcoinhigh/Phil-tools/issues)).

## Projects

| Project | What it is | Folder |
| --- | --- | --- |
| **Phil for VS Code** | Editor extension: highlighting, live syntax errors with codes and quick fixes, hovers, outline, snippets, formatting | [`vscode/`](vscode) |
| **Phil Playground** | Web app to write, run, replay and bug-hunt Phil programs, with examples and puzzles. Also runs Phil's own `philc` compiler, built to WebAssembly ([`philc/`](philc)) | [`playground/`](playground) |
| **Learn Phil** | A course of fifteen short lessons with code you run and fix in the page | [`site/`](site) |
| **Phil OTC desk** | An escrow desk and a two-listing order book, written in Phil. Simulation only: no real tokens move | [`otc/`](otc) |
| **Hacks Phil would have stopped** | Four well-known losses, each reduced to the shape of the mistake and refused in the page, with sources | [`core/src/sim/hacks.ts`](core/src/sim/hacks.ts) |
| **The tour, runnable** | Follows Phil's official Phase 1 tour section by section, with a complete program to run and change for each | [`site/src/tour-data.ts`](site/src/tour-data.ts) |
| **Phil at both ends** | Phil's emitted client (WebAssembly, in the browser) completes Phil's upload protocol with Phil's emitted server (on Solana devnet) | [`site/src/phil-client.ts`](site/src/phil-client.ts), [`giveaway/`](giveaway) |
| **Mutation analysis** | Hundreds of deliberately broken copies of Phil's emitted upload code, run against Phil's own test and ours | [`mutation/`](mutation) |
| **Phil on Solana** | A Phil program compiled by Phil's own compiler, deployed on Solana devnet and called. Real, and tiny | [`onchain/`](onchain) |
| **Giveaways** | Provably fair draws on Solana devnet. The entry list is locked through the upload server Phil's backend emits; a future block picks the winner; anyone can check without a wallet | [`giveaway/`](giveaway) |
| **Burn vault** | Point any coin's fees at a vault on Solana devnet; whoever burns a set amount of the coin takes them. No withdraw, no owner; every step gated by the upload server Phil's backend emits | [`burn/`](burn) |
| **Token utilities** | A token locker (cliff, streaming, cancel), transfer hooks, launchpad hooks modelled on higher.fun's published rules, a hook that pays holders in tokenized stock, vesting, a 2-of-3 treasury, an auction and a bonding-curve launch. Written in Phil and meant to be forked. Simulation only | [`contracts/`](contracts) |
| **What changed in Phil** | A day-by-day record of what landed in the Phil repository, counted from its git history and refreshed daily | [`changelog/`](changelog) |
| **Compiler fuzzer** | Generates programs and runs Phil's own compiler on them daily, looking for crashes, hangs and wrong answers | [`fuzz/`](fuzz) |
| **Conformance report** | Every test program in the Phil repository, run through these tools once a day | [`conformance/`](conformance) |
| **Phil core** | The shared checker and experimental simulator, plus the command-line checker and the MCP server for AI assistants | [`core/`](core) |

Each folder has its own README. The site at <https://philcoinhigh.github.io/Phil-tools/> has a home page that links to all of them.

Three jobs run by themselves every day: one rebuilds Phil's compiler for the browser, and one refreshes the conformance report and the changelog and runs the fuzzer for two minutes.

They live in one repository because they all use the same lexer and parser, written from Phil's normative grammar `grammar/phase1-surface.ebnf`; a grammar fix lands in every tool at once.

## Quick start

Requires Node.js 18 or newer.

```sh
npm install
npm run build          # extension, CLI, MCP server, playground and site
npm test               # typecheck, then every suite: checker, simulator, lessons, utilities, pages, compiler runner
```

### Check a file

```sh
node out/cli.js path/to/file.phil          # file:line:col: error PHIL-P007: ...
node out/cli.js --json path/to/file.phil   # machine-readable, includes quick-fix edits
node out/cli.js --format path/to/file.phil # print the re-indented file
```

Exit status is 0 with no errors, 1 with syntax errors, 2 on usage errors.

### The site

`npm run build` writes the site to `docs/`, one self-contained page per folder:

| Page | Folder in `docs/` |
| --- | --- |
| Home | `index.html` |
| Playground | `playground/` (with `philc.wasm`, Phil's compiler) |
| Learn Phil | `learn/` |
| Hacks Phil would have stopped | `hacks/` |
| OTC desk | `otc/` |
| Token utilities | `library/` |
| Phil on Solana | `onchain/` |
| Giveaways | `giveaway/` |
| Burn vault | `burn/` |
| What changed in Phil | `changelog/` |
| Compiler fuzzer | `fuzz/` |
| Conformance report | `conformance/` |

Open a page in a browser, or serve the `docs/` folder with GitHub Pages (repository **Settings → Pages → Deploy from a branch → `main` / `docs`**). The "Phil's compiler" tab needs the page to be served over HTTP, not opened as a file. See [playground/README.md](playground/README.md) and [site/README.md](site/README.md).

### VS Code extension

```sh
npm run package:vscode   # writes vscode/phil-language-<version>.vsix
```

Install it from the Extensions panel: **⋯ → Install from VSIX…**. See [vscode/README.md](vscode/README.md); error codes are in [vscode/ERROR_CODES.md](vscode/ERROR_CODES.md).

### MCP server for AI assistants

Register the command `node /absolute/path/to/out/mcp.js` in an MCP client. See [core/README.md](core/README.md). Tools: `phil_check`, `phil_format`, `phil_run`, `phil_hunt`, `phil_keyword`, `phil_generate_protocol`.

## How it is tested

`npm test` runs everything that needs no outside files. Against a checkout of Phil:

```sh
git clone --shallow-since="45 days ago" https://github.com/abiggerhammer/phil ../phil
npm run test:corpus -- ../phil        # checker vs. every .phil file in the Phil repository
npm run conformance -- ../phil        # the daily report: our tools vs. the verdict Phil's tests expect
npm run changelog -- ../phil          # what landed in Phil, day by day
npm run fuzz -- --seconds 120 --seed 1   # run Phil's own compiler on generated programs
```

- **Checker:** agrees with all 64 of Phil's grammar fixtures (28 that must parse, 36 that must not). The suite also runs the highlighting grammar through VS Code's tokenizer, expands every snippet, checks the formatter never changes a token, and feeds 3,000 mutated files to the parser.
- **Simulator:** much weaker than Phil's checker, and the [conformance report](https://philcoinhigh.github.io/Phil-tools/conformance/) says where. The current figures are on that page and in `conformance/data.json`, refreshed daily, rather than copied here to go stale.
- **Everything written in Phil here** (lessons, the OTC desk, the utilities, the hacks exhibits) is a test: each declares what it must do when run, and the utilities also get a bounded bug hunt.
- **Phil's compiler in the browser** must give byte-identical output to a native run on Phil's own sample files.

## Limits you should know

- The checker validates **syntax only**. A program that parses can still be rejected by Phil for ownership, protocol, authority or proof reasons.
- The simulator is **an interpretation of Phil's published design**, not an official semantics. It checks at run time what Phil establishes statically. A program that runs here can still be rejected by Phil, and the other way round.
- The bug hunter is a **bounded search, not a proof**.
- Programs written against these tools are models. Phil's own compiler does not yet build general programs. Three things here are on Solana devnet: one small program compiled by that compiler ([`onchain/`](onchain)), and the giveaway and burn vault programs, which run the upload server emitted by Phil's LLVM backend ([`giveaway/`](giveaway), [`burn/`](burn)). Everything else is a simulation.
- The OTC desk, the utilities and the hacks exhibits are **simulations**. No real tokens move, and several are simplified models of something larger; each page says how.
- Simulator choices that are not Phil: host operations `lt`, `le`, `gt`, `ge`, `eq`, `ne` and `console_write` (ordinary Phil expressions have no comparison operators); inside an `offer` arm the endpoint's name refers to its next state; roles marked `external` are played by an automatic peer; simple programs in Phil's earlier syntax (no semicolons) are read by treating each line as a statement.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Good first contributions: a lesson, a utility written in Phil, a hacks exhibit with sources, example programs and puzzles, and paired passing/failing programs for the ownership gaps Phil lists in its `fsem01-coverage1-register.json`.

If you find a program that **Phil itself** wrongly accepts, do not post it here: follow the private reporting process in Phil's `SECURITY.md`. The fuzzer and the conformance report publish counts only for the same reason.

## Credits and license

Apache-2.0, the same license as Phil. See [NOTICE](NOTICE) for attribution of material derived from the Phil repository.

Built by the Philcoin community. Contract address: `Ea5dBrJZN58yV1nm1Q4DybJNYKeTvwpb2GEkXyW64bUH`. The tools are free to use and are not gated by any token. The Phil project and its authors have no affiliation with Philcoin.
