// The runnable companion to Phil's official tour.
import { STOPS, TOUR_URL, anchor, Part } from "./tour-data";
import { mountEditor, runPhil, KIND_TITLE, esc, store, landed } from "./shared";
import { wireFooter } from "./foot";

const $ = (id: string) => document.getElementById(id)!;
const rich = (s: string) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const ran = new Set<string>(JSON.parse(store("phil-tour-ran") ?? "[]"));
const runnable = STOPS.reduce((n, s) => n + s.parts.filter((p) => p.expect !== "declares").length, 0);
const total = STOPS.reduce((n, s) => n + s.parts.length, 0);

($("tour-link") as HTMLAnchorElement).href = TOUR_URL;
$("why").innerHTML = `<b>${total} programs, ${runnable} of them runnable.</b> The rest are declarations, which Phil checks but which have nothing to run. Nothing here needs an install.`;
$("jump").innerHTML = STOPS.map((s) => `<a href="#s${s.n}" data-n="${s.n}" title="${esc(s.title)}">${s.n}</a>`).join("");
$("stops").innerHTML = STOPS.map((s) => `<section class="stop" id="s${s.n}">
  <div class="num">${String(s.n).padStart(2, "0")} of ${STOPS.length}</div>
  <h2>${esc(s.title)}</h2>
  <p class="idea">${rich(s.idea)}</p>
  <a class="orig" href="${TOUR_URL}#${anchor(s)}" rel="noopener">Read this section in Phil's tour →</a>
  ${s.parts.map((p, i) => `<div class="part" data-key="${s.n}.${i}">
    ${p.label ? `<h3>${rich(p.label)}</h3>` : ""}
    <div class="editor"></div>
    ${p.inputs ? `<div class="inputs">${Object.entries(p.inputs).map(([k, v]) => `<label>${esc(k)} <input data-k="${esc(k)}" value="${esc(v)}" autocomplete="off" autocapitalize="off"></label>`).join("")}</div>` : ""}
    <div class="row"><button class="btn run" type="button">${p.expect === "declares" ? "Check it" : "Run it"}</button><button class="btn ghost small reset" type="button">Reset</button><span class="muted note" role="status"></span></div>
    <div class="out" hidden></div>
    ${p.note ? `<p class="aside"><b>A difference from the tour.</b> ${rich(p.note)}</p>` : ""}
    ${p.tryit ? `<p class="aside"><b>Try this.</b> ${rich(p.tryit)}</p>` : ""}
  </div>`).join("")}
  ${s.see ? `<ul class="see">${s.see.map(([label, href]) => `<li><a href="${esc(href)}">${esc(label)} →</a></li>`).join("")}</ul>` : ""}
</section>`).join("");

const mark = () => document.querySelectorAll<HTMLAnchorElement>("#jump a").forEach((a) => {
  const s = STOPS[Number(a.dataset.n) - 1];
  a.classList.toggle("ran", s.parts.length > 0 && s.parts.every((_, i) => ran.has(`${s.n}.${i}`)));
});
mark();

document.querySelectorAll<HTMLElement>(".part").forEach((host) => {
  const [n, i] = host.dataset.key!.split(".").map(Number);
  const part: Part = STOPS[n - 1].parts[i];
  const editor = mountEditor(host.querySelector<HTMLElement>(".editor")!, part.code, () => {});
  const out = host.querySelector<HTMLElement>(".out")!, note = host.querySelector<HTMLElement>(".note")!;
  let runs = 0;
  const inputs = () => Object.fromEntries([...host.querySelectorAll<HTMLInputElement>(".inputs input")].map((el) => [el.dataset.k!, el.value]));
  host.querySelector(".run")!.addEventListener("click", () => {
    const o = runPhil(editor.value, inputs());
    const nothing = !o.ok && o.kind === "wiring" && /Nothing to run/.test(o.message);
    editor.mark(o.ok || nothing ? undefined : o.span);
    const lines = [...o.console, ...o.returns.filter((r) => r.text !== "").map((r) => `${r.proc} hands back ${r.text}`)];
    out.innerHTML = (o.ok ? `<div class="v good">Ran to completion</div>`
      : nothing ? `<div class="v plain">Valid Phil. These are declarations, so there is nothing to run.</div>`
      : `<div class="v bad">${esc(KIND_TITLE[o.kind] ?? o.kind)}${o.line ? ` · line ${o.line}` : ""}</div><div>${esc(o.message)}</div>${part.expect === "stops" && o.kind === part.kind && editor.value === part.code ? `<div class="muted" style="margin-top:6px">This is the point of the example: Phil refuses it.</div>` : ""}`)
      + (lines.length ? `<pre>${esc(lines.join("\n"))}</pre>` : "");
    out.hidden = false;
    ran.add(host.dataset.key!); store("phil-tour-ran", JSON.stringify([...ran])); mark();
    landed(out, note, `${part.expect === "declares" ? "Checked" : "Ran"} just now (${++runs})`);
  });
  host.querySelector(".reset")!.addEventListener("click", () => {
    editor.set(part.code); out.hidden = true; note.textContent = "";
    host.querySelectorAll<HTMLInputElement>(".inputs input").forEach((el) => { el.value = part.inputs?.[el.dataset.k!] ?? ""; });
  });
});

// Show where the reader is.
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const n = e.target.id.slice(1);
    document.querySelectorAll<HTMLAnchorElement>("#jump a").forEach((a) => { a.classList.toggle("here", a.dataset.n === n); if (a.dataset.n === n) a.scrollIntoView({ block: "nearest", inline: "center" }); });
  }), { rootMargin: "-45% 0px -50% 0px" });
  document.querySelectorAll(".stop").forEach((s) => io.observe(s));
}
wireFooter();
