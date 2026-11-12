// Phil Playground: browser UI around the extension's checker and the experimental simulator.
import { lex } from "../../core/src/lexer";
import { parse, ParseDiagnostic } from "../../core/src/parser";
import { formatText } from "../../core/src/format";
import { buildAst } from "../../core/src/sim/ast";
import { buildProgram, readEarlierSyntax } from "../../core/src/sim/earlier";
import { run, Simulator, RunResult, RunOptions, TraceEvent, HOST_OPERATIONS } from "../../core/src/sim/interp";
import { explore, ExploreResult } from "../../core/src/sim/explore";
import { generateProtocol, Step, STEP_TYPES } from "../../core/src/sim/designer";
import { RESERVED } from "../../core/src/lexer";
import { protocolViews, architectureView, protocolPositions } from "../../core/src/sim/inspect";
import { EXAMPLES, Example } from "../../core/src/sim/examples";
import { CODES, CODE_MAP } from "../../core/src/codes";
import { loadPhilc, runPhilc, readPhilcError, PHILC_TARGETS, PHILC_SAMPLE, PhilcBuild } from "./philc";
import kwcats from "./kwcats.json";
import keywordDocs from "../../core/src/keywords.json";

const KW = kwcats as Record<string, string>;
const KWDOCS = keywordDocs as Record<string, { category: string; meaning: string }>;
const CONTRACT = "Ea5dBrJZN58yV1nm1Q4DybJNYKeTvwpb2GEkXyW64bUH";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mobile = () => window.matchMedia("(max-width: 860px)").matches;

const editor = $<HTMLTextAreaElement>("code");
const overlay = $<HTMLPreElement>("highlight");
const gutter = $<HTMLDivElement>("gutter");
const exampleSelect = $<HTMLSelectElement>("example");
const inputsBox = $<HTMLDivElement>("inputs");
const summary = $<HTMLDivElement>("summary");
const problemsCount = $<HTMLSpanElement>("problems-count");

const SCRATCH: Example = {
  id: "scratch", title: "Scratch pad", group: "Basics", expect: "ok",
  blurb: "Your own code. It is kept in this browser; Open file loads a .phil file here.",
  code: `// Write Phil here. Ctrl/⌘ + Enter runs it.
component main provides U32 {
  let x = convert 1 to U32;
  return x + 1;
}
`,
};
const GOALS: Record<string, string> = {
  doublespend: "Return the coin's amount without spending the coin twice.",
  lostcoin: "Finish without losing the coin.",
  overspend: "Make the payment without breaking the Split contract.",
  overflow: "Return a result that fits in a U8.",
  earlyclose: "Follow the protocol so both sides finish.",
  reuse: "Send both bytes.",
  deadlock: "Change the protocol so the two sides can talk.",
};
const PUZZLES: Example[] = EXAMPLES.filter((e) => GOALS[e.id]).map((e) => ({ ...e, id: "fix-" + e.id, blurb: "Puzzle: " + GOALS[e.id] + " Solved when it runs and a hunt finds nothing." }));
const ALL: Example[] = [...EXAMPLES, ...PUZZLES, SCRATCH];
const TRY: Record<string, string> = {
  hello: "Change 40 to 4294967295 and run again.",
  "repo-stage2": "Open the Structure tab to see how the two programs are wired together.",
  "repo-stage4": "Look at ServerLoop: it receives without an explicit offer, and the simulator follows Phil in allowing that.",
  loop: "Set n to 0 and run: the type of n rejects it. Then press Hunt bugs to find the input that overflows.",
  contract: "Set fee higher than amount and run.",
  ping: "Step through the run with the arrows above the diagram.",
  pingpong: "Set rounds to 0, then to 5.",
  token: "Set price to 150 and run. Then press Hunt bugs to see every way this program can fail.",
  scratch: "Write anything. Design can generate a starting program for you.",
};
const EXPLAIN: Record<string, string> = {
  linearity: "A value that must be used exactly once was used twice, or never used.",
  contract: "A promise written in the code turned out to be false.",
  protocol: "A program did something its conversation script does not allow at this point.",
  arithmetic: "A number went outside the range of its type. Phil never wraps numbers around.",
  deadlock: "Every program is waiting for another one, so nothing can happen.",
  wiring: "The architecture does not connect the parts correctly.",
  limit: "This program has no end, either by design or by mistake. The simulator stopped it; everything up to that point is shown below.",
  unsupported: "This is valid Phil that the simulator cannot run yet.",
};
const solved = new Set<string>();
try { for (const id of JSON.parse(localStorage.getItem("phil-playground-solved") ?? "[]")) solved.add(id); } catch { /* storage unavailable */ }
let runOpts: RunOptions = {};

let current: Example = ALL.find((e) => e.id === "token")!;
let syntaxDiags: ParseDiagnostic[] = [];
let runtimeSpan: [number, number] | undefined;
let nowSpan: [number, number] | undefined;
const inputValues: Record<string, string> = {};
let lastResult: RunResult | undefined;
let seqEvents: TraceEvent[] = [];
let replayIdx = -1;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const md = (s: string) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

function toast(text: string): void {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout((t as unknown as { _h?: number })._h);
  (t as unknown as { _h?: number })._h = window.setTimeout(() => t.classList.remove("show"), 1600);
}

// ------------------------------------------------------------------ editing primitives

/** Replace a range with text, keeping the browser's undo stack where possible. */
function replaceRange(start: number, end: number, text: string, caret?: number): void {
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(start, end);
  let ok = false;
  try { ok = document.execCommand("insertText", false, text); } catch { ok = false; }
  if (!ok || editor.value.slice(start, start + text.length) !== text) {
    editor.setRangeText(text, start, end, "end");
  }
  if (caret !== undefined) editor.setSelectionRange(caret, caret);
  onEdit();
}
function insertAtCaret(text: string, caretOffset = text.length): void {
  const s = editor.selectionStart;
  replaceRange(s, editor.selectionEnd, text, s + caretOffset);
}
function lineStartOf(offset: number): number { return editor.value.lastIndexOf("\n", offset - 1) + 1; }

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"' };
const CLOSERS = new Set([")", "]", "}", '"']);

