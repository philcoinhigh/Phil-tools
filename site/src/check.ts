import { buildAst } from "../../core/src/sim/ast";
import { explore } from "../../core/src/sim/explore";
import type { Lesson } from "./lessons";
import type { Outcome } from "./shared";

/** Returns undefined when the task is done, or a short reason why it is not. */
export function checkLesson(lesson: Lesson, src: string, o: Outcome, inputs: Record<string, string>): string | undefined {
  const c = lesson.check;
  if (!c) return o.ok ? undefined : "Run it without errors to finish this lesson.";
  if (!o.ok) return "It has to run without errors first.";
  if (c.returns !== undefined && !o.returns.some((r) => (c.returns === "Coin" ? r.text.includes("Coin") : r.text === c.returns)))
    return c.returns === "Coin" ? "It runs, but it should hand back the coin." : `It runs, but it should hand back ${c.returns}. It handed back ${o.returns.map((r) => r.text).join(", ") || "nothing"}.`;
  if (c.console !== undefined && !o.console.some((l) => l.includes(c.console!))) return `It runs, but nothing printed contains “${c.console}”.`;
  if (c.messages !== undefined && o.messages < c.messages) return `It runs, but only ${o.messages} message${o.messages === 1 ? " was" : "s were"} sent. The task needs ${c.messages}.`;
  if (c.hunt) {
    const h = explore(buildAst(src), inputs, { budgetMs: 700 });
    if (h.findings.length) {
      const f = h.findings[0];
      const withInputs = f.inputs.map((i) => `${i.name} = ${i.text}`).join(", ");
      return `It works for these inputs, but a bug hunt found a failure${withInputs ? ` with ${withInputs}` : ""}: ${f.message}`;
    }
  }
  return undefined;
}
