// "Hacks Phil would have stopped": runs each exhibit's broken and fixed program in the simulator.
import { HACKS, NOT_STOPPED, Hack } from "../../core/src/sim/hacks";
import { runPhil, highlightHtml, KIND_TITLE, esc } from "./shared";
import { wireFooter } from "./foot";

const $ = (id: string) => document.getElementById(id)!;
const fixedNow = new Set<string>();

function demo(h: Hack): string {
  const fixed = fixedNow.has(h.id);
  const src = fixed ? h.fixed : h.broken;
  const inputs = (fixed ? h.fixedInputs : undefined) ?? h.inputs ?? {};
  const o = runPhil(src, inputs);
  const ins = Object.entries(inputs).map(([k, v]) => `${k} = ${v}`).join(" · ");
  const said = o.ok
    ? `<b>Ran to completion</b>${esc([...o.console, ...o.returns.map((r) => `hands back ${r.text}`)].join(" · "))}`
    : `<b>${esc(KIND_TITLE[o.kind] ?? o.kind)}${o.line ? `, line ${o.line}` : ""}</b>${esc(o.message)}`;
  return `<p class="label">${fixed ? "The working version" : "The same mistake in Phil"}</p>`
    + `<pre class="code">${highlightHtml(src, o.ok ? undefined : o.span)}</pre>`
    + (ins ? `<div class="ins">run with ${esc(ins)}</div>` : "")
    + `<div class="says${o.ok ? " good" : ""}">${said}</div>`
    + `<div class="acts"><button type="button" class="btn ghost small" data-flip="${h.id}">${fixed ? "Show the mistake again" : "Show the working version"}</button>${fixed ? `<span class="fixnote">${esc(h.fixNote)}</span>` : ""}</div>`;
}

$("jump").innerHTML = HACKS.map((h) => `<a href="#${h.id}"><span>${h.year}</span>${esc(h.name)}</a>`).join("");
$("hacks").innerHTML = HACKS.map((h) => `<article class="hack" id="${h.id}">
  <div>
    <div class="yr">${h.year}</div>
    <h2>${esc(h.name)}</h2>
    <p class="loss">${esc(h.loss)}</p>
    <p>${esc(h.happened)}</p>
    <p class="shape">${esc(h.shape)}</p>
    <p>${esc(h.why)}</p>
    <p class="src">Sources: ${h.sources.map((s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a>`).join("")}</p>
  </div>
  <div class="demo" id="demo-${h.id}">${demo(h)}</div>
</article>`).join("");
$("limits").innerHTML = NOT_STOPPED.map((t) => `<li>${esc(t)}</li>`).join("");
$("hacks").addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-flip]")?.dataset.flip;
  const h = HACKS.find((x) => x.id === id);
  if (!h) return;
  if (fixedNow.has(h.id)) fixedNow.delete(h.id); else fixedNow.add(h.id);
  $("demo-" + h.id).innerHTML = demo(h);
});
wireFooter();
