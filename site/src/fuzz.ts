// Fuzzing page: renders fuzz/data.json and fuzz/history.json. Counts only.
import data from "../../fuzz/data.json";
import history from "../../fuzz/history.json";
import { esc } from "./shared";
import { wireFooter } from "./foot";

const $ = (id: string) => document.getElementById(id)!;
const num = (n: number) => n.toLocaleString("en-GB");
const all = history.reduce((t, h) => t + h.total, 0), allCompared = history.reduce((t, h) => t + h.compared, 0);
const f = data.findings;
$("against").textContent = `Latest run: Phil commit ${data.phil.commit} of ${data.phil.date} · seed ${data.seed} · ${data.seconds} s`;
$("figs").innerHTML = [
  [num(all), `inputs tried over ${history.length} run${history.length === 1 ? "" : "s"}`, ""],
  [num(allCompared), "programs with an answer we could check", ""],
  [String(f.disagreement), "wrong answers in the latest run", f.disagreement ? "" : "zero"],
  [String(f.crash + f.hang + f.slow + f.inconsistent), "other findings in the latest run", ""],
].map(([v, l, c]) => `<div class="${c}"><b>${v}</b><span>${l}</span></div>`).join("");
$("verdict").textContent = f.disagreement === 0
  ? `In the latest run, ${num(data.compared)} generated programs had an answer we could work out by hand. Phil's compiler accepted or refused each one as expected and compiled every accepted one to the right value. ${num(data.simCompared)} of them were also run in our simulator, which agreed.`
  : `In the latest run the compiler and our expected answer differed on ${f.disagreement} kind${f.disagreement === 1 ? "" : "s"} of program. A difference can be our mistake as easily as the compiler's, and is being looked at.`;
const KINDS: [keyof typeof f, string, string][] = [
  ["disagreement", "Wrong answer", "A small program whose result we can work out, where the compiler accepts or refuses differently, or compiles it to a different value."],
  ["crash", "Crash", "The compiler stops with an internal error instead of a message about the program."],
  ["hang", "Hang", "No answer within ten seconds."],
  ["inconsistent", "Inconsistent", "The same input giving different answers for two targets, or on a second run."],
  ["slow", "Slow growth", "Time that grows much faster than the input: double the size, far more than double the time."],
];
$("kinds").innerHTML = KINDS.map(([k, name, d]) => `<li><span class="n${f[k] ? "" : " zero"}">${f[k]}</span><b>${name}</b><span class="d">${d}</span></li>`).join("");
$("history").innerHTML = `<thead><tr><th>Day</th><th>Phil commit</th><th>Seed</th><th>Inputs</th><th>Checked against an answer</th><th>Findings</th></tr></thead><tbody>`
  + [...history].reverse().slice(0, 60).map((h) => `<tr><td>${esc(h.day)}</td><td>${esc(h.commit)}</td><td>${h.seed}</td><td>${num(h.total)}</td><td>${num(h.compared)}</td><td>${h.findings}</td></tr>`).join("") + `</tbody>`;
wireFooter();
