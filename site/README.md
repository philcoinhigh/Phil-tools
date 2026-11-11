# Phil tools site

The home page, the Learn Phil course and the OTC desk page. The playground has its own folder.

```sh
npm run build:site     # writes docs/index.html, docs/learn/index.html, docs/otc/index.html
npm run test:learn     # every lesson: starter behaves as described, solution passes its check
npm run test:site      # drives the three pages in jsdom
```

| File | What it is |
| --- | --- |
| `src/lessons.ts` | The fifteen lessons: text, starter code, task, answer and how the task is checked |
| `src/check.ts` | Decides whether a task is done |
| `src/shared.ts` | Highlighting, the small editor, running a program in the simulator |
| `src/home.*`, `src/learn.*`, `src/otc.*` | One page each |
| `src/base.css` | Colours, header, buttons and code styling shared by the pages |
| `build.js` | Bundles each page into one self-contained HTML file |

## Adding a lesson

Add an entry to `LESSONS` in `src/lessons.ts`. `starts` is what the starter code does when run (`ok`, `linearity`, `contract`, `protocol`, `arithmetic` or `deadlock`). A lesson with a `task` needs a `solution` and a `check`. `npm run test:learn` fails if the starter does not behave as stated, if the starter already passes, or if the solution does not pass.
