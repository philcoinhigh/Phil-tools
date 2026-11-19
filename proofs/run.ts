// Counts Phil's machine-checked proofs, day by day, from its repository.
//
//   npm run proofs -- ../phil        (needs history: clone with --shallow-since or in full)
//
// Writes proofs/data.json. Everything in it is counted by searching the text of the Rocq files under
// proof/ at a given commit. We do not run the prover: Phil's own CI does that, and it is the authority.
import * as fs from "fs";
import { execFileSync } from "child_process";

const root = process.argv[2];
if (!root || !fs.existsSync(`${root}/proof`)) { console.error("usage: npm run proofs -- <path to a checkout of abiggerhammer/phil>"); process.exit(2); }
const DAYS = 35;
const FILES = ":(glob)proof/**/*.v";
const git = (...args: string[]): string => {
  try { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }); }
  catch (e: any) { if (e.status === 1) return ""; throw e; }            // git grep exits 1 when nothing matches
};
const lines = (s: string) => s.split("\n").filter(Boolean);

// A statement that has to be proved, and the two ways a Rocq proof can end without proving it.
const STATEMENT = "^[[:space:]]*(Theorem|Lemma|Corollary|Proposition|Fact|Remark)[[:space:]]+[A-Za-z_]";
const UNFINISHED = "^[[:space:]]*(Admitted|Abort)\\.";
const AXIOM = "^[[:space:]]*(Axiom|Conjecture)[[:space:]]+[A-Za-z_]";

interface Count { files: number; lines: number; statements: number; qed: number; unfinished: number; axioms: number }
/** Per file: how many lines match. */
function perFile(commit: string, pattern: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines(git("grep", "-c", "-E", "-e", pattern, commit, "--", FILES))) {
    const at = l.lastIndexOf(":"), file = l.slice(commit.length + 1, at);
    out.set(file, Number(l.slice(at + 1)));
  }
  return out;
}
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
function count(commit: string): Count {
  const all = perFile(commit, "");
  return { files: all.size, lines: sum(all), statements: sum(perFile(commit, STATEMENT)), qed: sum(perFile(commit, "(Qed|Defined)\\.")), unfinished: sum(perFile(commit, UNFINISHED)), axioms: sum(perFile(commit, AXIOM)) };
}
/** Every statement at a commit, as "file\tKind\tname". */
function statements(commit: string): Set<string> {
  const out = new Set<string>();
  for (const l of lines(git("grep", "-E", "-e", STATEMENT, commit, "--", FILES))) {
    const rest = l.slice(commit.length + 1), at = rest.indexOf(":"), m = /^\s*(\w+)\s+([A-Za-z_][\w']*)/.exec(rest.slice(at + 1));
    if (m) out.add(`${rest.slice(0, at)}\t${m[1]}\t${m[2]}`);
  }
  return out;
}

const head = git("rev-parse", "HEAD").trim(), headDate = git("log", "-1", "--format=%cs", head).trim();

// The last commit of each day on the main line.
const since = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);
const lastOfDay = new Map<string, string>();
for (const l of lines(git("log", "--first-parent", `--since=${since}T00:00:00Z`, "--format=%H %cs"))) {
  const [sha, date] = l.split(" ");
  if (date! >= since && !lastOfDay.has(date!)) lastOfDay.set(date!, sha!);
}
const series = [...lastOfDay].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, sha]) => { const c = count(sha); return { date, files: c.files, lines: c.lines, statements: c.statements }; });

// By area: the folders directly under proof/Phil.
const now = count(head), allLines = perFile(head, ""), stmts = perFile(head, STATEMENT);
const areas = new Map<string, { name: string; files: number; lines: number; statements: number }>();
for (const [file, n] of allLines) {
  const name = /^proof\/Phil\/([^/]+)\//.exec(file)?.[1] ?? "Other";
  const a = areas.get(name) ?? { name, files: 0, lines: 0, statements: 0 };
  a.files++; a.lines += n; a.statements += stmts.get(file) ?? 0;
  areas.set(name, a);
}

// What was proved since the last commit of the day before the newest one.
const dates = [...lastOfDay.keys()].sort(), before = dates.length > 1 ? lastOfDay.get(dates[dates.length - 2]!)! : null;
const was = before ? statements(before) : new Set<string>();
const fresh = before ? [...statements(head)].filter((s) => !was.has(s)).map((s) => { const [file, kind, name] = s.split("\t"); return { file: file!, kind: kind!, name: name! }; }) : [];

// Whatever the proofs take on trust, in Phil's own declarations.
const assumed = lines(git("grep", "-n", "-E", "-e", AXIOM, head, "--", FILES)).map((l) => {
  const rest = l.slice(head.length + 1), [file, line, ...text] = rest.split(":");
  return { file: file!, line: Number(line), name: /^\s*\w+\s+([A-Za-z_][\w']*)/.exec(text.join(":"))?.[1] ?? "" };
});

const week = series.length > 7 ? series[series.length - 8]! : series[0]!;
const data = {
  generated: new Date().toISOString(), commit: head, commitDate: headDate,
  now, areas: [...areas.values()].sort((a, b) => b.statements - a.statements),
  week: { since: week.date, statements: now.statements - week.statements, lines: now.lines - week.lines, files: now.files - week.files },
  series, freshSince: before ? dates[dates.length - 2]! : null, freshCount: fresh.length, fresh: fresh.slice(0, 400), assumed,
};
fs.writeFileSync("proofs/data.json", JSON.stringify(data, null, 1) + "\n");
console.log(`${now.statements} statements, ${now.lines} lines in ${now.files} files; ${now.unfinished} unfinished; ${now.axioms} axioms; +${data.week.statements} in a week; ${fresh.length} since ${data.freshSince}`);