editor.addEventListener("keydown", (e) => {
  const v = editor.value, s = editor.selectionStart, en = editor.selectionEnd;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "Enter") { e.preventDefault(); doRun(); return; }
  if (mod && e.key === "/") { e.preventDefault(); toggleComment(); return; }
  if (e.shiftKey && e.altKey && (e.key === "F" || e.key === "f")) { e.preventDefault(); doFormat(); return; }
  if (e.key === "Tab") {
    e.preventDefault();
    if (e.shiftKey || v.slice(s, en).includes("\n")) indentLines(e.shiftKey ? -1 : 1);
    else insertAtCaret("  ");
    return;
  }
  if (e.key === "Enter" && !mod) {
    const line = v.slice(lineStartOf(s), s);
    let indent = line.match(/^\s*/)![0];
    const opens = /[{(\[]\s*$/.test(line);
    if (opens || /=>\s*$/.test(line)) indent += "  ";
    e.preventDefault();
    const closer = v[en];
    if (opens && closer && PAIRS[line.trimEnd().slice(-1)] === closer) {
      const back = indent.slice(2);
      replaceRange(s, en, "\n" + indent + "\n" + back, s + 1 + indent.length);
    } else insertAtCaret("\n" + indent);
    return;
  }
  if (e.key === "Backspace" && s === en && s > 0 && PAIRS[v[s - 1]] && PAIRS[v[s - 1]] === v[s]) {
    e.preventDefault();
    replaceRange(s - 1, s + 1, "", s - 1);
    return;
  }
  if (e.key.length === 1 && !mod) {
    if (CLOSERS.has(e.key) && s === en && v[s] === e.key) {
      e.preventDefault();
      editor.setSelectionRange(s + 1, s + 1);
      updateCaret();
      return;
    }
    if (e.key === "}") {
      const line = v.slice(lineStartOf(s), s);
      if (/^\s+$/.test(line) && line.length >= 2) { e.preventDefault(); replaceRange(s - 2, s, "}", s - 1); return; }
    }
    if (PAIRS[e.key] && (s !== en || /^($|[\s)\]};,])/.test(v.slice(s, s + 1)))) {
      if (e.key === '"' && /[\p{L}\p{N}_"]/u.test(v[s - 1] ?? "")) return;
      e.preventDefault();
      const inner = v.slice(s, en);
      replaceRange(s, en, e.key + inner + PAIRS[e.key], s + 1 + inner.length);
    }
  }
});

function indentLines(dir: 1 | -1): void {
  const v = editor.value;
  const a = lineStartOf(editor.selectionStart);
  let b = editor.selectionEnd;
  if (b > a && v[b - 1] === "\n") b--;
  const endLine = v.indexOf("\n", b);
  const block = v.slice(a, endLine < 0 ? v.length : endLine);
  const lines = block.split("\n").map((l) => (dir > 0 ? (l.length ? "  " + l : l) : l.replace(/^ {1,2}/, "")));
  const text = lines.join("\n");
  replaceRange(a, a + block.length, text);
  editor.setSelectionRange(a, a + text.length);
}

function toggleComment(): void {
  const v = editor.value;
  const a = lineStartOf(editor.selectionStart);
  let b = editor.selectionEnd;
  if (b > a && v[b - 1] === "\n") b--;
  const endLine = v.indexOf("\n", b);
  const block = v.slice(a, endLine < 0 ? v.length : endLine);
  const lines = block.split("\n");
  const code = lines.filter((l) => l.trim());
  const allCommented = code.length > 0 && code.every((l) => /^\s*\/\//.test(l));
  const minIndent = Math.min(...code.map((l) => l.match(/^\s*/)![0].length), 1e9);
  const out = lines.map((l) => {
    if (!l.trim()) return l;
    return allCommented ? l.replace(/^(\s*)\/\/ ?/, "$1") : l.slice(0, minIndent) + "// " + l.slice(minIndent);
  }).join("\n");
  replaceRange(a, a + block.length, out);
  editor.setSelectionRange(a, a + out.length);
}

function doFormat(): void {
  const before = editor.value;
  const after = formatText(before, { tabSize: 2, insertSpaces: true });
  if (after === before) { toast("Already formatted"); return; }
  const caretLine = before.slice(0, editor.selectionStart).split("\n").length;
  replaceRange(0, before.length, after);
  const lines = after.split("\n");
  const pos = lines.slice(0, caretLine - 1).join("\n").length + (caretLine > 1 ? 1 : 0) + (lines[caretLine - 1]?.match(/^\s*/)![0].length ?? 0);
  editor.setSelectionRange(pos, pos);
  updateCaret();
  toast("Formatted");
}

// ------------------------------------------------------------------ rendering the editor

function bracketPair(src: string, caret: number): [number, number] | undefined {
  const open = "([{", close = ")]}";
  for (const at of [caret - 1, caret]) {
    const c = src[at];
    if (!c) continue;
    const oi = open.indexOf(c), ci = close.indexOf(c);
    if (oi < 0 && ci < 0) continue;
    const { tokens } = lex(src);
    const syms = tokens.filter((t) => t.kind === "sym" && (open.includes(t.text) || close.includes(t.text)));
    const idx = syms.findIndex((t) => t.start === at);
    if (idx < 0) continue;
    let depth = 0;
    if (oi >= 0) {
      for (let i = idx; i < syms.length; i++) {
        if (open.includes(syms[i].text)) depth++; else depth--;
        if (depth === 0) return [at, syms[i].start];
      }
    } else {
      for (let i = idx; i >= 0; i--) {
        if (close.includes(syms[i].text)) depth++; else depth--;
        if (depth === 0) return [syms[i].start, at];
      }
    }
  }
  return undefined;
}

function highlight(): void {
  const src = editor.value;
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
    else if (t.kind === "sym") cls = /^[{}()[\]]$/.test(t.text) ? "punct" : "op";
    marks.push({ start: t.start, end: t.end, cls });
  }
  for (const c of comments) marks.push({ start: c.start, end: c.end, cls: "cmt" });
  marks.sort((a, b) => a.start - b.start);

  const errRanges = syntaxDiags.map((d) => [d.start, Math.max(d.end, d.start)] as [number, number]);
  const zeroWidth = new Set(errRanges.filter(([s, e]) => s === e).map(([s]) => s));
  const inSyntaxErr = (a: number, b: number) => errRanges.some(([s, e]) => e > s && a < e && b > s);
  const inRuntime = (a: number, b: number) => !!runtimeSpan && a < runtimeSpan[1] && b > runtimeSpan[0];
  const brackets = document.activeElement === editor ? bracketPair(src, editor.selectionStart) : undefined;

  let html = "";
  let pos = 0;
  const gap = (to: number) => {
    for (let i = pos; i < to; i++) {
      if (zeroWidth.has(i)) html += '<span class="caret-err"></span>';
      html += esc(src[i]);
    }
  };
  for (const m of marks) {
    if (m.start < pos) continue;
    gap(m.start);
    if (zeroWidth.has(m.start)) html += '<span class="caret-err"></span>';
    let cls = m.cls;
    if (inRuntime(m.start, m.end)) cls += " rt-err";
    else if (inSyntaxErr(m.start, m.end)) cls += " err";
    if (brackets && (m.start === brackets[0] || m.start === brackets[1])) cls += " bracket-match";
    html += `<span class="${cls}">${esc(src.slice(m.start, m.end))}</span>`;
    pos = m.end;
  }
  gap(src.length);
  if (zeroWidth.has(src.length)) html += '<span class="caret-err"></span>';

  const lineOf = (off: number) => src.slice(0, off).split("\n").length;
  const caretLine = lineOf(editor.selectionStart);
  const nowLine = nowSpan ? lineOf(nowSpan[0]) : -1;
  const errLines = new Set([...errRanges.map(([s]) => lineOf(s)), ...(runtimeSpan ? [lineOf(runtimeSpan[0])] : [])]);
  const lines = html.split("\n");
  overlay.innerHTML = lines.map((l, i) => {
    const n = i + 1;
    const cls = n === nowLine ? "ln now" : n === caretLine && document.activeElement === editor ? "ln cur" : "ln";
    return `<div class="${cls}">${l || " "}</div>`;
  }).join("");
  gutter.innerHTML = lines.map((_, i) => {
    const n = i + 1;
    return `<div class="${errLines.has(n) ? "bad" : n === caretLine ? "cur" : ""}">${n}</div>`;
  }).join("");
  syncScroll();
}

function syncScroll(): void {
  overlay.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
  gutter.style.transform = `translateY(${-editor.scrollTop}px)`;
}
editor.addEventListener("scroll", syncScroll);

let caretTimer: number | undefined;
function updateCaret(): void {
  const v = editor.value, s = editor.selectionStart;
  const before = v.slice(0, s).split("\n");
  $("caret").textContent = `Ln ${before.length}, Col ${before[before.length - 1].length + 1}`;
  // Word under the caret: keyword meaning, integer type, or error explanation.
  let info = "";
  const diag = syntaxDiags.find((d) => s >= d.start && s <= Math.max(d.end, d.start + 1));
  if (diag) info = `<span class="no">${diag.code}</span> ${md(diag.message)}`;
  else {
    const left = v.slice(0, s).match(/[\p{L}\p{N}_']*$/u)![0];
    const right = v.slice(s).match(/^[\p{L}\p{N}_']*/u)![0];
    const word = left + right;
    if (KWDOCS[word]) info = `<span class="kw">${esc(word)}</span> ${md(KWDOCS[word].meaning)}`;
    else if (/^[UI]\d+$/.test(word)) info = `<span class="kw">${word}</span> ${word[0] === "U" ? "unsigned" : "signed"} ${word.slice(1)}-bit integer; never wraps`;
    else if (HOST_OPERATIONS[word]) info = `<span class="kw">${esc(word)}</span> simulator host operation: ${esc(HOST_OPERATIONS[word].split(" — ")[1] ?? "")}`;
  }
  $("caret-info").innerHTML = info;
  clearTimeout(caretTimer);
  caretTimer = window.setTimeout(highlight, 30);
}
editor.addEventListener("keyup", updateCaret);
editor.addEventListener("click", updateCaret);
editor.addEventListener("focus", updateCaret);
editor.addEventListener("blur", () => window.setTimeout(highlight, 50));
document.addEventListener("selectionchange", () => { if (document.activeElement === editor) updateCaret(); });

let checkTimer: number | undefined;
let editing = false;
editor.addEventListener("input", () => { if (!editing) onEdit(); });
function onEdit(): void {
  editing = true;
  runOpts = {};
  runtimeSpan = undefined;
  nowSpan = undefined;
  clearTimeout(checkTimer);
  checkTimer = window.setTimeout(() => { checkSyntax(); highlight(); updateCaret(); saveDraft(); }, 140);
  highlight();
  editing = false;
}

let earlierSyntax = false;
function checkSyntax(): void {
  // Simple programs in Phil's earlier syntax (no semicolons) are read as they are.
  earlierSyntax = readEarlierSyntax(editor.value) !== undefined;
  const r = parse(editor.value, { syntax: "grammar-v1" });
  syntaxDiags = earlierSyntax ? [] : r.diagnostics.filter((d) => d.severity === "error" || d.severity === "warning");
  const errors = syntaxDiags.filter((d) => d.severity === "error").length;
  $("syntax-status").innerHTML = errors
    ? `<span class="no">${errors} syntax error${errors > 1 ? "s" : ""}</span>`
    : `<span class="ok">${earlierSyntax ? "earlier syntax OK" : "syntax OK"}</span>`;
  renderProblems();
  refreshInputs();
  renderStructure();
}

// ------------------------------------------------------------------ symbol keys (touch)

const KEYS: [string, string, number?][] = [
  ["⇥", "  "], ["{", "{}", 1], ["}", "}"], ["(", "()", 1], [")", ")"], [";", ";"], [":", " : "], ["=>", " => "],
  ["=", " = "], ["[", "[]", 1], ["]", "]"], ["|", " | "], [".", "."], ['"', '""', 1], ["_", "_"], ["<", " <= "],
];
$("keys").innerHTML = KEYS.map(([label], i) => `<button type="button" data-k="${i}" aria-label="Insert ${esc(label)}">${esc(label)}</button>`).join("");
$("keys").querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
  b.addEventListener("pointerdown", (e) => e.preventDefault()); // keep the keyboard open
  b.addEventListener("click", () => {
    const [, text, caret] = KEYS[+b.dataset.k!];
    insertAtCaret(text, caret ?? text.length);
  });
});

// ------------------------------------------------------------------ inputs

function refreshInputs(): void {
  if (syntaxDiags.some((d) => d.severity === "error")) return;
  let entries: { name: string; typeText: string }[] = [];
  try { entries = new Simulator(buildProgram(editor.value)).entries(); } catch { entries = []; }
  const existing = [...inputsBox.querySelectorAll("input")].map((i) => i.id).join(",");
  const wanted = entries.map((e) => "in-" + e.name).join(",");
  if (existing === wanted && entries.length) return;
  inputsBox.innerHTML = "";
  inputsBox.hidden = entries.length === 0;
  if (!entries.length) return;
  const label = document.createElement("span");
  label.className = "inputs-label";
  label.textContent = "Entries";
  inputsBox.appendChild(label);
  for (const en of entries) {
    const wrap = document.createElement("label");
    wrap.className = "entry";
    wrap.htmlFor = "in-" + en.name;
    const input = document.createElement("input");
    input.id = "in-" + en.name;
    input.value = inputValues[en.name] ?? current.inputs?.[en.name] ?? (en.typeText === "Bool" ? "true" : en.typeText === "String" ? "hello" : "1");
    inputValues[en.name] = input.value;
    const numeric = /^([UI]\d+|\{)/.test(en.typeText);
    input.inputMode = numeric ? (en.typeText.startsWith("I") ? "text" : "numeric") : "text";
    input.enterKeyHint = "go";
    input.spellcheck = false;
    input.autocomplete = "off";
    const validate = () => {
      const bad = numeric ? !/^-?\d+$/.test(input.value.trim()) : en.typeText === "Bool" ? !/^(true|false)$/.test(input.value.trim()) : false;
      input.setAttribute("aria-invalid", String(bad));
    };
    input.addEventListener("input", () => { inputValues[en.name] = input.value; validate(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doRun(); } });
    validate();
    wrap.innerHTML = `<span class="entry-name">${esc(en.name)}</span><span class="entry-type">: ${esc(en.typeText)}</span>`;
    wrap.appendChild(input);
    inputsBox.appendChild(wrap);
  }
}

// ------------------------------------------------------------------ problems

function lineCol(offset: number): string {
  const before = editor.value.slice(0, offset).split("\n");
  return `${before.length}:${before[before.length - 1].length + 1}`;
}

function renderProblems(): void {
  const list = $("problems");
  problemsCount.textContent = syntaxDiags.length ? ` ${syntaxDiags.length}` : "";
  problemsCount.hidden = syntaxDiags.length === 0;
  if (!syntaxDiags.length) {
    list.innerHTML = `<p class="empty">No syntax problems. The file is valid Phil Grammar v1.</p>`;
    return;
  }
  list.innerHTML = syntaxDiags.map((d, i) => {
    const info = CODE_MAP.get(d.code);
    return `<div class="problem ${d.severity}">
      <div class="problem-head"><button class="loc" data-off="${d.start}" type="button">${lineCol(d.start)}</button><span class="code-chip">${d.code}</span>${info ? `<span>${esc(info.title)}</span>` : ""}</div>
      <div>${md(d.message)}</div>
      ${d.fix ? `<button class="fix" data-fix="${i}" type="button">${md(d.fix.title)}</button>` : ""}
    </div>`;
  }).join("");
  list.querySelectorAll<HTMLButtonElement>("button.loc").forEach((b) => b.addEventListener("click", () => revealOffset(+b.dataset.off!, true)));
  list.querySelectorAll<HTMLButtonElement>("button.fix").forEach((b) => b.addEventListener("click", () => {
    const d = syntaxDiags[+b.dataset.fix!];
    if (!d?.fix) return;
    replaceRange(d.fix.start, d.fix.end, d.fix.newText);
    checkSyntax();
    highlight();
    saveDraft();
    toast("Fixed");
  }));
}

function revealOffset(offset: number, switchToCode = false): void {
  if (switchToCode && mobile()) setView("code");
  const line = editor.value.slice(0, offset).split("\n").length;
  const lh = parseFloat(getComputedStyle(editor).lineHeight) || 20;
  editor.scrollTop = Math.max(0, (line - 4) * lh);
  syncScroll();
  if (!mobile()) $("editor-wrap").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ------------------------------------------------------------------ running

const KIND_LABEL: Record<string, string> = {
  linearity: "Ownership error", contract: "Contract violated", protocol: "Protocol violation", arithmetic: "Arithmetic trap",
  deadlock: "Deadlock", wiring: "Wiring problem", runtime: "Runtime error", unsupported: "Not supported yet", limit: "Stopped while still running",
};

function doRun(): void {
  try {
    runProgram();
  } catch (err) {
    summary.innerHTML = `<div class="verdict bad">Internal error</div><div class="headline">The playground hit a bug while running this program.</div><div class="hint">${esc(String((err as Error)?.message ?? err))}</div>`;
  }
  if (mobile()) setView("results");
}

function runProgram(): void {
  checkSyntax();
  runtimeSpan = undefined;
  nowSpan = undefined;
  const errs = syntaxDiags.filter((d) => d.severity === "error");
  if (errs.length) {
    const earlier = parse(editor.value, { syntax: "auto" }).legacy;
    summary.innerHTML = earlier
      ? `<div class="verdict">Not run by the simulator <span class="where">earlier syntax</span></div>
      <div class="headline">This is Phil's earlier syntax, without semicolons.</div>
      <div class="hint">The simulator reads the newer grammar, where this would be: ${md(errs[0].message)} (line ${lineCol(errs[0].start)}).${philcBuild ? " Phil's own compiler still reads this form: open the Phil's compiler tab." : ""}</div>`
      : `<div class="verdict bad">Not run <span class="where">${errs.length} syntax error${errs.length > 1 ? "s" : ""}</span></div>
      <div class="headline">${md(errs[0].message)}</div>
      <div class="hint">Line ${lineCol(errs[0].start)}. Fix it in the editor or from the Problems tab, then run again.</div>`;
    lastResult = undefined;
    seqEvents = [];
    $("replay").hidden = true;
    $("rp-label").textContent = "";
    $("sequence").innerHTML = `<p class="empty">Nothing ran.</p>`;
    showTab("problems");
    highlight();
    return;
  }
  const t0 = performance.now();
  const result = run(buildProgram(editor.value), inputValues, { stepLimit: 40_000, ...runOpts });
  const ms = performance.now() - t0;
  lastResult = result;
  runtimeSpan = result.error?.span && result.error.span[1] > result.error.span[0] ? result.error.span : undefined;
  seqEvents = result.trace.filter((t) => t.kind !== "check" && t.kind !== "start" && t.kind !== "assume" && t.kind !== "own");
  stopPlay();
  replayIdx = seqEvents.length - 1;
  renderSummary(result, ms);
  renderReplay();
  renderConsole(result);
  renderTrace(result);
  highlight();
  if (runtimeSpan) revealOffset(runtimeSpan[0]);
  if (earlierSyntax) summary.insertAdjacentHTML("beforeend", `<div class="hint">Read as Phil's earlier syntax, which has no semicolons.</div>`);
  checkPuzzle(result);
  const hasMsgs = seqEvents.some((t) => t.kind === "message" || t.kind === "select");
  showTab(!result.ok || hasMsgs || !result.trace.some((t) => t.kind === "console") ? "sequence" : "console");
}
$("run").addEventListener("click", doRun);
$("run-m").addEventListener("click", doRun);

function renderSummary(r: RunResult, ms: number): void {
  const msgs = r.trace.filter((t) => t.kind === "message" || t.kind === "select").length;
  const procs = r.processes.filter((p) => !p.external).length;
  const stats = `${procs} process${procs === 1 ? "" : "es"} · ${msgs} message${msgs === 1 ? "" : "s"} · ${r.checks} contract check${r.checks === 1 ? "" : "s"} · ${r.steps.toLocaleString()} steps · ${ms < 1 ? "<1" : Math.round(ms)} ms`;
  if (r.ok) {
    const rows = r.processes.filter((p) => !p.external).map((p) => `<dt>${esc(p.name)}</dt><dd>${esc(p.status)}</dd>`).join("");
    summary.innerHTML = `<div class="verdict good">Ran to completion</div><dl class="results">${rows}</dl><div class="stats">${stats}</div>`;
  } else {
    const e = r.error!;
    const where = e.span && e.span[1] > 0 ? `<button class="loc" type="button" data-off="${e.span[0]}">line ${lineCol(e.span[0])}</button>` : "";
    summary.innerHTML = `<div class="verdict ${e.kind === "limit" ? "warn" : "bad"}">${KIND_LABEL[e.kind] ?? "Error"}<span class="where">${e.process ? esc(e.process) : ""}${e.process && where ? " · " : ""}${where}</span></div>
      ${EXPLAIN[e.kind] ? `<div class="explain">${EXPLAIN[e.kind]}</div>` : ""}
      <div class="headline">${md(e.message)}</div>
      ${e.hint ? `<div class="hint">${md(e.hint)}</div>` : ""}
      <div class="stats">${stats}</div>`;
    summary.querySelector<HTMLButtonElement>("button.loc")?.addEventListener("click", (ev) => revealOffset(+(ev.currentTarget as HTMLButtonElement).dataset.off!, true));
  }
}

function renderConsole(r: RunResult): void {
  const lines = r.trace.filter((t): t is Extract<TraceEvent, { kind: "console" }> => t.kind === "console");
  $("console-count").hidden = lines.length === 0;
  $("console-count").textContent = lines.length ? ` ${lines.length}` : "";
  $("console").innerHTML = lines.length
    ? lines.map((l) => `<div class="console-line"><span class="console-proc">${esc(l.proc)}</span>${esc(l.text)}</div>`).join("")
    : `<p class="empty">No console output. Call <code>console_write(...)</code> to print.</p>`;
}

function describeEvent(t: TraceEvent): string {
  switch (t.kind) {
    case "start": return `<b>${esc(t.proc)}</b> starts (${esc(t.detail)})`;
    case "message": return `<b>${esc(t.from)}</b> sends <code>${esc(t.text)}</code> to <b>${esc(t.to)}</b> on ${esc(t.session)}`;
    case "select": return `<b>${esc(t.from)}</b> selects <code>${esc(t.text)}</code>; <b>${esc(t.to)}</b> takes that branch`;
    case "close": return `<b>${esc(t.proc)}</b> closes ${esc(t.session)}.${esc(t.role)}`;
    case "console": return `<b>${esc(t.proc)}</b> prints “${esc(t.text)}”`;
    case "check": return `<span class="muted">${esc(t.what)}</span> <code>${esc(t.text)}</code>`;
    case "assume": return esc(t.text);
    case "return": return `<b>${esc(t.proc)}</b> finishes${t.text ? ` with <code>${esc(t.text)}</code>` : ""}`;
    case "reject": return `<b>${esc(t.proc)}</b> ends with negative outcome <code>${esc(t.text)}</code>`;
    case "fail": return `<b>${esc(t.proc)}</b> fails with <code>${esc(t.text)}</code>`;
    case "own": return t.op === "create" ? `<b>${esc(t.proc)}</b> creates <code>${esc(t.text)}</code>` : t.op === "move" ? `ownership moves from <b>${esc(t.proc)}</b> to <b>${esc(t.to ?? "")}</b>` : `<b>${esc(t.proc)}</b> consumes a value (${esc(t.text)})`;
  }
}
const ICON: Record<string, string> = { own: "◇", start: "▶", message: "→", select: "⑂", close: "■", console: "›", check: "✓", assume: "?", return: "◆", reject: "↩", fail: "✕" };

function renderTrace(r: RunResult): void {
  const showChecks = ($("show-checks") as HTMLInputElement).checked;
  const rows: string[] = [];
  for (const t of r.trace) {
    if ((t.kind === "check" || t.kind === "own") && !showChecks) continue;
    const span = "span" in t && t.span ? ` data-span="${t.span[0]}"` : "";
    rows.push(`<li class="ev ev-${t.kind}"${span}><span class="ev-icon">${ICON[t.kind]}</span><span>${describeEvent(t)}</span></li>`);
  }
  if (r.error) rows.push(`<li class="ev ev-error"${r.error.span ? ` data-span="${r.error.span[0]}"` : ""}><span class="ev-icon">!</span><span>${md(r.error.message)}</span></li>`);
  $("trace").innerHTML = rows.length ? `<ol class="events">${rows.join("")}</ol>` : `<p class="empty">Nothing happened.</p>`;
  $("trace").querySelectorAll<HTMLElement>("[data-span]").forEach((li) => li.addEventListener("click", () => {
    const off = +li.dataset.span!;
    nowSpan = [off, off + 1];
    highlight();
    revealOffset(off, true);
  }));
}
$("show-checks").addEventListener("change", () => { if (lastResult) renderTrace(lastResult); });

// ------------------------------------------------------------------ replay + sequence diagram

function renderReplay(): void {
  const range = $<HTMLInputElement>("rp-range");
  $("replay").hidden = seqEvents.length < 2;
  range.max = String(Math.max(0, seqEvents.length - 1));
  range.value = String(replayIdx);
  const t = seqEvents[replayIdx];
  $("rp-label").innerHTML = t ? `<span>${replayIdx + 1} / ${seqEvents.length}</span> · ${describeEvent(t)}` : "";
  const span = t && "span" in t ? t.span : undefined;
  nowSpan = replayIdx < seqEvents.length - 1 && span ? span : undefined;
  renderHoldings();
  renderPositions();
  if (lastResult) renderSequence(lastResult, replayIdx);
  highlight();
  if (nowSpan) revealOffset(nowSpan[0]);
}
/** Who owns which linear/affine values at the current replay step. */
function renderHoldings(): void {
  const box = $("holdings");
  const r = lastResult;
  const owns = r?.trace.filter((t): t is Extract<TraceEvent, { kind: "own" }> => t.kind === "own") ?? [];
  box.hidden = !r || owns.length === 0;
  if (!r || !owns.length) return;
  let upto = replayIdx >= seqEvents.length - 1 ? r.trace.length - 1 : r.trace.indexOf(seqEvents[replayIdx]);
  while (r.trace[upto + 1]?.kind === "own" && (r.trace[upto + 1] as Extract<TraceEvent, { kind: "own" }>).op === "move") upto++;
  const prev = replayIdx > 0 ? r.trace.indexOf(seqEvents[replayIdx - 1]) : -1;
  const held = new Map<number, { proc: string; text: string; fresh: boolean }>();
  r.trace.forEach((t, i) => {
    if (i > upto || t.kind !== "own") return;
    if (t.op === "create") held.set(t.oid, { proc: t.proc, text: t.text, fresh: i > prev });
    else if (t.op === "consume") held.delete(t.oid);
    else { const h = held.get(t.oid); if (h) { h.proc = t.to ?? h.proc; h.fresh = i > prev; } }
  });
  box.innerHTML = r.processes.filter((p) => !p.external).map((p) => {
    const mine = [...held.values()].filter((h) => h.proc === p.name);
    return `<span><span class="who">${esc(p.name)} owns</span>${mine.length ? mine.map((h) => `<span class="chip${h.fresh ? " fresh" : ""}">${esc(h.text)}</span>`).join("") : '<span class="none">nothing</span>'}</span>`;
  }).join("");
}

/** Where each role stands in its protocol at the current replay step. */
function renderPositions(): void {
  const box = $("positions");
  const r = lastResult;
  box.innerHTML = "";
  if (!r || !seqEvents.length) return;
  let upto = replayIdx >= seqEvents.length - 1 ? r.trace.length - 1 : r.trace.indexOf(seqEvents[replayIdx]);
  if (upto < 0) upto = r.trace.length - 1;
  let sessions: ReturnType<typeof protocolPositions> = [];
  try { sessions = protocolPositions(buildProgram(editor.value), r.trace, upto); } catch { return; }
  box.innerHTML = sessions.map((x) => `<div class="st-h">Where each side is in ${esc(x.session)} : ${esc(x.protocol)}</div>
    <div class="scripts">${x.roles.map((role) => `<div><h4>${esc(role.owner)} <span class="muted">as ${esc(role.role)}</span>${role.closed ? ' <span class="okmark">closed</span>' : ""}</h4>${role.lines.map((l, i) => {
      const cur = i === role.current;
      return `<div class="sl ${l.kind}${cur ? (role.closed ? " fin" : " cur") : ""}">${cur && !role.closed ? "▸ " : "  "}${"  ".repeat(l.depth)}${esc(l.text)}</div>`;
    }).join("")}</div>`).join("")}</div>`).join("");
}

let playTimer: ReturnType<typeof setInterval> | undefined;
function stopPlay(): void {
  if (playTimer !== undefined) { clearInterval(playTimer); playTimer = undefined; }
  const b = $("rp-play");
  b.textContent = "▶ Play"; b.setAttribute("aria-pressed", "false");
}
function startPlay(): void {
  if (seqEvents.length < 2) return;
  if (replayIdx >= seqEvents.length - 1) step(0);
  const b = $("rp-play");
  b.textContent = "❚❚ Pause"; b.setAttribute("aria-pressed", "true");
  const every = +$<HTMLSelectElement>("rp-speed").value || 700;
  playTimer = setInterval(() => {
    if (replayIdx >= seqEvents.length - 1) { stopPlay(); return; }
    step(replayIdx + 1);
    if (replayIdx >= seqEvents.length - 1) stopPlay();
  }, every);
}
$("rp-play").addEventListener("click", () => (playTimer !== undefined ? stopPlay() : startPlay()));
$("rp-speed").addEventListener("change", () => { if (playTimer !== undefined) { stopPlay(); startPlay(); } });

function step(to: number): void {
  if (!seqEvents.length) return;
  replayIdx = Math.max(0, Math.min(seqEvents.length - 1, to));
  renderReplay();
  // Keep the current row in view between the pinned controls and the pinned scripts.
  const row = document.querySelector<SVGElement>("#sequence .row-now");
  const box = document.querySelector<HTMLElement>(".panels");
  if (row && box && !mobile() && typeof row.getBoundingClientRect === "function") {
    const r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
    const topEdge = b.top + 60, bottomEdge = b.bottom - ($("positions").offsetHeight || 0) - 8;
    if (r.top < topEdge) box.scrollTop -= topEdge - r.top;
    else if (r.bottom > bottomEdge) box.scrollTop += r.bottom - bottomEdge;
  }
}
$("rp-range").addEventListener("input", (e) => { stopPlay(); step(+(e.target as HTMLInputElement).value); });
$("rp-first").addEventListener("click", () => { stopPlay(); step(0); });
$("rp-prev").addEventListener("click", () => { stopPlay(); step(replayIdx - 1); });
$("rp-next").addEventListener("click", () => { stopPlay(); step(replayIdx + 1); });
$("rp-last").addEventListener("click", () => { stopPlay(); step(seqEvents.length - 1); });

function renderSequence(r: RunResult, upto: number): void {
  const host = $("sequence");
  const lanes = r.processes.map((p) => p.name);
  $("legend").hidden = !lanes.length;
  if (!lanes.length) { host.innerHTML = `<p class="empty">No processes ran.</p>`; return; }
  const MAX_ROWS = 120;
  const events = seqEvents.slice(0, MAX_ROWS);
  const clipped = seqEvents.length - events.length;
  upto = Math.min(upto, events.length - 1 + (clipped ? 0 : 0));
  const compact = mobile();
  const laneW = compact ? Math.max(118, Math.min(170, (window.innerWidth - 40) / Math.max(lanes.length, 1))) : Math.max(130, Math.min(200, 560 / lanes.length));
  const left = 28, top = 64, rowH = compact ? 36 : 40;
  const width = left + 8 + laneW * lanes.length + 150;
  const rows = events.length + (r.error || clipped ? 1 : 0);
  const height = top + rows * rowH + 34;
  const x = (name: string) => left + laneW * Math.max(0, lanes.indexOf(name)) + laneW / 2;
  const parts: string[] = [];
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  parts.push(`<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker>
    <marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead sel"/></marker></defs>`);
  if (upto >= 0 && upto < events.length - 1) parts.push(`<rect x="0" y="${top + upto * rowH}" width="${width}" height="${rowH}" class="row-now"/>`);
  r.processes.forEach((p) => {
    const cx = x(p.name);
    parts.push(`<line x1="${cx}" y1="${top - 14}" x2="${cx}" y2="${height - 18}" class="lifeline${p.external ? " ext" : ""}"/>`);
    parts.push(`<rect x="${cx - laneW / 2 + 8}" y="8" width="${laneW - 16}" height="40" rx="3" class="lane-head${p.external ? " ext" : ""}"/>`);
    parts.push(`<text x="${cx}" y="25" class="lane-name">${esc(cut(p.name, 16))}</text>`);
    parts.push(`<text x="${cx}" y="40" class="lane-comp">${esc(cut(p.external ? "external (simulated)" : p.component, 20))}</text>`);
  });
  events.forEach((t, i) => {
    const y = top + i * rowH + rowH / 2;
    const fut = i > upto ? ' class="future"' : "";
    const g: string[] = [`<text x="6" y="${y + 3.5}" class="stepno">${i + 1}</text>`];
    if (t.kind === "message" || t.kind === "select") {
      const x1 = x(t.from), x2 = x(t.to);
      const dir = x2 >= x1 ? 1 : -1;
      g.push(`<line x1="${x1 + dir * 4}" y1="${y}" x2="${x2 - dir * 6}" y2="${y}" class="msg${t.kind === "select" ? " sel" : ""}" marker-end="url(#${t.kind === "select" ? "ah2" : "ah"})"/>`);
      const label = (t.kind === "select" ? "select " : "") + t.text;
      g.push(`<text x="${(x1 + x2) / 2}" y="${y - 7}" class="msg-label${t.kind === "select" ? " sel" : ""}">${esc(cut(label, Math.max(12, Math.floor(Math.abs(x2 - x1) / 7))))}</text>`);
    } else if (t.kind === "close") {
      const cx = x(t.proc);
      g.push(`<rect x="${cx - 4.5}" y="${y - 4.5}" width="9" height="9" class="close-mark"/><text x="${cx + 11}" y="${y + 4}" class="note">close ${esc(t.session)}</text>`);
    } else if (t.kind === "console") {
      const cx = x(t.proc);
      g.push(`<circle cx="${cx}" cy="${y}" r="3.5" class="console-dot"/><text x="${cx + 9}" y="${y + 4}" class="note">“${esc(cut(t.text, 28))}”</text>`);
    } else if (t.kind === "return" || t.kind === "reject" || t.kind === "fail") {
      const cx = x(t.proc);
      const cls = t.kind === "return" ? "done" : "failed";
      const label = t.kind === "return" ? (t.text ? `returns ${t.text}` : "finished") : t.kind === "reject" ? `rejects ${t.text}` : `fails ${t.text}`;
      const mark = t.kind === "return"
        ? `<g class="paw" transform="translate(${cx},${y})"><ellipse cx="0" cy="2.6" rx="3.6" ry="3"/><circle cx="-4.4" cy="-2.2" r="1.55"/><circle cx="-1.5" cy="-4.6" r="1.55"/><circle cx="1.5" cy="-4.6" r="1.55"/><circle cx="4.4" cy="-2.2" r="1.55"/></g>`
        : `<path d="M${cx - 6},${y} l6,-6 l6,6 l-6,6 z" class="end-mark ${cls}"/>`;
      g.push(`${mark}<text x="${cx + 11}" y="${y + 4}" class="note ${cls}">${esc(cut(label, 30))}</text>`);
    }
    parts.push(`<g${fut}>${g.join("")}</g>`);
  });
  if (clipped) {
    const y = top + events.length * rowH + rowH / 2;
    parts.push(`<text x="${left}" y="${y + 4}" class="note">… ${clipped.toLocaleString()} more events not drawn (see Steps)</text>`);
  } else if (r.error) {
    const y = top + events.length * rowH + rowH / 2;
    const cx = r.error.process && lanes.includes(r.error.process) ? x(r.error.process) : left + laneW / 2;
    const fut = upto < events.length - 1 ? ' class="future"' : "";
    parts.push(`<g${fut}><circle cx="${cx}" cy="${y}" r="9" class="err-mark"/><text x="${cx}" y="${y + 4}" class="err-x">!</text><text x="${cx + 15}" y="${y + 4}" class="note failed">${esc(KIND_LABEL[r.error.kind] ?? "error")}</text></g>`);
  }
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Message sequence between processes">${parts.join("")}</svg>`;
}

// ------------------------------------------------------------------ bug hunt

let lastHunt: ExploreResult | undefined;
function doHunt(): ExploreResult | undefined {
  showTab("hunt");
  if (mobile()) setView("results");
  const out = $("hunt-out");
  checkSyntax();
  if (syntaxDiags.some((d) => d.severity === "error")) { out.innerHTML = `<p class="empty">Fix the syntax errors first (see Problems).</p>`; return undefined; }
  let r: ExploreResult;
  try { r = explore(buildProgram(editor.value), inputValues); }
  catch (err) { out.innerHTML = `<p class="empty">The hunt hit an internal error: ${esc(String((err as Error).message))}</p>`; return undefined; }
  lastHunt = r;
  const count = $("hunt-count");
  count.hidden = r.findings.length === 0;
  count.textContent = r.findings.length ? ` ${r.findings.length}` : "";
  const scope = r.mode === "functions" ? `No runnable program, so each function was called with generated arguments: ${r.targets.map(esc).join(", ") || "none"}.` : "";
  const extra = [r.skipped ? `${r.skipped} excluded by the program's own input contract` : "", r.inconclusive ? `${r.inconclusive} inconclusive (step limit or needs a peer)` : "", r.truncated ? "stopped at the search bound" : ""].filter(Boolean).join(" · ");
  const stats = `<div class="stats">${r.runs.toLocaleString()} runs · ${r.ms} ms${extra ? " · " + extra : ""}</div>`;
  const unsup = r.unsupported.length ? `<p class="hint">Could not generate values for: ${r.unsupported.map((u) => `<code>${esc(u)}</code>`).join(", ")}.</p>` : "";
  if (r.mode === "none" || (r.runs === 0 && !r.findings.length)) { out.innerHTML = `<p class="empty">Nothing to explore: add a program, a <code>component main</code>, or functions.</p>${unsup}`; return r; }
  if (!r.findings.length) {
    out.innerHTML = `<div class="verdict good">No failures found</div><p class="hint">${scope} Every explored run finished cleanly. This is a bounded search, not a proof.</p>${unsup}${stats}`;
    return r;
  }
  out.innerHTML = `<div class="verdict bad">${r.findings.length} way${r.findings.length > 1 ? "s" : ""} to fail</div>${scope ? `<p class="hint">${scope}</p>` : ""}` + r.findings.map((f, i) => `<div class="finding">
      <div class="problem-head"><span class="code-chip">${KIND_LABEL[f.kind] ?? f.kind}</span><span>${esc(f.where)}</span>${f.span && f.span[1] > 0 ? `<button class="loc" data-off="${f.span[0]}" type="button">line ${lineCol(f.span[0])}</button>` : ""}<span>${f.count} of ${r.runs} runs</span></div>
      <div>${md(f.message)}</div>
      ${f.inputs.length ? `<div class="with">with ${f.inputs.map((x) => `${esc(x.name)} = ${esc(x.text)}`).join(", ")}</div>` : ""}
      ${f.replay ? `<button class="fix" data-replay="${i}" type="button">Replay this run</button>` : ""}
    </div>`).join("") + unsup + stats;
  out.querySelectorAll<HTMLButtonElement>("button.loc").forEach((b) => b.addEventListener("click", () => { const off = +b.dataset.off!; nowSpan = [off, off + 1]; highlight(); revealOffset(off, true); }));
  out.querySelectorAll<HTMLButtonElement>("button[data-replay]").forEach((b) => b.addEventListener("click", () => {
    const rp = r.findings[+b.dataset.replay!].replay!;
    for (const [k, v] of Object.entries(rp.inputs)) {
      inputValues[k] = v;
      const el = document.getElementById("in-" + k) as HTMLInputElement | null;
      if (el) { el.value = v; el.setAttribute("aria-invalid", "false"); }
    }
    runOpts = { order: rp.order, extPolicy: rp.extPolicy };
    runProgram();
    showTab("sequence");
  }));
  return r;
}
$("hunt-run").addEventListener("click", doHunt);
$("hunt-link").addEventListener("click", doHunt);
$("hunt-m").addEventListener("click", doHunt);

function checkPuzzle(result: RunResult): void {
  if (!current.id.startsWith("fix-") || !result.ok || solved.has(current.id) || editor.value === current.code) return;
  const hunt = explore(buildProgram(editor.value), inputValues, { budgetMs: 600 });
  if (hunt.findings.length) { toast("It runs, but a hunt still finds a failure. Open Hunt."); return; }
  solved.add(current.id);
  try { localStorage.setItem("phil-playground-solved", JSON.stringify([...solved])); } catch { /* storage unavailable */ }
  const opt = exampleSelect.querySelector<HTMLOptionElement>(`option[value="${current.id}"]`);
  if (opt && !opt.textContent!.startsWith("✓")) opt.textContent = "✓ " + opt.textContent;
  summary.insertAdjacentHTML("afterbegin", `<div class="verdict good" style="margin-bottom:8px">Puzzle solved. Good dog. ${solved.size} of ${PUZZLES.length} done.</div>`);
  toast("Puzzle solved");
}

// ------------------------------------------------------------------ Phil's own compiler
// philc.wasm is built from the Phil repository by a scheduled workflow. The tab only appears
// when a build is published next to this page.
let philcBuild: PhilcBuild | undefined;
async function initPhilc(): Promise<void> {
  try {
    const r = await fetch("philc.json", { cache: "no-cache" });
    if (!r.ok) return;
    philcBuild = (await r.json()) as PhilcBuild;
  } catch { return; }
  if (!philcBuild?.commit) return;
  $("philc-tab").hidden = false;
  $("philc-build").textContent = `Built from Phil commit ${philcBuild.commit.slice(0, 10)} of ${philcBuild.date} with GHC ${philcBuild.ghc} · ${(philcBuild.bytes / 1048576).toFixed(1)} MB, downloaded the first time you press the button`;
  $("philc-target").innerHTML = PHILC_TARGETS.map((t) => `<option>${t}</option>`).join("");
}
async function doPhilc(): Promise<void> {
  const out = $("philc-out"), btn = $<HTMLButtonElement>("philc-run");
  const src = editor.value;
  btn.disabled = true;
  out.innerHTML = `<p class="philc-both">Loading Phil's compiler…</p>`;
  try {
    const module = await loadPhilc("philc.wasm");
    out.innerHTML = `<p class="philc-both">Compiling…</p>`;
    await new Promise((r) => setTimeout(r, 20));
    const r = await runPhilc(module, src, $<HTMLSelectElement>("philc-target").value);
    const legacy = parse(src, { syntax: "auto" }).legacy && !earlierSyntax;
    const ours = legacy ? "reads the newer grammar with semicolons, and this earlier-syntax program is beyond the simple cases it can also read"
      : syntaxDiags.length ? "could not parse it"
      : lastResult ? (lastResult.ok ? "ran it to completion" : `stopped it with “${KIND_LABEL[lastResult.error!.kind] ?? lastResult.error!.kind}”`) : "has not run it yet";
    if (r.accepted) {
      const lines = r.stdout.split("\n").length;
      out.innerHTML = `<div class="philc-verdict good"><b>philc accepted this program</b>It emitted ${lines} lines of LLVM IR in ${r.ms} ms.</div>`
        + `<p class="philc-both">Our simulator ${esc(ours)}.</p>`
        + `<div class="philc-irh"><span>LLVM IR from philc</span><button type="button" id="philc-copy">Copy</button></div><pre class="philc-ir">${esc(r.stdout.length > 200000 ? r.stdout.slice(0, 200000) + "\n; … cut here" : r.stdout)}</pre>`;
      $("philc-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(r.stdout); toast("LLVM IR copied"); } catch { toast("Select the text to copy it"); } });
    } else {
      const m = readPhilcError(r.stderr || `It exited with status ${r.exit} and printed nothing.`);
      const where = m.line ? `Line ${m.line}${m.col ? `, column ${m.col}` : ""}: ` : "";
      out.innerHTML = `<div class="philc-verdict bad"><b>philc did not accept this program</b>${esc(where + m.text)}`
        + (m.expecting ? `<details><summary>What it expected there</summary><pre>${esc(m.expecting)}</pre></details>` : "") + `</div>`
        + `<p class="philc-both">Our simulator ${esc(ours)}. philc compiles only a small part of the language so far, so a refusal here usually means “not supported yet”, not “wrong”. <button type="button" class="linklike" id="philc-sample">Load a program it accepts</button></p>`;
      $("philc-sample").addEventListener("click", loadPhilcSample);
    }
  } catch (e) {
    out.innerHTML = `<div class="philc-verdict bad"><b>Phil's compiler could not be loaded</b>${esc(String((e as Error).message ?? e))}</div>`;
  }
  btn.disabled = false;
}
function loadPhilcSample(): void {
  loadExample("scratch", true, PHILC_SAMPLE);
  showTab("philc");
  void doPhilc();
}
$("philc-run").addEventListener("click", () => { void doPhilc(); });
$("philc-try").addEventListener("click", loadPhilcSample);
void initPhilc();

// ------------------------------------------------------------------ protocol designer

const dzSteps: Step[] = [{ from: "a", name: "item", type: "U32" }, { from: "b", name: "price", type: "U64" }, { from: "a", name: "accept", type: "Bool" }];
function renderDesigner(): void {
  const a = ($("dz-a") as HTMLInputElement).value || "First", b = ($("dz-b") as HTMLInputElement).value || "Second";
  $("dz-steps").innerHTML = dzSteps.map((s, i) => `<div class="dz-row">
      <span>${i + 1}</span>
      <select data-i="${i}" data-f="from" aria-label="Direction of step ${i + 1}"><option value="a"${s.from === "a" ? " selected" : ""}>${esc(a)} → ${esc(b)}</option><option value="b"${s.from === "b" ? " selected" : ""}>${esc(b)} → ${esc(a)}</option></select>
      <input data-i="${i}" data-f="name" value="${esc(s.name)}" aria-label="Name of step ${i + 1}" autocomplete="off" spellcheck="false" autocapitalize="off">
      <select data-i="${i}" data-f="type" aria-label="Type of step ${i + 1}">${STEP_TYPES.map((t) => `<option${t === s.type ? " selected" : ""}>${t}</option>`).join("")}</select>
      <button type="button" class="rm" data-rm="${i}" aria-label="Remove step ${i + 1}">×</button>
    </div>`).join("") || `<p class="empty">No messages yet. Add a step.</p>`;
  $("dz-steps").querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-f]").forEach((el) => el.addEventListener("input", () => {
    (dzSteps[+el.dataset.i!] as unknown as Record<string, string>)[el.dataset.f!] = el.value;
  }));
  $("dz-steps").querySelectorAll<HTMLButtonElement>("[data-rm]").forEach((el) => el.addEventListener("click", () => { dzSteps.splice(+el.dataset.rm!, 1); renderDesigner(); }));
}
$("dz-add").addEventListener("click", () => { if (dzSteps.length < 12) { dzSteps.push({ from: dzSteps.length % 2 ? "b" : "a", name: "value" + (dzSteps.length + 1), type: "U32" }); renderDesigner(); } });
$("dz-a").addEventListener("change", renderDesigner);
$("dz-b").addEventListener("change", renderDesigner);
$("dz-go").addEventListener("click", () => {
  const code = generateProtocol({
    name: ($("dz-name") as HTMLInputElement).value, roleA: ($("dz-a") as HTMLInputElement).value, roleB: ($("dz-b") as HTMLInputElement).value,
    steps: dzSteps, repeat: ($("dz-repeat") as HTMLInputElement).checked,
  }, RESERVED);
  loadExample("scratch", true, code);
  $("blurb").textContent = "Generated by the protocol designer. Edit it freely; it lives in the scratch pad.";
  showTab("sequence");
  toast("Program generated and run");
});

// ------------------------------------------------------------------ structure: architecture and protocols

function renderStructure(): void {
  const host = $("structure");
  const count = $("structure-count");
  if (syntaxDiags.some((d) => d.severity === "error")) { host.innerHTML = `<p class="empty">Fix the syntax errors to see the structure.</p>`; count.hidden = true; return; }
  let html = "";
  let bad = 0;
  try {
    const ast = buildProgram(editor.value);
    const arch = architectureView(ast);
    if (arch) {
      const owners = [...arch.instances.map((i) => i.name)];
      const hasExt = arch.sessions.some((x) => x.ends.some((e) => e.owner === "external"));
      if (hasExt) owners.push("external");
      const bw = 168, gap = 56, left = 8, bh = 62;
      const cx = (o: string) => left + owners.indexOf(o) * (bw + gap) + bw / 2;
      const width = left * 2 + owners.length * bw + (owners.length - 1) * gap;
      const height = bh + 34 + arch.sessions.length * 44;
      const parts: string[] = [];
      arch.sessions.forEach((x, i) => {
        const y = bh + 40 + i * 44;
        const ends = x.ends.filter((e) => owners.includes(e.owner));
        const xs = ends.map((e) => cx(e.owner));
        if (xs.length === 2) {
          parts.push(`<path d="M${xs[0]},${bh + 8} V${y} H${xs[1]} V${bh + 8}" class="a-wire"/>`);
          parts.push(`<text x="${(xs[0] + xs[1]) / 2}" y="${y - 6}" class="a-wlabel">${esc(x.name)} : ${esc(x.protocol)}</text>`);
          ends.forEach((e, k) => parts.push(`<circle cx="${xs[k]}" cy="${y}" r="3" class="a-dot"/><text x="${xs[k] + (xs[k] <= xs[1 - k] ? 7 : -7)}" y="${y + 15}" class="a-role" text-anchor="${xs[k] <= xs[1 - k] ? "start" : "end"}">${esc(e.role)}</text>`));
        }
      });
      owners.forEach((o) => {
        const inst = arch.instances.find((i) => i.name === o);
        const entries = arch.entries.filter((e) => e.to.includes(o)).map((e) => e.name);
        const x = cx(o) - bw / 2;
        parts.push(`<rect x="${x}" y="8" width="${bw}" height="${bh}" rx="3" class="a-box${inst ? "" : " ext"}"/>`);
        parts.push(`<text x="${cx(o)}" y="30" class="a-name">${esc(o)}</text>`);
        parts.push(`<text x="${cx(o)}" y="45" class="a-sub">${esc(inst ? inst.component + (inst.process ? "" : " (not started)") : "played by the simulator")}</text>`);
        if (entries.length) parts.push(`<text x="${cx(o)}" y="60" class="a-sub">gets ${esc(entries.join(", "))}</text>`);
      });
      html += `<div class="st-h">Architecture ${esc(arch.name)}</div><p class="st-note">Each box is a running program. Each line is a conversation that follows the named protocol.</p><div id="arch"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Architecture diagram">${parts.join("")}</svg></div>`;
    }
    for (const p of protocolViews(ast)) {
      bad += p.mismatches.length;
      html += `<div class="st-h">Protocol ${esc(p.name)} ${p.roles.length === 2 ? (p.mismatches.length ? '<span class="badmark">the two roles do not match</span>' : '<span class="okmark">the two roles match</span>') : ""}</div>`;
      html += p.mismatches.map((m) => `<p class="st-bad">${md(m)}</p>`).join("");
      html += `<div class="scripts">${p.roles.map((r) => `<div><h4>${esc(r.name)}</h4>${r.lines.map((l) => `<div class="sl ${l.kind}">${"  ".repeat(l.depth)}${esc(l.text)}</div>`).join("")}</div>`).join("")}</div>`;
    }
  } catch (err) {
    html = `<p class="empty">Could not read the structure: ${esc(String((err as Error).message))}</p>`;
  }
  host.innerHTML = html || `<p class="empty">This program has no architecture or protocol. Try the Ping example to see one.</p>`;
  count.hidden = bad === 0;
  count.textContent = bad ? ` ${bad}` : "";
}

// ------------------------------------------------------------------ share links

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function pipe(bytes: Uint8Array, stream: { readable: ReadableStream; writable: WritableStream }): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  void w.write(bytes); void w.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
async function encodeShare(code: string): Promise<string> {
  const raw = new TextEncoder().encode(code);
  try { if (typeof CompressionStream !== "undefined") return "z" + b64url(await pipe(raw, new CompressionStream("deflate-raw"))); } catch { /* fall back */ }
  return "u" + b64url(raw);
}
async function decodeShare(text: string): Promise<string | undefined> {
  try {
    const bytes = unb64url(text.slice(1));
    if (bytes.length > 400_000) return undefined;
    if (text[0] === "z") return new TextDecoder().decode(await pipe(bytes, new DecompressionStream("deflate-raw")));
    if (text[0] === "u") return new TextDecoder().decode(bytes);
  } catch { /* not a share link */ }
  return undefined;
}
$("share").addEventListener("click", async () => {
  const link = location.href.split("#")[0] + "#code=" + (await encodeShare(editor.value));
  if (link.length > 60_000) { toast("This program is too long for a link"); return; }
  try { await navigator.clipboard.writeText(link); toast("Link to this code copied"); }
  catch { toast("Copy is blocked here"); }
});

// ------------------------------------------------------------------ docs

function renderDocs(query = ""): void {
  const q = query.trim().toLowerCase();
  const match = (...xs: string[]) => !q || xs.some((x) => x.toLowerCase().includes(q));
  const groups = new Map<string, string[]>();
  for (const [word, d] of Object.entries(KWDOCS)) {
    if (!match(word, d.meaning, d.category)) continue;
    if (!groups.has(d.category)) groups.set(d.category, []);
    groups.get(d.category)!.push(`<dt>${esc(word)}</dt><dd>${md(d.meaning)}</dd>`);
  }
  const host = Object.entries(HOST_OPERATIONS).filter(([k, v]) => match(k, v))
    .map(([, v]) => `<dt>${esc(v.split(" — ")[0])}</dt><dd>${esc(v.split(" — ")[1] ?? "")}</dd>`);
  const codes = CODES.filter((c) => match(c.code, c.title, c.explanation)).map((c) => `<dt>${c.code}</dt><dd><b>${esc(c.title)}.</b> ${md(c.explanation)}</dd>`);
  let total = 0;
  let html = "";
  for (const [g, items] of groups) { total += items.length; html += `<div class="doc-group">${esc(g)}</div><dl class="doc">${items.join("")}</dl>`; }
  if (host.length) { total += host.length; html += `<div class="doc-group">Simulator host operations</div><dl class="doc">${host.join("")}</dl>`; }
  if (codes.length) { total += codes.length; html += `<div class="doc-group">Error codes</div><dl class="doc">${codes.join("")}</dl>`; }
  $("docs").innerHTML = total ? `<div class="doc-count">${total} entr${total === 1 ? "y" : "ies"}</div>${html}` : `<p class="empty">Nothing matches “${esc(query)}”.</p>`;
}
$("doc-search").addEventListener("input", (e) => renderDocs((e.target as HTMLInputElement).value));

// ------------------------------------------------------------------ views, tabs, examples, files

function setView(view: "code" | "results"): void {
  $("main").dataset.view = view;
  $("view-code").setAttribute("aria-pressed", String(view === "code"));
  $("view-results").setAttribute("aria-pressed", String(view === "results"));
  if (view === "code") requestAnimationFrame(() => { syncScroll(); highlight(); });
  else if (lastResult) renderSequence(lastResult, replayIdx);
  if (mobile()) window.scrollTo(0, 0);
}
$("view-code").addEventListener("click", () => setView("code"));
$("view-results").addEventListener("click", () => setView("results"));

function showTab(name: string): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll<HTMLElement>(".panel").forEach((p) => { p.hidden = p.id !== "panel-" + name; });
  if (name === "docs" && !$("docs").innerHTML) renderDocs();
  if (name === "design" && !$("dz-steps").innerHTML) renderDesigner();
}
document.querySelectorAll<HTMLButtonElement>(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab!)));

