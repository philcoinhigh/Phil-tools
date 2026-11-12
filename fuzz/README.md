# A fuzzer for Phil's compiler

Generates programs and runs `philc`, Phil's own compiler, on each one. The compiler is the unmodified program from [abiggerhammer/phil](https://github.com/abiggerhammer/phil), built to WebAssembly by `.github/workflows/philc-wasm.yml`, so a run takes a few milliseconds and is sandboxed.

```sh
npm run fuzz -- --seconds 120 --seed 1          # search
npm run fuzz -- --seconds 120 --seed 1 --record # also append the run to fuzz/history.json
```

Options: `--seconds`, `--seed`, `--wasm <path>`, `--limit-ms <per-input time limit, default 10000>`. A run is reproducible from its seed and the Phil commit.

## What it looks for

| Kind | Meaning |
| --- | --- |
| crash | the compiler stops with an internal error instead of a diagnostic |
| hang | no answer within the time limit |
| disagreement | a program whose answer we can work out, where the compiler accepts or refuses differently or compiles it to a different value |
| inconsistent | different answers for two targets, or on a second run of the same input |
| slow | doubling the input multiplies the time by about three or more |

## The three generators

- **scalar:** small programs inside the part of Phil the compiler handles today (a `main` that provides `Unit` or a `U32`, built from literals and names). The generator works out the expected result as it builds each program, including the ones it makes wrong on purpose. Accepted programs are also run in this project's simulator as a third opinion.
- **mutated:** real programs with tokens or bytes deleted, duplicated, swapped or replaced, including invalid UTF-8. There is no right answer to compare; the only rule is that the compiler must not crash or hang.
- **stress:** a fixed set of shapes (nested parentheses, long chains of bindings, long names and so on) at doubling sizes, to see how time grows.

Each finding is shrunk by removing ever smaller chunks while the same problem remains.

## Where findings go

`fuzz/findings/` holds the shrunk input for each finding and `REPORT.md`, a write-up ready to send. **That folder is not committed.** Phil's `SECURITY.md` asks for possible acceptance problems to be reported privately, so only counts are published (`fuzz/data.json`, and the page built from it). Anyone can reproduce a run from its seed; the point is not to publish the inputs before Phil's author has seen them.

A disagreement can be this tool's mistake as easily as the compiler's. The generator's idea of "the right answer" was written by reading how the compiler behaves on simple cases, and the first disagreement the fuzzer ever reported was a bug in the generator.

Observations come from the WebAssembly build. Timings are slower than native, and platform-dependent behaviour should be confirmed natively before it is called a bug.
