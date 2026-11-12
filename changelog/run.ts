// Builds a day-by-day record of what changed in the Phil repository, from its git history.
//
//   npm run changelog -- ../phil        (needs history: clone with --shallow-since or in full)
//
// Writes changelog/data.json. Everything in it is counted or copied from git; nothing is guessed.
// It also appends today's conformance figures to changelog/history.json when the Phil commit is new.
import * as fs from "fs";
import { execFileSync } from "child_process";

const root = process.argv[2];
if (!root || !fs.existsSync(`${root}/grammar`)) { console.error("usage: npm run changelog -- <path to a checkout of abiggerhammer/phil>"); process.exit(2); }
const DAYS = 21;
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

// What each commit-subject prefix is about, where we are confident of it.
const STREAMS: [RegExp, string, string][] = [
  [/^fsem-?01\b/i, "FSEM-01", "formal semantics: values, ownership and loops"],
  [/^fsem-?02\b/i, "FSEM-02", "formal semantics: protocols and transfer"],
  [/^(rocq|proof|proof-script)/i, "Proofs", "machine-checked proofs"],
  [/^(impl-)?audit\b/i, "Audit", "audits of the implementation"],
  [/^docs?\b/i, "Docs", "documentation"],
  [/^ci\b/i, "CI", "build and test automation"],
  [/^int-?\d+/i, "Integration", "end-to-end integration"],
];

interface Day {
  date: string; commits: number; merges: number;
  streams: { name: string; about: string; n: number }[];
  programs: { suite: string; accepted: number; rejected: number }[]; programsRemoved: number;
  notes: { path: string; title: string }[];
  proofsAdded: number; proofsChanged: number;
  modules: string[]; grammar: string[];
  headlines: { sha: string; subject: string }[];
}
const days = new Map<string, Day>();
const day = (date: string): Day => {
  let d = days.get(date);
  if (!d) days.set(date, d = { date, commits: 0, merges: 0, streams: [], programs: [], programsRemoved: 0, notes: [], proofsAdded: 0, proofsChanged: 0, modules: [], grammar: [], headlines: [] });
  return d;
};
const bump = <T,>(list: T[], find: (x: T) => boolean, make: () => T): T => { let x = list.find(find); if (!x) list.push(x = make()); return x; };