function draftKey(id: string): string { return "phil-playground-draft:" + id; }
function saveDraft(): void {
  try {
    if (editor.value === current.code) localStorage.removeItem(draftKey(current.id));
    else localStorage.setItem(draftKey(current.id), editor.value);
  } catch { /* storage unavailable */ }
}

function loadExample(id: string, runNow = true, codeOverride?: string): void {
  const ex = ALL.find((e) => e.id === id) ?? ALL[0];
  current = ex;
  exampleSelect.value = ex.id;
  let draft: string | null = null;
  try { draft = localStorage.getItem(draftKey(ex.id)); } catch { /* storage unavailable */ }
  editor.value = codeOverride ?? draft ?? ex.code;
  editor.scrollTop = 0;
  editor.scrollLeft = 0;
  for (const k of Object.keys(inputValues)) delete inputValues[k];
  Object.assign(inputValues, ex.inputs ?? {});
  runOpts = {};
  $("hunt-out").innerHTML = "";
  $("hunt-count").hidden = true;
  inputsBox.innerHTML = "";
  $("blurb").textContent = ex.blurb + (draft && !codeOverride ? " (Edited; Reset restores the original.)" : "");
  $("ex-title").textContent = ex.title;
  $("ex-heading").textContent = ex.title;
  const hint = TRY[ex.id] ?? (ex.id.startsWith("fix-") ? "" : GOALS[ex.id] ? "Read the error on the right, then try to fix the code. This one is also a puzzle." : "");
  $("try").hidden = !hint;
  $("try").innerHTML = hint ? `<b>Try</b>${esc(hint)}` : "";
  renderExampleList();
  try { if (location.hash.slice(1) !== ex.id) history.replaceState(null, "", "#" + ex.id); } catch { /* sandboxed */ }
  checkSyntax();
  highlight();
  updateCaret();
  if (codeOverride) saveDraft();
  if (runNow) {
    runProgram();
  } else {
    summary.innerHTML = `<div class="headline">Press Run to execute the program.</div>`;
  }
}

