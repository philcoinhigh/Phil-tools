// Learn Phil: lessons with a live editor. Progress is kept in this browser when storage is available.
import { LESSONS, Lesson } from "./lessons";
import { checkLesson } from "./check";
import { mountEditor, runPhil, KIND_TITLE, esc, store, Editor } from "./shared";
import { wireFooter } from "./foot";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const done = new Set<string>(JSON.parse(store("phil-learn-done") ?? "[]"));
const drafts: Record<string, string> = {};
let lesson: Lesson = LESSONS[0];
let inputs: Record<string, string> = {};
let editor: Editor;

const rich = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
const narrow = () => window.matchMedia("(max-width: 820px)").matches;

function renderToc(): void {
  let html = "", chapter = "";
  LESSONS.forEach((l, i) => {
    if (l.chapter !== chapter) { chapter = l.chapter; html += `<h3>${esc(chapter)}</h3>`; }
    html += `<a href="#${l.id}" aria-current="${l.id === lesson.id}"><span class="tick">${done.has(l.id) ? "✓" : ""}</span><span>${i + 1}. ${esc(l.title)}</span></a>`;
  });
  $("toc-list").innerHTML = html;
  $("progress").textContent = `${done.size} of ${LESSONS.length} done`;
  $("toc-now").textContent = `Lesson ${LESSONS.indexOf(lesson) + 1} of ${LESSONS.length} · ${done.size} done`;
}

function markDone(): void {
  if (done.has(lesson.id)) return;
  done.add(lesson.id);
  store("phil-learn-done", JSON.stringify([...done]));
  renderToc();
}

function renderTaskState(): void {
  const t = $("task");
  t.hidden = !lesson.task;
  t.classList.toggle("done", done.has(lesson.id));
  $("task-h").textContent = done.has(lesson.id) ? "Done" : "Your turn";
  $("task-text").innerHTML = rich(lesson.task ?? "");
}

function show(id: string): void {
  lesson = LESSONS.find((l) => l.id === id) ?? LESSONS[0];
  inputs = { ...(lesson.inputs ?? {}) };
  const i = LESSONS.indexOf(lesson);
  document.title = `${lesson.title} · Learn Phil`;
  $("chap").textContent = `${lesson.chapter} · lesson ${i + 1} of ${LESSONS.length}`;
  $("title").textContent = lesson.title;
  $("text").innerHTML = lesson.text.map((p) => `<p>${rich(p)}</p>`).join("");
  renderTaskState();
  $("inputs").innerHTML = Object.entries(inputs).map(([k, v]) => `<label>${esc(k)} <input data-k="${esc(k)}" value="${esc(v)}" inputmode="numeric" autocomplete="off"></label>`).join("");
  editor = mountEditor($("editor"), drafts[lesson.id] ?? lesson.code, () => { drafts[lesson.id] = editor.value; });
  $("out").innerHTML = "";
  $("solve").hidden = !lesson.solution;
  $("finish").hidden = true;
  const prev = $<HTMLAnchorElement>("prev"), next = $<HTMLAnchorElement>("next");
  prev.style.visibility = i === 0 ? "hidden" : "";
  prev.href = "#" + (LESSONS[i - 1]?.id ?? lesson.id);
  next.hidden = i === LESSONS.length - 1;
  next.href = "#" + (LESSONS[i + 1]?.id ?? lesson.id);
  $<HTMLAnchorElement>("open-pg").href = lesson.id === "otc" ? "../playground/#otc" : "../playground/";
  renderToc();
  if (narrow()) $<HTMLDetailsElement>("toc").open = false;
}

function runLesson(): void {
  const src = editor.value;
  const o = runPhil(src, inputs);
  editor.mark(o.ok ? undefined : o.span);
  let html = o.ok
    ? `<div class="v good">Ran to completion</div>`
    : `<div class="v bad">${esc(KIND_TITLE[o.kind] ?? o.kind)}${o.line ? ` · line ${o.line}` : ""}</div><div>${esc(o.message)}</div>${o.hint ? `<div class="hint">${esc(o.hint)}</div>` : ""}`;
  const lines = [...o.console, ...o.returns.map((r) => `${r.proc} hands back ${r.text}`)];
  if (lines.length) html += `<pre>${esc(lines.join("\n"))}</pre>`;
  const why = checkLesson(lesson, src, o, inputs);
  const untouched = !!lesson.task && src === lesson.code;
  if (why === undefined && !untouched) {
    markDone();
    renderTaskState();
    html += `<div class="verdict good">${lesson.task ? "Task done. Good dog." : "Lesson done."}</div>`;
    if (LESSONS.indexOf(lesson) === LESSONS.length - 1 || done.size === LESSONS.length) $("finish").hidden = false;
  } else if (lesson.task && o.ok && why) html += `<div class="verdict">${esc(why)}</div>`;
  $("out").innerHTML = html;
}

$("run").addEventListener("click", runLesson);
$("reset").addEventListener("click", () => { delete drafts[lesson.id]; editor.set(lesson.code); $("out").innerHTML = ""; });
$("solve").addEventListener("click", () => { if (lesson.solution) { editor.set(lesson.solution); drafts[lesson.id] = lesson.solution; runLesson(); } });
$("inputs").addEventListener("input", (e) => { const t = e.target as HTMLInputElement; if (t.dataset.k) inputs[t.dataset.k] = t.value; });
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runLesson(); } });
window.addEventListener("hashchange", () => { show(location.hash.slice(1)); window.scrollTo(0, 0); });
const firstOpen = LESSONS.find((l) => !done.has(l.id)) ?? LESSONS[0];
show(location.hash.slice(1) || firstOpen.id);
wireFooter();
