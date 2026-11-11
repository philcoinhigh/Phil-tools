// Conformance report page: renders conformance/data.json.
import data from "../../conformance/data.json";
import { esc } from "./shared";
import { wireFooter } from "./foot";

const $ = (id: string) => document.getElementById(id)!;
const pct = (a: number, b: number) => (b ? (100 * a) / b : 0);
interface Part { n: number; cls: string; label: string }
function fig(total: number, headline: number, label: string, parts: Part[]): string {
  return `<div class="fig"><div class="n">${headline}<small> of ${total}</small></div><div class="l">${label}</div>`
    + `<div class="bar" role="img" aria-label="${esc(parts.map((p) => `${p.n} ${p.label}`).join(", "))}">${parts.map((p) => `<i class="${p.cls}" style="width:${pct(p.n, total)}%"></i>`).join("")}</div>`
    + `<ul class="key">${parts.filter((p) => p.n > 0).map((p) => `<li><b>${p.n}</b> ${esc(p.label)}</li>`).join("")}</ul></div>`;
}

const g = data.grammar, b = data.behaviour;
$("against").textContent = `Checked against Phil commit ${data.phil.commit} of ${data.phil.date} · ${data.files} programs`;
$("grammar").innerHTML =
  fig(g.accept.files, g.accept.agree, "files that must parse do parse", [{ n: g.accept.agree, cls: "ok", label: "parse" }, { n: g.accept.files - g.accept.agree, cls: "rev", label: "we reject" }])
  + fig(g.reject.files, g.reject.agree, "files that must not parse are flagged", [{ n: g.reject.agree, cls: "ok", label: "flagged" }, { n: g.reject.files - g.reject.agree, cls: "mid", label: "not flagged" }]);
$("behaviour").innerHTML =
  fig(b.accept.files, b.accept.ran, "accepted programs run clean in the simulator", [
    { n: b.accept.ran, cls: "ok", label: "run clean" },
    { n: b.accept.parsedOnly, cls: "mid", label: "parse, but use features the simulator does not run" },
    { n: b.accept.review, cls: "rev", label: "we reject (under review)" }])
  + fig(b.reject.files, b.reject.caught, "rejected programs also fail here", [
    { n: b.reject.caught, cls: "ok", label: "fail here too, though we do not check it is for Phil's reason" },
    { n: b.reject.missed, cls: "mid", label: "not caught: needs Phil's checker" }]);
if (b.accept.review > 0) {
  const note = $("review-note");
  note.hidden = false;
  $("table-note").hidden = false;
  note.textContent = `${b.accept.review} program${b.accept.review === 1 ? "" : "s"} that Phil's tests accept ${b.accept.review === 1 ? "is" : "are"} stopped by our simulator. Where we have looked, Phil's test checks one step of the program and our simulator objects to something outside that step, such as a value still held when a component ends. So these look like differences of scope rather than disagreements, and we have left the simulator strict. The file names are not listed here: Phil's security policy asks that anything which might be an acceptance question is raised privately first.`;
}
const cell = (n: number) => `<td${n ? "" : ' class="z"'}>${n}</td>`;
$("suites").innerHTML = `<thead><tr><th>Suite</th><th>Phil says</th><th>Files</th><th>Agree</th><th>Parsed only</th><th>Not caught</th></tr></thead><tbody>`
  + data.suites.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.expect}</td>${cell(s.files)}${cell(s.agree)}${cell(s.parsedOnly)}${cell(s.missed)}</tr>`).join("") + `</tbody>`;
$("missed-h").textContent = `The ${data.missed.length} rejected programs our tools do not catch`;
$("missed").innerHTML = data.missed.map((m) => `<li>${esc(m.file)}</li>`).join("");
wireFooter();