function buildExampleMenu(): void {
  const groups = new Map<string, Example[]>();
  for (const ex of EXAMPLES) { if (!groups.has(ex.group)) groups.set(ex.group, []); groups.get(ex.group)!.push(ex); }
  exampleSelect.innerHTML = [...groups].map(([g, list]) =>
    `<optgroup label="${esc(g)}">${list.map((e) => `<option value="${e.id}">${esc(e.title)}</option>`).join("")}</optgroup>`).join("")
    + `<optgroup label="Puzzles: fix it">${PUZZLES.map((e) => `<option value="${e.id}">${solved.has(e.id) ? "✓ " : ""}${esc(e.title)}</option>`).join("")}</optgroup>`
    + `<optgroup label="Your code"><option value="scratch">Scratch pad</option></optgroup>`;
  exampleSelect.addEventListener("change", () => loadExample(exampleSelect.value));
}

function readText(f: File): Promise<string> {
  if (typeof f.text === "function") return f.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsText(f);
  });
}
// ------------------------------------------------------------------ example browser and intro

function renderExampleList(): void {
  const groups: [string, Example[]][] = [];
  for (const ex of EXAMPLES) { let g = groups.find((x) => x[0] === ex.group); if (!g) groups.push(g = [ex.group, []]); g[1].push(ex); }
  groups.push(["Puzzles: fix it", PUZZLES], ["Your code", [SCRATCH]]);
  const note: Record<string, string> = { "Caught by Phil": "Programs with a mistake, to show what Phil reports", "Puzzles: fix it": `${solved.size} of ${PUZZLES.length} solved` };
  $("ex-list").innerHTML = groups.map(([g, list]) => `<div class="ex-group">${esc(g)}${note[g] ? ` · ${esc(note[g])}` : ""}</div>` + list.map((e) => {
    const tag = e.id.startsWith("fix-") ? (solved.has(e.id) ? '<i class="tag ok">solved</i>' : "") : e.expect !== "ok" ? `<i class="tag">${esc(KIND_LABEL[e.expect] ?? e.expect)}</i>` : "";
    return `<button type="button" class="ex-item${e.id === current.id ? " current" : ""}" data-ex="${e.id}"><b>${esc(e.title)}${tag}</b><span>${esc(e.blurb.replace(/ Solved when it runs and a hunt finds nothing\.$/, ""))}</span></button>`;
  }).join("")).join("");
  $("ex-list").querySelectorAll<HTMLButtonElement>("[data-ex]").forEach((b) => b.addEventListener("click", () => {
    $("ex-drawer").hidden = true;
    loadExample(b.dataset.ex!);
    showTab("sequence");
    if (mobile()) setView("code");
  }));
}
$("ex-open").addEventListener("click", () => { renderExampleList(); $("ex-drawer").hidden = false; $("ex-list").querySelector<HTMLElement>(".current")?.scrollIntoView({ block: "center" }); });
$("ex-close").addEventListener("click", () => { $("ex-drawer").hidden = true; });
$("ex-drawer").addEventListener("click", (e) => { if (e.target === e.currentTarget) $("ex-drawer").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("ex-drawer").hidden = true; });

