# Phil's own compiler, in the browser

`docs/playground/philc.wasm` is the `philc` executable from [abiggerhammer/phil](https://github.com/abiggerhammer/phil), compiled to WebAssembly so the playground can run it. The source is not modified: `.github/workflows/philc-wasm.yml` checks out Phil, builds `exe:philc` with the GHC WebAssembly backend, shrinks the result with `wasm-opt`, and commits it. `build.json` records the Phil commit, the GHC version and the size.

The playground's "Phil's compiler" tab gives the program a one-file in-memory file system holding the editor's text, runs `philc emit-llvm --target <target> /main.phil`, and shows what it prints. Nothing is sent anywhere.

## What philc accepts today

A small part of the language: a component called `main` that provides `Unit` or a `U32`, built from integer literals and names, in Phil's earlier syntax without semicolons. Everything else is refused, usually with a message that says so. This is a statement about the Phil commit in `build.json`, found by running the binary; it will change as Phil does.

## How we know the browser build behaves like the real one

The workflow runs the WebAssembly binary under `wasmtime` on a set of Phil's own files and commits the output to `expected/`. `npm run test:philc` runs the same files through the browser runner (`playground/src/philc.ts`) and requires identical output and exit status. It also tests the runner against a stand-in program with the same command line (`test/standin/main.go`), so the runner is tested even without a build.

## Licence

Phil is Apache-2.0. See the repository `NOTICE` for what the binary contains.
