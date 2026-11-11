# Phil core

The shared engine behind the [VS Code extension](../vscode) and the [playground](../playground), plus two command-line tools. Plain TypeScript with no editor or browser dependencies.

| File | What it is |
| --- | --- |
| `src/lexer.ts` | Grammar-v1 lexer, mirroring Phil's own token rules, with error recovery |
| `src/parser.ts` | Syntax checker written from `grammar/phase1-surface.ebnf`: diagnostics with codes, quick fixes, outline symbols |
| `src/format.ts` | Indentation formatter; never changes a token |
| `src/codes.ts` | Error-code catalog |
| `src/sim/ast.ts` | Syntax tree for the executable part of the language |
| `src/sim/interp.ts` | Experimental simulator: ownership, protocols, contracts, non-wrapping arithmetic, process scheduling, deadlock detection |
| `src/sim/explore.ts` | Bounded bug hunter |
| `src/sim/designer.ts` | Protocol program generator |
| `src/sim/inspect.ts` | Static views: protocol scripts, role duality check, architecture wiring |
| `src/sim/examples.ts` | Example programs that double as tests |
| `src/cli.ts` | `phil-check` command-line checker |
| `src/mcp.ts` | `phil-mcp` server for AI assistants |

## Command-line checker

```sh
npm run build:core
node out/cli.js file.phil            # file:line:col: error PHIL-P007: ...
node out/cli.js --json file.phil     # machine-readable, includes quick-fix edits
node out/cli.js --format file.phil   # print the re-indented file
```

Exit status: 0 no errors, 1 syntax errors, 2 usage error.

## MCP server

Register `node /absolute/path/to/out/mcp.js` as a stdio server in an MCP client.

| Tool | Purpose |
| --- | --- |
| `phil_check` | Syntax diagnostics with codes, explanations and fixes |
| `phil_format` | Re-indent source |
| `phil_run` | Run a program in the simulator with entry inputs |
| `phil_hunt` | Bounded bug hunt over inputs, schedules and peer choices |
| `phil_keyword` | Explain a keyword or list them all |
| `phil_generate_protocol` | Generate a full program from message steps |

## What the simulator checks

Phil establishes these statically; the simulator checks them while a program runs.

- **Ownership:** `linear` values are used exactly once, `affine` at most once. `Bytes` and protocol endpoints are linear. Borrowed views cannot escape or move their owner.
- **Protocols:** every `send`, `receive`, `select`, `offer` and `close` must match the role's next step; an `offer` must cover every branch. As in Phil's own Ping stages, a process may perform a branch's first action directly on an endpoint that is waiting at an `offer`.
- **Contracts:** `requires`, `ensures`, refinement types, loop and join invariants, `prove(...)`.
- **Arithmetic:** fixed-width integers never wrap; no implicit width conversion.
- **Processes:** synchronous rendezvous under a deterministic scheduler, with deadlock detection.

It is an interpretation of Phil's published design, not an official semantics. See the root [README](../README.md#limits-you-should-know).

## Tests

```sh
npm run test:sim
npm run test:designer
npm run test:corpus -- ../phil
npm run test:conformance -- ../phil
```