function setIntro(show: boolean): void {
  $("intro").hidden = !show;
  try { localStorage.setItem("phil-playground-intro", show ? "1" : "0"); } catch { /* storage unavailable */ }
}
$("intro-close").addEventListener("click", () => setIntro(false));
$("intro-show").addEventListener("click", () => { setIntro(true); window.scrollTo(0, 0); });
document.querySelectorAll<HTMLButtonElement>("[data-start]").forEach((b) => b.addEventListener("click", () => {
  const id = b.dataset.start!;
  if (id === "@design") { showTab("design"); if (mobile()) setView("results"); return; }
  loadExample(id);
  showTab("sequence");
  if (mobile()) setView(id === "token" ? "results" : "code");
}));
let introSeen = "1";
try { introSeen = localStorage.getItem("phil-playground-intro") ?? "1"; } catch { /* storage unavailable */ }
$("intro").hidden = introSeen === "0";

const fileInput = $<HTMLInputElement>("file-input");
const openFile = () => fileInput.click();
$("open-file").addEventListener("click", openFile);
fileInput.addEventListener("change", async () => {
  const f = fileInput.files?.[0];
  fileInput.value = "";
  if (!f) return;
  if (f.size > 512 * 1024) { toast("That file is larger than 512 KB"); return; }
  let text: string;
  try { text = await readText(f); } catch { toast("Could not read that file"); return; }
  if (/\u0000/.test(text)) { toast("That does not look like a text file"); return; }
  loadExample("scratch", false, text.replace(/\r\n?/g, "\n"));
  $("blurb").textContent = `Opened ${f.name}. Kept in this browser as the scratch pad.`;
  setView("code");
  toast(`Opened ${f.name}`);
});

