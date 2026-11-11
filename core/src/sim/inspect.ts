// Static views of a program: protocol scripts with a duality check, and the architecture wiring.
import type { Program, Decl, Session, TypeExpr } from "./ast";
import { renderType, Simulator } from "./interp";
import type { TraceEvent } from "./interp";

export interface ScriptLine { depth: number; text: string; kind: "send" | "receive" | "select" | "offer" | "branch" | "end" | "loop" | "continue" | "ref" }
export interface ProtocolView { name: string; roles: { name: string; lines: ScriptLine[] }[]; mismatches: string[] }
export interface ArchView {
  name: string;
  instances: { name: string; component: string; process: boolean }[];
  sessions: { name: string; protocol: string; ends: { role: string; owner: string }[] }[];
  entries: { name: string; type: string; to: string[] }[];
}

function script(s: Session, depth: number, out: ScriptLine[], index?: Map<Session, number>): ScriptLine[] {
  index?.set(s, out.length);
  switch (s.k) {
    case "send": case "receive":
      out.push({ depth, kind: s.k, text: `${s.k} ${s.param.name} : ${renderType(s.param.type)}` });
      return script(s.cont, depth, out, index);
    case "select": case "offer":
      out.push({ depth, kind: s.k, text: s.k === "select" ? "choose one:" : "peer chooses:" });
      for (const b of s.branches) {
        out.push({ depth: depth + 1, kind: "branch", text: b.label + (b.params.length ? `(${b.params.map((p) => `${p.name} : ${renderType(p.type)}`).join(", ")})` : "") });
        script(b.cont, depth + 2, out, index);
      }
      return out;
    case "end": out.push({ depth, kind: "end", text: `end ${s.name}` }); return out;
    case "rec": out.push({ depth, kind: "loop", text: `loop ${s.name}:` }); return script(s.body, depth + 1, out, index);
    case "continue": out.push({ depth, kind: "continue", text: `back to ${s.name}` }); return out;
    case "ref": out.push({ depth, kind: "ref", text: s.name }); return out;
  }
}

const sameType = (a: TypeExpr, b: TypeExpr) => renderType(a) === renderType(b);

/** Structural duality: every send faces a receive of the same type, every select an offer with the same labels. */
function dual(a: Session, b: Session, ra: string, rb: string, path: string, out: string[]): void {
  if (out.length >= 4) return;
  const at = path ? ` (${path})` : "";
  if ((a.k === "send" && b.k === "receive") || (a.k === "receive" && b.k === "send")) {
    if (!sameType(a.param.type, b.param.type)) out.push(`${ra} ${a.k}s \`${renderType(a.param.type)}\` but ${rb} ${b.k}s \`${renderType(b.param.type)}\`${at}.`);
    return dual(a.cont, b.cont, ra, rb, path, out);
  }
  if ((a.k === "select" && b.k === "offer") || (a.k === "offer" && b.k === "select")) {
    const la = a.branches.map((x) => x.label), lb = b.branches.map((x) => x.label);
    for (const l of la) if (!lb.includes(l)) out.push(`${ra} has branch \`${l}\` but ${rb} does not${at}.`);
    for (const l of lb) if (!la.includes(l)) out.push(`${rb} has branch \`${l}\` but ${ra} does not${at}.`);
    for (const x of a.branches) {
      const y = b.branches.find((z) => z.label === x.label);
      if (!y) continue;
      if (x.params.length !== y.params.length || x.params.some((p, i) => !sameType(p.type, y.params[i].type))) out.push(`Branch \`${x.label}\` carries different values on each side${at}.`);
      dual(x.cont, y.cont, ra, rb, path ? `${path} → ${x.label}` : `after ${x.label}`, out);
    }
    return;
  }
  if (a.k === "end" && b.k === "end") return;
  if (a.k === "rec" && b.k === "rec") return dual(a.body, b.body, ra, rb, path, out);
  if (a.k === "continue" && b.k === "continue") return;
  if (a.k === "ref" || b.k === "ref") return;
  const say = (s: Session) => (s.k === "rec" ? "starts a loop" : s.k === "continue" ? "loops back" : s.k === "end" ? "ends" : s.k === "select" ? "chooses" : s.k === "offer" ? "waits for a choice" : `${s.k}s`);
  out.push(a.k === b.k && (a.k === "send" || a.k === "receive" || a.k === "select" || a.k === "offer")
    ? `Both roles ${a.k === "receive" ? "wait to receive" : a.k === "send" ? "try to send" : a.k === "offer" ? "wait for the other to choose" : "try to choose"} at the same step${at}, so neither can go first.`
    : `${ra} ${say(a)} where ${rb} ${say(b)}${at}.`);
}

