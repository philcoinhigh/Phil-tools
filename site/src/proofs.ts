// "The proof ledger": renders proofs/data.json.
import data from "../../proofs/data.json";
import { esc } from "./shared";
import { wireFooter } from "./foot";

const $ = (id: string) => document.getElementById(id)!;
const PHIL = "https://github.com/abiggerhammer/phil";
const num = (n: number) => n.toLocaleString("en-US");
const nice = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
const short = data.commit.slice(0, 10);

// What each folder of proofs is about. Ours, written from the files' own headers.
const ABOUT: Record<string, string> = {
  Core: "The calculus underneath: ownership, sessions, protocols, resources",
  Surface: "The language people write, and that it means what the core says",
  Verification: "The models behind Phil's own checking of evidence",
  Assurance: "Which claims count as discharged, and on whose authority",
  LLVM: "The path down to machine code",
  Systems: "Files, processes and the outside world",
};

$("against").textContent = `Counted at Phil commit ${short} of ${data.commitDate}`;
const n = data.now;
$("tally").innerHTML = [
  ["", num(n.statements), "theorems and lemmas, each checked by machine"],
  ["", num(n.lines), `lines of proof in ${num(n.files)} files`],
  ["", "+" + num(data.week.statements), `theorems since ${nice(data.week.since)}`],
  [n.unfinished === 0 ? "zero" : "", num(n.unfinished), "proofs left unfinished"],
].map(([cls, v, l]) => `<div class="${cls}"><b>${v}</b><span>${esc(l!)}</span></div>`).join("");

const s = data.series, first = s[0]!, last = s[s.length - 1]!;
const perDay = s.length > 1 ? Math.round((last.statements - first.statements) / (s.length - 1)) : 0;
$("pace").textContent = `${nice(first.date)}: ${num(first.statements)} theorems. ${nice(last.date)}: ${num(last.statements)}. That is about ${num(perDay)} new theorems a day, every day, for ${s.length - 1} days.`;
const low = Math.min(...s.map((d) => d.statements)) * 0.9, high = Math.max(...s.map((d) => d.statements));
$("climb").innerHTML = s.map((d) => `<i style="height:${Math.max(2, (100 * (d.statements - low)) / (high - low))}%" title="${d.date}: ${num(d.statements)} theorems"></i>`).join("");
$("climb").setAttribute("aria-label", `Theorems in Phil's repository at the end of each day, rising from ${num(first.statements)} on ${first.date} to ${num(last.statements)} on ${last.date}. The bars do not start at zero.`);
$("climb-from").textContent = `${first.date} · ${num(first.statements)}`;
$("climb-to").textContent = `${num(last.statements)} · ${last.date}`;

const most = Math.max(...data.areas.map((a) => a.statements));
$("areas").innerHTML = `<thead><tr><th>Part of Phil</th><th>Theorems</th><th>Lines of proof</th><th>Files</th></tr></thead><tbody>`
  + data.areas.map((a) => `<tr><td><b><a href="${PHIL}/tree/main/proof/Phil/${esc(a.name)}">${esc(a.name)}</a></b><span>${esc(ABOUT[a.name] ?? "")}</span></td><td>${num(a.statements)}<span class="share" style="width:${Math.max(2, (100 * a.statements) / most)}%"></span></td><td>${num(a.lines)}</td><td>${num(a.files)}</td></tr>`).join("") + `</tbody>`;

// Proved since the day before: grouped by file, newest work first as git lists it.
const item = (f: { file: string; kind: string; name: string }) => `<li><a href="${PHIL}/blob/${data.commit}/${esc(f.file)}">${esc(f.name)}</a> <span>${esc(f.file.split("/").pop()!.replace(/\.v$/, ""))}</span></li>`;
if (data.freshSince) {
  $("fresh-h").textContent = `Proved since ${nice(data.freshSince)}`;
  $("fresh-l").textContent = data.freshCount
    ? `${num(data.freshCount)} theorems are in the repository now that were not there at the end of ${nice(data.freshSince)}. Each name links to the file it is proved in.`
    : `Nothing new since the end of ${nice(data.freshSince)}.`;
  $("fresh").innerHTML = data.fresh.slice(0, 24).map(item).join("");
  if (data.fresh.length > 24) $("fresh-more").innerHTML = `<details class="more"><summary>The other ${num(data.fresh.length - 24)}</summary><ul class="fresh">${data.fresh.slice(24).map(item).join("")}</ul></details>`;
} else $("fresh-l").textContent = "Not enough history to compare with yesterday.";

// What each declared assumption says, in plain words, where we have read it. Otherwise just its name.
const PLAIN: Record<string, string> = {
  replace_binding_is_process_observable: "That a file, once written, reads back as what was written. A statement about the file system, which lives outside the language.",
  clean_described_segment_is_valid: "That the facts Phil's implementation extracts about a piece of a file path describe that piece truthfully. The boundary with the host's text library.",
  accepted_bytes_length_evidence_sound: "That accepted evidence about the length of some bytes is true. The proof of that belongs to the evidence checker, not to this file.",
};
$("trust").innerHTML = `<li><b>${num(n.unfinished)} unfinished proofs</b><p>${n.unfinished === 0 ? "No proof in the repository ends in <code>Admitted</code>. Every theorem counted above is carried through to its end." : "These end in <code>Admitted</code> and are not proved yet."}</p></li>`
  + `<li><b>${num(data.assumed.length)} declared assumptions</b><p>${data.assumed.length ? "Each one is stated in the open, at the edge where the language meets something it does not control." : "None."}</p></li>`
  + data.assumed.map((a) => `<li><b><a href="${PHIL}/blob/${data.commit}/${esc(a.file)}#L${a.line}">${esc(a.name)}</a></b><p>${esc(PLAIN[a.name] ?? "Declared in " + a.file + ".")}</p></li>`).join("");
wireFooter();
