# Phil tools site

Every page of the site except the playground, which has its own folder: home, Learn Phil, Hacks Phil would have stopped, the OTC desk, token utilities, What changed in Phil, the compiler fuzzer and the conformance report.

```sh
npm run build:site     # writes docs/index.html and one folder per page
npm run test:learn     # every lesson: starter behaves as described, solution passes its check
npm run test:site      # drives every page in jsdom
```

| File | What it is |
| --- | --- |
| `src/lessons.ts` | The fifteen lessons: text, starter code, task, answer and how the task is checked |
| `src/check.ts` | Decides whether a task is done |
| `src/shared.ts` | Highlighting, the small editor, running a program in the simulator |
| `src/home.*`, `src/learn.*`, `src/hacks.*`, `src/otc.*`, `src/library.*` | One page each. `library` is the token utilities page |
| `src/changelog.*`, `src/fuzz.*`, `src/conformance.*` | The three pages built from data the daily jobs write (`changelog/`, `fuzz/`, `conformance/`) |
| `src/foot.ts` | The shared footer |

The header and its list of pages (`PAGES`) are in `build.js`. On screens narrower than 980px the links fold into a Menu. The home page builds its "Built in Phil" list from `CONTRACTS` and its daily figures from the data files, so a new utility or a new day's numbers appear without editing the page.
| `src/base.css` | Colours, header, buttons and code styling shared by the pages |
| `build.js` | Bundles each page into one self-contained HTML file |

## Adding a lesson

Add an entry to `LESSONS` in `src/lessons.ts`. `starts` is what the starter code does when run (`ok`, `linearity`, `contract`, `protocol`, `arithmetic` or `deadlock`). A lesson with a `task` needs a `solution` and a `check`. `npm run test:learn` fails if the starter does not behave as stated, if the starter already passes, or if the solution does not pass.

## Adding a utility or a hacks exhibit

Both are lists in `core/`, and the pages render whatever is in them.

- **Utility:** write the program in `contracts/`, add its name to `scripts/gen-otc.js`, and add an entry to `CONTRACTS` in `core/src/sim/contracts.ts` with its guarantees, input fields and scenarios. Each scenario names lines the run must print. See [`contracts/README.md`](../contracts/README.md).
- **Hacks exhibit:** add an entry to `HACKS` in `core/src/sim/hacks.ts` with the mistake, the working version, the error kind the mistake must produce, and at least two sources.

`npm run test:learn` checks both.