export function protocolViews(program: Program): ProtocolView[] {
  return program.decls.filter((d): d is Extract<Decl, { k: "protocol" }> => d.k === "protocol").map((p) => {
    const mismatches: string[] = [];
    if (p.roles.length === 2) dual(p.roles[0].session, p.roles[1].session, p.roles[0].name, p.roles[1].name, "", mismatches);
    return { name: p.name, roles: p.roles.map((r) => ({ name: r.name, lines: script(r.session, 0, []) })), mismatches };
  });
}

export function architectureView(program: Program): ArchView | undefined {
  const target = new Simulator(program).runTarget();
  if (!target || target.kind !== "architecture") return undefined;
  const a = target.decl;
  const processes = new Set(a.items.flatMap((i) => (i.k === "process" ? [i.target] : [])));
  const view: ArchView = { name: a.name, instances: [], sessions: [], entries: [] };
  for (const i of a.items) {
    if (i.k === "instance") view.instances.push({ name: i.name, component: i.target, process: processes.has(i.name) });
    else if (i.k === "protocol") view.sessions.push({ name: i.name, protocol: i.target, ends: [] });
    else if (i.k === "entry") view.entries.push({ name: i.name, type: renderType(i.type), to: [] });
  }
  for (const i of a.items) {
    if (i.k === "role") view.sessions.find((s) => s.name === i.path[0])?.ends.push({ role: i.path[1] ?? "?", owner: i.target === "external" ? "external" : i.target.join(".") });
    else if (i.k === "bind" && i.from.length === 1) view.entries.find((e) => e.name === i.from[0])?.to.push(i.to[0]);
  }
  for (const e of target.program?.entries ?? []) view.entries.push({ name: e.name, type: renderType(e.type), to: [] });
  return view;
}

export interface RolePosition { role: string; owner: string; lines: ScriptLine[]; current: number; closed: boolean }
export interface SessionPosition { session: string; protocol: string; roles: RolePosition[] }

/** Replays trace events to find where each role stands in its protocol script. */
export function protocolPositions(program: Program, trace: TraceEvent[], upto: number): SessionPosition[] {
  const arch = architectureView(program);
  if (!arch) return [];
  const out: SessionPosition[] = [];
  for (const sess of arch.sessions) {
    const proto = program.decls.find((d): d is Extract<Decl, { k: "protocol" }> => d.k === "protocol" && d.name === sess.protocol);
    if (!proto) continue;
    const state = proto.roles.map((r) => {
      const index = new Map<Session, number>();
      const lines = script(r.session, 0, [], index);
      const owner = sess.ends.find((e) => e.role === r.name)?.owner ?? "?";
      return { role: r.name, owner: owner === "external" ? `external ${r.name}` : owner, lines, index, cur: r.session as Session, recs: new Map<string, Session>(), closed: false };
    });
    const norm = (st: (typeof state)[number]): Session => {
      for (let i = 0; i < 50; i++) {
        if (st.cur.k === "rec") { st.recs.set(st.cur.name, st.cur); st.cur = st.cur.body; }
        else if (st.cur.k === "continue") { const r = st.recs.get(st.cur.name); if (!r || r.k !== "rec") break; st.cur = r.body; }
        else break;
      }
      return st.cur;
    };
    const by = (proc: string) => state.find((x) => x.owner === proc);
    const branch = (st: (typeof state)[number] | undefined, label: string) => {
      if (!st) return;
      const c = norm(st);
      if (c.k === "select" || c.k === "offer") { const b = c.branches.find((x) => x.label === label); if (b) st.cur = b.cont; }
    };
    const advance = (st: (typeof state)[number] | undefined, kind: "send" | "receive") => {
      if (!st) return;
      const c = norm(st);
      if (c.k === kind) st.cur = c.cont;
    };
    for (let i = 0; i <= upto && i < trace.length; i++) {
      const t = trace[i];
      if (t.kind === "message" && t.session === sess.name) { advance(by(t.from), "send"); advance(by(t.to), "receive"); }
      else if (t.kind === "select" && t.session === sess.name) { branch(by(t.from), t.label); branch(by(t.to), t.label); }
      else if (t.kind === "close" && t.session === sess.name) { const st = state.find((x) => x.role === t.role); if (st) st.closed = true; }
    }
    out.push({ session: sess.name, protocol: sess.protocol, roles: state.map((st) => ({ role: st.role, owner: st.owner, lines: st.lines, current: st.index.get(norm(st)) ?? -1, closed: st.closed })) });
  }
  return out;
}