const since = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);
const log = git("log", `--since=${since}T00:00:00Z`, "--first-parent", "--diff-merges=first-parent", "--name-status", "--format=%x01%H%x02%cs%x02%P%x02%s");
for (const block of log.split("\x01").slice(1)) {
  const [head, ...rest] = block.split("\n");
  const [sha, date, parents, subject] = head.split("\x02");
  if (date < since) continue;
  const d = day(date);
  const merge = parents.trim().includes(" ");
  if (merge && /^Merge /.test(subject)) {
    d.merges++;
    // A merged pull request is named after its branch; the last part is the readable bit.
    const branch = /from \S+?\/(\S+)$/.exec(subject)?.[1];
    if (branch && d.headlines.length < 40) d.headlines.push({ sha: sha.slice(0, 10), subject: "Merged: " + branch.split("/").slice(-2).join(" / ").replace(/-/g, " ") });
  } else {
    d.commits++;
    const clean = subject.replace(/\s*\(#\d+\)\s*$/, "");
    const m = STREAMS.find(([re]) => re.test(clean));
    if (m) bump(d.streams, (s) => s.name === m[1], () => ({ name: m[1], about: m[2], n: 0 })).n++;
    if (d.headlines.length < 40) d.headlines.push({ sha: sha.slice(0, 10), subject: clean.length > 110 ? clean.slice(0, 107) + "…" : clean });
  }
  for (const line of rest) {
    const [status, a, b] = line.split("\t");
    if (!status || !a) continue;
    const file = b ?? a, kind = status[0];
    if (file.endsWith(".phil") && file.startsWith("test/fixtures/")) {
      if (kind === "A") {
        const parts = file.split("/");
        const suite = parts[2] === "phase1-surface" ? "grammar fixtures" : parts[2];
        const p = bump(d.programs, (x) => x.suite === suite, () => ({ suite, accepted: 0, rejected: 0 }));
        if (parts[2] === "phase1-surface" ? parts[3] === "accepted" : /^(accepted|positive)/.test(parts[parts.length - 1])) p.accepted++; else p.rejected++;
      } else if (kind === "D") d.programsRemoved++;
    } else if (kind === "A" && /^docs\/.*\.md$/.test(file)) {
      let title = "";
      try { title = (git("show", `${sha}:${file}`).split("\n").find((l) => l.startsWith("# ")) ?? "").slice(2).trim(); } catch { /* removed later in the same push */ }
      if (title && d.notes.length < 60) d.notes.push({ path: file, title: title.length > 120 ? title.slice(0, 117) + "…" : title });
    } else if (/^proof\/.*\.v$/.test(file)) { if (kind === "A") d.proofsAdded++; else if (kind === "M") d.proofsChanged++; }
    else if (kind === "A" && /^src\/Phil\/.*\.hs$/.test(file)) d.modules.push(file.slice(4, -3).replace(/\//g, "."));
    else if (file.startsWith("grammar/") && !d.grammar.includes(file)) d.grammar.push(file);
  }
}

// Keep a few headlines per day: one from each named stream first, then the rest in order.
for (const d of days.values()) {
  const picked: typeof d.headlines = [];
  const seen = new Set<string>();
  for (const h of d.headlines) { const m = STREAMS.find(([re]) => re.test(h.subject)); if (m && !seen.has(m[1])) { seen.add(m[1]); picked.push(h); } }
  for (const h of d.headlines) if (picked.length < 4 && !picked.includes(h)) picked.push(h);
  d.headlines = picked.slice(0, 4);
  d.streams.sort((a, b) => b.n - a.n);
  d.programs.sort((a, b) => b.accepted + b.rejected - (a.accepted + a.rejected));
}
const list = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
const head = { commit: git("rev-parse", "--short=10", "HEAD").trim(), date: git("log", "-1", "--format=%cs").trim() };

// How our own tools stood against each Phil commit they were run on.
interface Point { date: string; commit: string; files: number; grammar: string; ranClean: number; accepted: number; caught: number; rejected: number; philcAccepts: number; philcTried: number }
const histFile = "changelog/history.json";
const history: Point[] = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, "utf8")) : [];
try {
  const c = JSON.parse(fs.readFileSync("conformance/data.json", "utf8"));
  const idx = fs.existsSync("philc/expected/index.txt") ? fs.readFileSync("philc/expected/index.txt", "utf8").trim().split("\n") : [];
  const point: Point = {
    date: c.phil.date, commit: c.phil.commit, files: c.files,
    grammar: `${c.grammar.accept.agree + c.grammar.reject.agree}/${c.grammar.accept.files + c.grammar.reject.files}`,
    ranClean: c.behaviour.accept.ran, accepted: c.behaviour.accept.files, caught: c.behaviour.reject.caught, rejected: c.behaviour.reject.files,
    philcAccepts: idx.filter((l) => l.startsWith("0 ")).length, philcTried: idx.length,
  };
  const last = history[history.length - 1];
  if (!last || last.commit !== point.commit) history.push(point); else history[history.length - 1] = point;
  fs.writeFileSync(histFile, JSON.stringify(history.slice(-120), null, 1) + "\n");
} catch { /* no conformance data yet */ }

fs.writeFileSync("changelog/data.json", JSON.stringify({ phil: head, since, days: list, history: history.slice(-30) }, null, 1) + "\n");
const sum = (f: (d: Day) => number) => list.reduce((n, d) => n + f(d), 0);
console.log(`Phil ${head.commit}: ${list.length} days since ${since}, ${sum((d) => d.commits)} commits, ${sum((d) => d.programs.reduce((n, p) => n + p.accepted + p.rejected, 0))} test programs added, ${sum((d) => d.notes.length)} notes added, grammar touched on ${list.filter((d) => d.grammar.length).length} days`);
