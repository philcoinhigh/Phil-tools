# Phil for Visual Studio Code

Language support for [Phil](https://github.com/abiggerhammer/phil), a systems language where architecture is executable and implementation is replaceable.

The syntax checker is written directly from Phil's normative grammar (`grammar/phase1-surface.ebnf`, Grammar v1). It resolves ambiguities the same way the upstream `phase1-surface-determinacy.json` does. **Passing these checks means a file is syntactically valid Grammar v1.** Ownership, typing, authority and proof obligations are decided by the Phil checker, not by this extension.

## Features

- **Syntax highlighting** for all 138 Grammar-v1 reserved words, grouped by role: declarations, control flow, session/protocol operations, contracts, architecture wiring, structural modes, and primitive types such as `U8`, `I64` and `F32`. Also highlights declaration names, match/offer arm labels, escapes (invalid ones are flagged) and primed identifiers like `x'`.
- **Live syntax errors with codes** (`PHIL-L…` lexical, `PHIL-P…` syntax, `PHIL-S…` structure). Messages say what was expected. They catch constructs borrowed from other languages (`unsafe`, `spawn`, `await`, `try`, `while`, assignment…) and explain the Phil way to write them. Recovery is per statement, so one typo doesn't hide everything after it.
- **Quick fixes:**
  - insert a missing `;`
  - "did you mean `component`/`return`?" for misspelled keywords
  - `!` → `not`, `&&` → `and`
  - `0xFF` → `255`
  - `x = 1` → `let x = 1`
  - "Explain PHIL-xxxx" on every diagnostic
- **Hovers:**
  - The meaning of every keyword, taken from Phil's keyword lexicon.
  - Integer width and signedness for `U<n>`/`I<n>`.
  - The declaring line for names.
  - The full explanation of any error under the cursor.
- **Outline and breadcrumbs:** declarations with their fields, variants, operations, laws, roles, architecture instances/processes, parameters and `let` bindings. Declarations that contain errors still appear.
- **Go to Definition, Find References, highlighting of other occurrences, workspace symbol search** (`Ctrl+T`).
- **Completion:** keywords with explanations, plus names declared in the file and the workspace.
- **Snippets** for every declaration form, and for `match`, `decide`, `offer`, `loop`, `borrow`, `send`/`receive`/`select` and more.
- **Smart indentation** while typing, plus **Format Document**. The formatter only rewrites indentation and trailing whitespace, never tokens, and it reproduces the hand-written indentation of nearly every `.phil` file in the Phil repository.
- **Folding** for braces, brackets, parameter lists, comment blocks and `// region` markers.
- **Legacy syntax awareness:** files in the frozen Phase 0 surface syntax (no `;`), which `philc` and the repository's `examples/` still use, are detected automatically. They get only lexical and bracket checks, plus a note pointing to the first Grammar-v1 problem.
- **`Phil: Emit LLVM IR with philc`** runs the compiler on the current file and opens the LLVM IR beside it. Rejections are shown as a `PHIL-C001` diagnostic.

## Error codes

Run **Phil: Show Error Code Reference** or see [ERROR_CODES.md](ERROR_CODES.md).

| Range | Kind |
| --- | --- |
| `PHIL-L001`–`L006` | Lexical: strings, escapes, characters, numbers, stray characters |
| `PHIL-P001`–`P009` | Syntax: expected tokens, delimiters, reserved words, foreign constructs, missing `;`, assignment, end of file |
| `PHIL-S001`–`S002` | Structure: duplicate names, fields, variants, parameters, arms, branches |
| `PHIL-I001` | Information: legacy Phase 0 file |
| `PHIL-C001` | `philc` rejected the file |

These codes belong to this extension; the upstream toolchain doesn't publish diagnostic codes yet.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `phil.syntax` | `auto` | `auto`, `grammar-v1` or `legacy`. `auto` treats files with no `;` that fail Grammar v1 as legacy. |
| `phil.diagnostics.enable` | `true` | Check syntax while typing. |
| `phil.diagnostics.maxErrors` | `10` | Maximum syntax errors per file. |
| `phil.format.enable` | `true` | Enable the indentation formatter. |
| `phil.philc.path` | `philc` | Path to `philc` (build it with `cabal build exe:philc`; `cabal list-bin exe:philc` prints the path). |
| `phil.philc.target` | `x86_64-unknown-linux-gnu` | Target triple for `philc emit-llvm`. |

## Install

Build the package from the repository root, then install the `.vsix` from the Extensions panel (**⋯ → Install from VSIX…**):

```sh
npm install
npm run package:vscode     # writes vscode/phil-language-<version>.vsix
```

## Known limitations

- The checker validates syntax only. Programs that parse can still be rejected by the Phil checker for semantic reasons (linearity, protocol order, evidence, authority…).
- `philc` currently compiles only a tiny legacy-syntax fragment, so **Emit LLVM** will reject most real programs. That is a limit of the compiler today.
- Go to Definition and Find References match names, not resolved bindings, so shadowed names and same-named members can produce extra results.
- It has been tested against VS Code's tokenizer and a stand-in for the extension API, not yet in a published Marketplace build.

## Development

The extension lives in `vscode/` and uses the shared checker in [`core/`](../core). From the repository root:

```sh
npm run build:vscode
npm run test:smoke                  # activates the extension against a VS Code API stub
npm run test:corpus -- ../phil      # checker, highlighting, snippets and formatter vs. the Phil repository
npm run gen                         # regenerate the highlighting grammar and ERROR_CODES.md
```

## Credits and license

Apache-2.0. Keyword descriptions come from Phil's `docs/reference/keywords-phase1.md`; see [NOTICE](../NOTICE). This is an unofficial community extension, not affiliated with the Phil project.
