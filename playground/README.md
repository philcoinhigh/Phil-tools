# Phil Playground

A single-page web app for writing, running and exploring [Phil](https://github.com/abiggerhammer/phil) programs in the browser. Nothing to install, no server: everything runs on the page.

> **Unofficial.** Phil's own compiler does not run general programs yet, so **Run** uses the experimental simulator in [`core/`](../core). It is an interpretation of Phil's published design, not an official semantics.

## What it does

- **Editor** with highlighting, live Grammar-v1 syntax errors, one-tap fixes, auto-closing brackets, comment toggle and Format.
- **Run** executes the program and reports ownership errors, protocol violations, broken contracts, arithmetic traps and deadlocks, pointing at the line.
- **Sequence diagram and replay:** step through the messages between processes; the source line behind each step is highlighted. Under the diagram, each role's protocol script shows where that side currently stands, so both sides can be watched advancing through their session types in step. A Play button animates the whole run at slow, normal or fast speed.
- **Ownership view:** which process holds each linear or affine value at every step.
- **Structure:** draws the architecture (which program talks to which, over which protocol) and prints each protocol as two side-by-side scripts, with a check that the two roles match. A mismatch is reported before the program runs.
- **Programs from the Phil repository:** two of Phil's own Ping stages are included unmodified and run as written.
- **Share:** copies a link that carries the code in the editor.
- **Phil's compiler:** runs `philc`, the real compiler from the Phil repository, compiled to WebAssembly, on the program in the editor and shows the LLVM IR it emits or its refusal. See [philc/](../philc). It accepts only a small part of the language today.
- **Hunt:** tries boundary inputs, several schedules and peer choices, and lists each distinct way the program can fail, with a Replay button. A bounded search, not a proof.
- **Design:** list the messages between two roles and get a complete program whose two sides match by construction.
- **Examples and puzzles:** 15 examples and 7 "fix it" puzzles. A puzzle is solved when it runs and a hunt finds nothing.
- **Docs:** searchable reference for every keyword, error code and host operation.
- **Phone layout:** Code/Results switch, a Run bar and a row of symbol keys.

Edits are kept in the browser's local storage per example. **Open file** loads a `.phil` file into the scratch pad.

## Run it

From the repository root:

```sh
npm install
npm run build:playground    # writes docs/playground/index.html
```

Open `docs/playground/index.html` in a browser. The file is self-contained (it loads only web fonts).

To publish it with GitHub Pages: repository **Settings → Pages → Deploy from a branch → `main` / `docs`**.

## Layout

| Path | Contents |
| --- | --- |
| `src/main.ts` | UI logic |
| `src/template.html` | Markup and styles |
| `src/dogmark.svg` | Logo (original artwork for this project) |
| `build.js` | Bundles everything into `docs/playground/index.html` |
| [`../core/src/sim/examples.ts`](../core/src/sim/examples.ts) | Examples; each declares the outcome it must produce |

## Add an example or puzzle

Add an entry to `core/src/sim/examples.ts` with its `expect` outcome (`ok`, `linearity`, `contract`, `protocol`, `arithmetic` or `deadlock`). `npm run test:sim` checks every example produces what it declares. Examples in the "Caught by Phil" group become puzzles when given a goal in `GOALS` in `src/main.ts`.

## Test

```sh
npm run test:playground     # drives the built page like a user (jsdom)
```

## Simulator choices that are not Phil

- Host operations `lt`, `le`, `gt`, `ge`, `eq`, `ne` and `console_write`, because ordinary Phil expressions have no comparison operators.
- Inside an `offer` arm, the offered endpoint's name refers to its next state.
- Roles marked `external` are played by an automatic peer.
- Effects, authority, providers, generics and byte-level operations are parsed but not executed.

## Credits

Built by the Philcoin community. Not affiliated with the Phil project. Apache-2.0.