$("format").addEventListener("click", doFormat);
$("reset").addEventListener("click", () => {
  try { localStorage.removeItem(draftKey(current.id)); } catch { /* ignore */ }
  loadExample(current.id);
  toast("Restored the original");
});
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(editor.value); toast("Code copied"); }
  catch { toast("Copy is blocked here; select the code and copy it manually"); }
});
document.querySelectorAll<HTMLButtonElement>(".copy-ca").forEach((b) => b.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(CONTRACT); toast("Contract address copied"); }
  catch { toast("Copy is blocked here; the address is in the About tab"); }
}));
document.querySelectorAll<HTMLButtonElement>(".navtab").forEach((b) => b.addEventListener("click", () => { if (mobile()) setView("results"); }));
$("host-ops").innerHTML = Object.values(HOST_OPERATIONS).map((d) => `<li><code>${esc(d.split(" — ")[0])}</code> ${esc(d.split(" — ")[1] ?? "")}</li>`).join("");

window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (id && id !== current.id && ALL.some((e) => e.id === id)) loadExample(id);
});
let resizeTimer: number | undefined;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => { if (lastResult) renderSequence(lastResult, replayIdx); syncScroll(); }, 120);
});

buildExampleMenu();
const initial = location.hash.slice(1);
loadExample(ALL.some((e) => e.id === initial) ? initial : "token");
if (initial.startsWith("code=")) {
  void decodeShare(initial.slice(5)).then((code) => {
    if (code === undefined) return;
    loadExample("scratch", true, code.replace(/\r\n?/g, "\n"));
    $("blurb").textContent = "Opened from a shared link. It lives in your scratch pad now.";
  });
}
