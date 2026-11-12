// "What changed in Phil": renders changelog/data.json.
import data from "../../changelog/data.json";
import { esc } from "./shared";
import { wireFooter } from "./foot";

const $ = (id: string) => document.getElementById(id)!;
type Day = (typeof data.days)[number];
const PHIL = "https://github.com/abiggerhammer/phil";
const n = (count: number, one: string, many = one + "s") => `${count} ${count === 1 ? one : many}`;
const landed = (d: Day) => d.commits + d.merges;
const programs = (d: Day) => d.programs.reduce((t, p) => t + p.accepted + p.rejected, 0);
const nice = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function facts(d: Day): string[] {
  const out: string[] = [];
  if (d.grammar.length) out.push(`<span class="hot">The grammar changed: ${d.grammar.map(esc).join(", ")}</span>`);
  if (d.streams.length) out.push("Work on " + d.streams.map((s) => `${esc(s.about)} (${s.n})`).join(", "));
  const added = programs(d);
  if (added) {
    const acc = d.programs.reduce((t, p) => t + p.accepted, 0), rej = added - acc;
    out.push(`${n(added, "new test program")}: ${rej} that must be rejected, ${acc} that must be accepted, across ${n(d.programs.length, "suite")}`);
  }
  if (d.programsRemoved) out.push(`${n(d.programsRemoved, "test program")} removed`);
  if (d.notes.length) out.push(n(d.notes.length, "new design note"));
  if (d.proofsAdded || d.proofsChanged) out.push(`Machine-checked proofs: ${n(d.proofsAdded, "new file")}, ${d.proofsChanged} changed`);
  if (d.modules.length) out.push(`${n(d.modules.length, "new compiler module")}`);
  return out;
}

function dayHtml(d: Day): string {
  const lists: string[] = [];
  if (d.notes.length) lists.push(`<details class="more"><summary>The ${n(d.notes.length, "new note")}</summary><ul>${d.notes.map((x) => `<li><a href="${PHIL}/blob/main/${esc(x.path)}">${esc(x.title)}</a></li>`).join("")}</ul></details>`);
  if (d.programs.length) lists.push(`<details class="more"><summary>Test programs by suite</summary><ul>${d.programs.map((p) => `<li>${esc(p.suite)}: ${p.rejected} rejected, ${p.accepted} accepted</li>`).join("")}</ul></details>`);
  if (d.modules.length) lists.push(`<details class="more"><summary>New compiler modules</summary><ul>${d.modules.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></details>`);
  return `<article class="day" id="d-${d.date}">
    <div class="when"><b>${esc(nice(d.date))}</b><span>${d.date}</span></div>
    <div>
      <p class="sum">${n(landed(d), "change")} landed${d.merges ? `, ${d.merges} of them merged pull requests` : ""}.</p>
      <ul class="facts">${facts(d).map((f) => `<li>${f}</li>`).join("")}</ul>
      ${d.headlines.length ? `<p class="words-h">In the repository's own words</p><ul class="words">${d.headlines.map((h) => `<li><a href="${PHIL}/commit/${h.sha}">${esc(h.subject)}</a></li>`).join("")}</ul>` : ""}
      ${lists.join("")}
    </div>
  </article>`;
}

const days = data.days;
const week = days.slice(0, 7);
const total = (f: (d: Day) => number) => week.reduce((t, d) => t + f(d), 0);
$("against").textContent = `Up to Phil commit ${data.phil.commit} of ${data.phil.date} · history since ${data.since}`;
const span = week.length ? `the last ${n(week.length, "active day")}` : "no recent activity";
$("week").innerHTML = [
  [total(landed), `changes landed in ${span}`],
  [total(programs), "new test programs"],
  [total((d) => d.notes.length), "new design notes"],
  [total((d) => d.proofsAdded), "new proof files"],
  [total((d) => d.modules.length), "new compiler modules"],
].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("");
const moved = days.filter((d) => d.grammar.length);
const g = $("grammar");
g.classList.toggle("changed", moved.length > 0);
g.textContent = moved.length
  ? `The grammar changed on ${moved.map((d) => d.date).join(", ")}. Our parser, the course and the extension are written against it, so check the conformance report.`
  : `The grammar has not changed since ${data.since}. All of this work is underneath it: semantics, proofs and the compiler, not new syntax.`;

// One bar per calendar day in the window, including quiet days.
const byDate = new Map(days.map((d) => [d.date, landed(d)]));
const dates: string[] = [];
for (let t = Date.parse(data.since + "T12:00:00Z"); t <= Date.parse(data.phil.date + "T12:00:00Z"); t += 86400_000) dates.push(new Date(t).toISOString().slice(0, 10));
const peak = Math.max(1, ...byDate.values());
$("bars").innerHTML = dates.map((d) => { const v = byDate.get(d) ?? 0; return `<i class="${v ? "" : "quiet"}" style="height:${v ? Math.max(4, (100 * v) / peak) : 2}%" title="${d}: ${v}"></i>`; }).join("");
$("bars").setAttribute("aria-label", `Changes landed per day from ${data.since} to ${data.phil.date}; the busiest day had ${peak}.`);
$("bar-from").textContent = data.since;
$("bar-to").textContent = data.phil.date;

$("days").innerHTML = days.map(dayHtml).join("") || `<p class="lead">Nothing landed in this window.</p>`;
$("history").innerHTML = `<thead><tr><th>Phil commit</th><th>Date</th><th>Programs</th><th>Grammar tests agreed</th><th>Accepted programs run clean</th><th>Rejections also caught</th><th>Sample programs philc compiles</th></tr></thead><tbody>`
  + [...data.history].reverse().map((h) => `<tr><td>${esc(h.commit)}</td><td>${esc(h.date)}</td><td>${h.files}</td><td>${esc(h.grammar)}</td><td>${h.ranClean} of ${h.accepted}</td><td>${h.caught} of ${h.rejected}</td><td>${h.philcTried ? `${h.philcAccepts} of ${h.philcTried}` : "n/a"}</td></tr>`).join("") + `</tbody>`;
wireFooter();
