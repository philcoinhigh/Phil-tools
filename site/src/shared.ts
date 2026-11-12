// Shared by the Learn and OTC pages: highlighting, a small editor, running a program.
import { lex } from "../../core/src/lexer";
import { parse } from "../../core/src/parser";
import { buildProgram, readEarlierSyntax } from "../../core/src/sim/earlier";
import { run, RunResult } from "../../core/src/sim/interp";
import kwcats from "../../playground/src/kwcats.json";

const KW = kwcats as Record<string, string>;
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export const CONTRACT = "Ea5dBrJZN58yV1nm1Q4DybJNYKeTvwpb2GEkXyW64bUH";

export function highlightHtml(src: string, mark?: [number, number]): string {
  const { tokens, comments } = lex(src);
  const marks: { start: number; end: number; cls: string }[] = [];
  for (const t of tokens) {
    if (t.kind === "eof") continue;
    let cls = "";
    if (t.kind === "kw") cls = "k-" + (KW[t.text] ?? "decl");
    else if (t.kind === "uint" || t.kind === "sint") cls = "k-type";
    else if (t.kind === "int" || t.kind === "float") cls = "num";
    else if (t.kind === "string" || t.kind === "char") cls = "str";
    else if (t.kind === "ident") cls = /^\p{Lu}/u.test(t.text) ? "tname" : "ident";
    else cls = "op";
    marks.push({ start: t.start, end: t.end, cls });
  }
  for (const c of comments) marks.push({ start: c.start, end: c.end, cls: "cmt" });
  marks.sort((a, b) => a.start - b.start);
  let out = "", at = 0;
  const piece = (from: number, to: number, cls: string) => {
    if (to <= from) return;
    const bad = mark && from < mark[1] && to > mark[0];
    const text = esc(src.slice(from, to));
    out += cls || bad ? `<span class="${cls}${bad ? " errmark" : ""}">${text}</span>` : text;
  };
  for (const m of marks) {
    if (m.start < at) continue;
    piece(at, m.start, "");
    piece(m.start, m.end, m.cls);
    at = m.end;
  }
  piece(at, src.length, "");
  return out + "\n";
}

export interface Outcome {
  ok: boolean;
  kind: string;            // "ok", "syntax", or the simulator's error kind
  message: string;
  hint?: string;
  line?: number;
  span?: [number, number];
  console: string[];
  returns: { proc: string; text: string }[];
  messages: number;
  result?: RunResult;
}

export function runPhil(src: string, inputs: Record<string, string> = {}): Outcome {
  const base = { console: [] as string[], returns: [] as { proc: string; text: string }[], messages: 0 };
  const lineOf = (o: number) => src.slice(0, o).split("\n").length;
  const syn = readEarlierSyntax(src) !== undefined ? [] : parse(src, { syntax: "grammar-v1" }).diagnostics.filter((d) => d.severity === "error");
  if (syn.length) return { ...base, ok: false, kind: "syntax", message: syn[0].message, line: lineOf(syn[0].start), span: [syn[0].start, Math.max(syn[0].end, syn[0].start + 1)] };
  let r: RunResult;
  try { r = run(buildProgram(src), inputs, { stepLimit: 40_000 }); }
  catch (e) { return { ...base, ok: false, kind: "runtime", message: String((e as Error).message ?? e) }; }
  for (const t of r.trace) {
    if (t.kind === "console") base.console.push(t.text);
    else if (t.kind === "return") base.returns.push({ proc: t.proc, text: t.text });
    else if (t.kind === "message") base.messages++;
  }
  if (r.ok) return { ...base, ok: true, kind: "ok", message: "Ran to completion", result: r };
  const e = r.error!;
  return { ...base, ok: false, kind: e.kind, message: e.message, hint: e.hint, line: e.span ? lineOf(e.span[0]) : undefined, span: e.span, result: r };
}

export const KIND_TITLE: Record<string, string> = {
  syntax: "Phil can't read this yet",
  linearity: "Ownership error",
  contract: "A promise was broken",
  protocol: "Protocol error",
  arithmetic: "Arithmetic error",
  deadlock: "Deadlock: nobody can move",
  wiring: "Wiring error",
  runtime: "Stopped",
  unsupported: "Not supported by the simulator",
  limit: "Step limit reached",
};

export interface Editor { value: string; set(v: string): void; mark(span?: [number, number]): void }

/** A small code editor that grows with its content, so the page (not the box) scrolls. */
export function mountEditor(host: HTMLElement, initial: string, onChange: () => void): Editor {
  host.classList.add("ed");
  host.innerHTML = `<div class="ed-in"><pre aria-hidden="true"></pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="Phil code"></textarea></div>`;
  const pre = host.querySelector("pre")!;
  const ta = host.querySelector("textarea")!;
  let span: [number, number] | undefined;
  const paint = () => { pre.innerHTML = highlightHtml(ta.value, span); };
  ta.value = initial;
  paint();
  ta.addEventListener("input", () => { span = undefined; paint(); onChange(); });
  ta.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const s = ta.selectionStart, v = ta.value;
    ta.value = v.slice(0, s) + "  " + v.slice(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = s + 2;
    span = undefined; paint(); onChange();
  });
  return {
    get value() { return ta.value; },
    set(v: string) { ta.value = v; span = undefined; paint(); },
    mark(s?: [number, number]) { span = s; paint(); },
  };
}

/** Makes it obvious that a button did something: a short highlight, a note beside the button, and the result brought into view. */
export function landed(result: HTMLElement, note: HTMLElement | null, text: string): void {
  result.classList.remove("flash");
  void result.offsetWidth;                       // restart the animation
  result.classList.add("flash");
  if (note) note.textContent = text;
  const r = result.getBoundingClientRect();
  const vh = window.innerHeight || 0;
  if (vh && (r.top > vh - 80 || r.top < 0) && typeof result.scrollIntoView === "function") result.scrollIntoView({ block: "center", behavior: "smooth" });
}
let runs = 0;
export const runLabel = () => `Ran just now (run ${++runs})`;

export function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
  return null;
}
