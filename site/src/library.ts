// Contract library page: runs the programs in contracts/ in the simulator.
import { CONTRACTS, Contract } from "../../core/src/sim/contracts";
import { buildAst } from "../../core/src/sim/ast";
import { explore } from "../../core/src/sim/explore";
import { runPhil, highlightHtml, KIND_TITLE, esc, landed, runLabel } from "./shared";
import { wireFooter } from "./foot";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let current: Contract = CONTRACTS[0];

const cap = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const inputs = (): Record<string, string> => Object.fromEntries(current.fields.map((f) => {
  const el = $<HTMLInputElement>("f-" + f.key);
  return [f.key, f.bool ? String(el.checked) : el.value.trim()];
}));
function fill(values: Record<string, string>): void {
  for (const f of current.fields) {
    const el = $<HTMLInputElement>("f-" + f.key);
    if (f.bool) el.checked = values[f.key] === "true"; else el.value = values[f.key];
  }
}

function describeCoin(text: string): string | undefined {
  const m = /^(\w+) \{ (\w+) = (\d+) \}$/.exec(text);
  if (!m) return undefined;
  if (m[2] === "units") return `${m[3]} units of ${m[1].toLowerCase()}`;
  return m[2] === "amount" ? `${m[3]} ${m[1] === "Token" ? "tokens" : m[1].toLowerCase()}` : `the ${m[1].toLowerCase()}`;
}

function run(): void {
  const o = runPhil(current.source, inputs());
  const box = $("result");
  if (!o.ok) {
    box.innerHTML = `<div class="verdict bad"><b>${esc(KIND_TITLE[o.kind] ?? o.kind)}</b>${esc(o.message)}<div class="muted">The program stopped. In Phil a broken promise halts everything rather than leaving things half done.</div></div>`;
    return;
  }
  const lines = o.result!.trace.flatMap((e) => e.kind === "console" ? [`<li><span class="who">${esc(cap(e.proc))}</span> ${esc(e.text)}</li>`] : []);
  const moves = o.result!.trace.flatMap((e) => {
    if (e.kind !== "message") return [];
    const coin = describeCoin(e.text);
    return coin ? [`<li><span>${esc(cap(e.from))} hands ${esc(cap(e.to))} <span class="coin">${esc(coin)}</span></span></li>`] : [];
  });
  box.innerHTML = `<div class="verdict good"><b>Ran to completion</b><ul>${lines.join("")}</ul></div>`
    + (moves.length ? `<p class="moves-h">Every coin that moved</p><ol class="moves">${moves.slice(0, 60).join("")}</ol>` : "");
}

function hunt(): void {
  const out = $("hunt-out"), btn = $("hunt");
  out.textContent = "Searching: trying boundary amounts and different schedules. This takes a few seconds…";
  btn.classList.add("busy"); btn.textContent = "Searching…";
  landed(out, null, "");
  setTimeout(() => {
    try {
      const h = explore(buildAst(current.source), inputs(), { budgetMs: 2500 });
      out.innerHTML = h.findings.length
        ? `<b>Found ${h.findings.length} failure${h.findings.length === 1 ? "" : "s"} in ${h.runs} runs.</b> ${esc(h.findings[0].message)} (${esc(h.findings[0].inputs.map((i) => `${i.name} = ${i.text}`).join(", "))})`
        : `<b>${h.runs} runs, no failure found.</b> No run lost a coin, copied one, broke a promise or got stuck. This is a bounded search, not a proof.`;
    } catch (e) { out.textContent = "The search could not run: " + String((e as Error).message ?? e); }
    btn.classList.remove("busy"); btn.textContent = "Try to break it";
    landed(out, null, "");
  }, 60);
}

function show(id: string): void {
  current = CONTRACTS.find((c) => c.id === id) ?? CONTRACTS[0];
  $("picker").innerHTML = CONTRACTS.map((c) => `<button type="button" data-id="${c.id}" aria-pressed="${c === current}">${esc(c.title)}</button>`).join("");
  $("c-title").textContent = current.title;
  $("c-summary").textContent = current.summary;
  $("c-holds").innerHTML = current.guarantees.map((g) => `<li>${esc(g)}</li>`).join("");
  const basis = $("c-basis");
  basis.hidden = !current.basis;
  basis.innerHTML = current.basis ? `${esc(current.basis.note)} Source: <a href="${esc(current.basis.url)}" rel="noopener">${esc(current.basis.label)}</a>.` : "";
  $("port-box").hidden = !current.port?.length;
  $("c-port").innerHTML = (current.port ?? []).map((g) => `<li>${esc(g)}</li>`).join("");
  $("terms").innerHTML = current.fields.map((f) => f.bool
    ? `<label class="bool"><input type="checkbox" id="f-${f.key}"><span>${esc(f.label)}</span></label>`
    : `<label><span>${esc(f.label)}</span><input type="text" id="f-${f.key}" inputmode="numeric" autocomplete="off"><small>${esc(f.note ?? "")}</small></label>`).join("")
    + `<div class="presets"><span>Try</span>${current.scenarios.map((s, i) => `<button type="button" data-scenario="${i}">${esc(s.name)}</button>`).join("")}</div>`;
  fill(current.scenarios[0].inputs);
  $("src").innerHTML = highlightHtml(current.source);
  $<HTMLAnchorElement>("pg-link").href = "../playground/#" + current.id;
  const gh = $<HTMLAnchorElement>("gh-link");
  gh.textContent = current.file;
  gh.href = gh.href.replace(/\/blob\/.*$/, "").replace(/\/$/, "") + "/blob/main/" + current.file;
  $("hunt-out").textContent = "";
  $("ran").textContent = "";
  run();
}

$("picker").addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")?.dataset.id;
  if (id) { try { history.replaceState(null, "", "#" + id); } catch { /* sandboxed */ } show(id); }
});
$("terms").addEventListener("click", (e) => {
  const i = (e.target as HTMLElement).closest<HTMLElement>("[data-scenario]")?.dataset.scenario;
  if (i !== undefined) { fill(current.scenarios[+i].inputs); run(); landed($("result"), $("ran"), `Ran “${current.scenarios[+i].name}”`); }
});
$("run").addEventListener("click", () => { run(); landed($("result"), $("ran"), runLabel()); });
$("hunt").addEventListener("click", hunt);
window.addEventListener("hashchange", () => show(location.hash.slice(1)));
show(location.hash.slice(1));
wireFooter();
