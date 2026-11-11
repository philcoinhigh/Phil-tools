// Experimental Phil simulator.
//
// This is NOT an official Phil semantics. It executes Grammar-v1 programs by
// following the design in the Phil tour and Phase 1 documents, and it checks at
// runtime what the real Phil checker establishes statically:
//   - linear values must be used exactly once, affine values at most once;
//   - session endpoints follow their protocol, step by step, and must be closed;
//   - fixed-width arithmetic never wraps (overflow, underflow and division by zero trap);
//   - requires / ensures / refinement types / loop and join invariants / prove(...) hold.
// Processes run as coroutines under a deterministic round-robin scheduler with
// synchronous rendezvous for send/receive and select/offer.

import type {
  Program, Decl, Expr, Stmt, Block, Pattern, Prop, TypeExpr, Session, Span, Arm, Param, Mode, ArchItem,
} from "./ast";

// ------------------------------------------------------------------ values

export type Val =
  | { k: "int"; v: bigint; bits: number | null; signed: boolean }
  | { k: "float"; v: number; bits: 32 | 64 | null }
  | { k: "bool"; v: boolean }
  | { k: "unit" }
  | { k: "string"; v: string }
  | { k: "char"; v: string }
  | { k: "tuple"; elems: Val[] }
  | { k: "record"; type: string; fields: Map<string, Val>; oid?: number }
  | { k: "variant"; type: string; tag: string; payload: Val[]; fields?: Map<string, Val>; oid?: number }
  | { k: "bytes"; id: number }
  | { k: "endpoint"; id: number; session: SessionInst; role: string; state: Session; rec: Map<string, Session> }
  | { k: "closure"; params: Param[]; block: Block; env: Env; mode: Mode; satisfies: string; name: string }
  | { k: "fnref"; name: string }
  | { k: "view"; of: Val; borrowId: number }
  | { k: "proof"; text: string };

export interface SessionInst { id: number; name: string; protocol: string; roles: string[]; closed: Set<string>; owners: Map<string, string> }

export type ErrorKind = "linearity" | "contract" | "protocol" | "arithmetic" | "deadlock" | "wiring" | "runtime" | "unsupported" | "limit";

export class SimError extends Error {
  constructor(readonly kind: ErrorKind, message: string, readonly span?: Span, public process?: string, readonly hint?: string) { super(message); }
}

class ReturnSignal { constructor(readonly value: Val) {} }
class ContinueSignal { constructor(readonly values: Val[], readonly span: Span) {} }
class BreakSignal { constructor(readonly values: Val[], readonly span: Span) {} }
class NegativeOutcome { constructor(readonly value: Val, readonly span: Span) {} }
class FatalSignal { constructor(readonly target: string, readonly args: Val[], readonly span: Span) {} }

// ------------------------------------------------------------------ trace

export type TraceEvent =
  | { kind: "start"; proc: string; detail: string }
  | { kind: "message"; from: string; to: string; session: string; text: string; step: number; span?: Span }
  | { kind: "select"; from: string; to: string; session: string; label: string; text: string; step: number; span?: Span }
  | { kind: "close"; proc: string; session: string; role: string; step: number; span?: Span }
  | { kind: "console"; proc: string; text: string; step: number; span?: Span }
  | { kind: "check"; proc: string; what: string; text: string; step: number; span?: Span }
  | { kind: "assume"; proc: string; text: string; step: number; span?: Span }
  | { kind: "return"; proc: string; text: string; step: number }
  | { kind: "reject"; proc: string; text: string; step: number }
  | { kind: "fail"; proc: string; text: string; step: number; span?: Span }
  | { kind: "own"; op: "create" | "consume" | "move"; oid: number; proc: string; to?: string; text: string; step: number; span?: Span };

export interface RunResult {
  ok: boolean;
  error?: SimError;
  trace: TraceEvent[];
  processes: { name: string; component: string; status: string; external?: boolean }[];
  sessions: { name: string; protocol: string; roles: { role: string; owner: string }[] }[];
  checks: number;
  steps: number;
}

export interface EntryInfo { name: string; type: TypeExpr; typeText: string; source: string }

// ------------------------------------------------------------------ environment

interface Slot { name: string; value: Val; moved?: Span; borrowed: number; declSpan?: Span }

export class Env {
  vars = new Map<string, Slot>();
  constructor(readonly parent?: Env) {}
  lookup(name: string): Slot | undefined {
    for (let e: Env | undefined = this; e; e = e.parent) { const s = e.vars.get(name); if (s) return s; }
    return undefined;
  }
}

type Req =
  | { op: "send"; ep: Extract<Val, { k: "endpoint" }>; value: Val; span: Span }
  | { op: "recv"; ep: Extract<Val, { k: "endpoint" }>; span: Span }
  | { op: "select"; ep: Extract<Val, { k: "endpoint" }>; label: string; args: Val[]; span: Span }
  | { op: "offer"; ep: Extract<Val, { k: "endpoint" }>; span: Span };

type Gen<T> = Generator<Req, T, unknown>;

const MODE_RANK: Record<Mode, number> = { unrestricted: 0, affine: 1, linear: 2 };
const maxMode = (a: Mode, b: Mode): Mode => (MODE_RANK[a] >= MODE_RANK[b] ? a : b);

export const HOST_OPERATIONS: Record<string, string> = {
  console_write: "console_write(value) — print a value to the console (used by the Phil handoff examples)",
  lt: "lt(a, b) — a < b, as a Bool",
  le: "le(a, b) — a ≤ b, as a Bool",
  gt: "gt(a, b) — a > b, as a Bool",
  ge: "ge(a, b) — a ≥ b, as a Bool",
  eq: "eq(a, b) — a == b, as a Bool",
  ne: "ne(a, b) — a != b, as a Bool",
};

// ------------------------------------------------------------------ rendering

export function renderType(t: TypeExpr | undefined): string {
  if (!t) return "?";
  switch (t.k) {
    case "unit": return "Unit";
    case "bool": return "Bool";
    case "char": return "Char";
    case "string": return "String";
    case "float": return `F${t.bits}`;
    case "int": return `${t.signed ? "I" : "U"}${t.bits}`;
    case "bytes": return "Bytes";
    case "proof": return "Proof[…]";
    case "named": return t.args.length ? `${t.name}[${t.args.map((a) => (a.k === "type" ? renderType(a.type) : "…")).join(", ")}]` : t.name;
    case "refine": return `{${t.v} : ${renderType(t.base)} | …}`;
    case "tuple": return `(${t.elems.map(renderType).join(", ")})`;
    case "opaque": return t.text;
  }
}

function renderSession(s: Session): string {
  switch (s.k) {
    case "send": case "receive": return `${s.k} (${s.param.name} : ${renderType(s.param.type)}) then …`;
    case "select": case "offer": return `${s.k} { ${s.branches.map((b) => b.label).join(" | ")} }`;
    case "end": return `end ${s.name}`;
    case "rec": return `recursive ${s.name} = …`;
    case "continue": return `continue ${s.name}`;
    case "ref": return s.name;
  }
}

export function renderVal(v: Val, depth = 0): string {
  if (depth > 4) return "…";
  switch (v.k) {
    case "int": return v.v.toString();
    case "float": return Number.isInteger(v.v) ? v.v.toFixed(1) : String(v.v);
    case "bool": return String(v.v);
    case "unit": return "unit";
    case "string": return JSON.stringify(v.v);
    case "char": return `'${v.v}'`;
    case "tuple": return `(${v.elems.map((e) => renderVal(e, depth + 1)).join(", ")})`;
    case "record": return `${v.type} { ${[...v.fields].map(([k, x]) => `${k} = ${renderVal(x, depth + 1)}`).join(", ")} }`;
    case "variant":
      if (v.fields) return `${v.tag} { ${[...v.fields].map(([k, x]) => `${k} = ${renderVal(x, depth + 1)}`).join(", ")} }`;
      return v.payload.length ? `${v.tag}(${v.payload.map((e) => renderVal(e, depth + 1)).join(", ")})` : v.tag;
    case "endpoint": return `endpoint ${v.session.name}.${v.role}`;
    case "closure": return `closure ${v.name}`;
    case "fnref": return `fn ${v.name}`;
    case "view": return `view of ${renderVal(v.of, depth + 1)}`;
    case "proof": return `proof`;
    case "bytes": return `Bytes#${v.id}`;
  }
}

function describeVal(v: Val): string {
  switch (v.k) {
    case "endpoint": return `endpoint ${v.session.name}.${v.role}`;
    case "record": return v.type;
    case "variant": return `${v.type}.${v.tag}`;
    case "closure": return "closure";
    default: return v.k;
  }
}

// ------------------------------------------------------------------ interpreter

interface Ctx { proc: string; env: Env; ghost: boolean }

export class Simulator {
  readonly decls = new Map<string, Decl>();
  readonly variants = new Map<string, { data: Extract<Decl, { k: "data" }>; variant: Extract<Decl, { k: "data" }>["variants"][number] }[]>();
  readonly roleProtocol = new Map<string, string[]>(); // role name -> protocols declaring it
  private modeCache = new Map<string, Mode>();
  readonly trace: TraceEvent[] = [];
  steps = 0;
  checks = 0;
  private nextId = 1;
  private nextBorrow = 1;
  readonly stepLimit: number;

  constructor(readonly program: Program, opts: { stepLimit?: number } = {}) {
    this.stepLimit = opts.stepLimit ?? 500_000;
    for (const d of program.decls) {
      if (d.k === "other") continue;
      this.decls.set(d.name, d);
      if (d.k === "data") for (const v of d.variants) {
        const list = this.variants.get(v.name) ?? [];
        list.push({ data: d, variant: v });
        this.variants.set(v.name, list);
      }
      if (d.k === "protocol") for (const r of d.roles) {
        const list = this.roleProtocol.get(r.name) ?? [];
        list.push(d.name);
        this.roleProtocol.set(r.name, list);
      }
    }
  }

  fresh(): number { return this.nextId++; }
  /** Give a newly built restricted value an identity so its ownership can be followed. */
  born<T extends Val>(ctx: Ctx, v: T, span: Span): T {
    if (!ctx.ghost && (v.k === "record" || v.k === "variant") && this.valMode(v) !== "unrestricted") {
      v.oid = this.nextId++;
      this.trace.push({ kind: "own", op: "create", oid: v.oid, proc: ctx.proc, text: renderVal(v), step: this.steps, span });
    }
    return v;
  }
  gone(ctx: Ctx, v: Val, how: string, span: Span): void {
    if (!ctx.ghost && (v.k === "record" || v.k === "variant") && v.oid !== undefined) {
      this.trace.push({ kind: "own", op: "consume", oid: v.oid, proc: ctx.proc, text: how, step: this.steps, span });
    }
  }
  oidsIn(v: Val, out: number[] = []): number[] {
    if (v.k === "record" || v.k === "variant") {
      if (v.oid !== undefined) out.push(v.oid);
      for (const x of v.k === "record" ? v.fields.values() : v.payload) this.oidsIn(x, out);
    } else if (v.k === "tuple") v.elems.forEach((x) => this.oidsIn(x, out));
    return out;
  }

  line(span?: Span): number { return span ? this.program.source.slice(0, span[0]).split("\n").length : 0; }
  text(span: Span): string { return this.program.source.slice(span[0], span[1]).replace(/\s+/g, " ").trim(); }

  static readonly TRACE_LIMIT = 5000;

  tick(span: Span): void {
    if (this.trace.length > Simulator.TRACE_LIMIT) this.trace.splice(Simulator.TRACE_LIMIT / 2, this.trace.length - Simulator.TRACE_LIMIT);
    if (++this.steps > this.stepLimit) {
      throw new SimError("limit", `Step limit of ${this.stepLimit.toLocaleString()} evaluation steps reached. The program may loop forever.`, span,
        undefined, "Phil loops only end through `break`; check the loop's exit condition.");
    }
  }

  // ---------------------------------------------------------------- modes

  typeMode(t: TypeExpr | undefined, seen = new Set<string>()): Mode {
    if (!t) return "unrestricted";
    switch (t.k) {
      case "tuple": return t.elems.reduce<Mode>((m, e) => maxMode(m, this.typeMode(e, seen)), "unrestricted");
      case "refine": return this.typeMode(t.base, seen);
      case "named": return this.namedMode(t.name, seen);
      case "bytes": return "linear"; // Bytes[N] is intrinsically Linear in Phil
      default: return "unrestricted";
    }
  }
  namedMode(name: string, seen = new Set<string>()): Mode {
    const cached = this.modeCache.get(name);
    if (cached) return cached;
    if (seen.has(name)) return "unrestricted";
    seen.add(name);
    const d = this.decls.get(name);
    let mode: Mode = "unrestricted";
    if (!d) {
      if (this.roleProtocol.has(name)) mode = "linear"; // endpoint type Role[Protocol]
    } else if (d.k === "record") {
      mode = d.fields.reduce<Mode>((m, f) => maxMode(m, this.typeMode(f.type, seen)), d.mode ?? "unrestricted");
    } else if (d.k === "data") {
      mode = d.mode ?? "unrestricted";
      for (const v of d.variants) {
        for (const t of v.tuple ?? []) mode = maxMode(mode, this.typeMode(t, seen));
        for (const f of v.fields ?? []) mode = maxMode(mode, this.typeMode(f.type, seen));
      }
    } else if (d.k === "type") mode = this.typeMode(d.type, seen);
    else if (d.k === "capability") mode = d.mode;
    this.modeCache.set(name, mode);
    return mode;
  }
  valMode(v: Val): Mode {
    switch (v.k) {
      case "record": return this.namedMode(v.type);
      case "variant": return this.namedMode(v.type);
      case "endpoint": return "linear";
      case "bytes": return "linear";
      case "closure": return v.mode;
      case "tuple": return v.elems.reduce<Mode>((m, e) => maxMode(m, this.valMode(e)), "unrestricted");
      default: return "unrestricted";
    }
  }

  // ---------------------------------------------------------------- variables

  declare(ctx: Ctx, name: string, value: Val, span: Span): void {
    const existing = ctx.env.vars.get(name);
    if (existing && !existing.moved && this.valMode(existing.value) === "linear" && !ctx.ghost) {
      throw new SimError("linearity", `\`${name}\` is rebound while it still holds an unconsumed linear value (${describeVal(existing.value)}). The old value would be silently lost.`, span, ctx.proc);
    }
    ctx.env.vars.set(name, { name, value, borrowed: 0, declSpan: span });
  }

  use(ctx: Ctx, name: string, span: Span): Val {
    const slot = ctx.env.lookup(name);
    if (!slot) throw new SimError("runtime", `Unknown name \`${name}\`.`, span, ctx.proc);
    if (ctx.ghost) return slot.value;
    const mode = this.valMode(slot.value);
    if (slot.moved) {
      const what = mode === "linear" ? "linear" : "affine";
      throw new SimError("linearity", `\`${name}\` was already consumed on line ${this.line(slot.moved)} and cannot be used again (${what} ${describeVal(slot.value)}).`, span, ctx.proc,
        slot.value.k === "endpoint" ? "Each protocol step consumes the endpoint and returns its successor: use the new name the step returned." : "Linear and affine values have exactly one owner. Use the value once, or restructure so only one path consumes it.");
    }
    if (mode !== "unrestricted") {
      if (slot.borrowed > 0) throw new SimError("linearity", `\`${name}\` cannot be consumed while it is borrowed.`, span, ctx.proc);
      slot.moved = span;
    }
    return slot.value;
  }

  /** Report linear values left unconsumed in a scope. */
  checkDrops(ctx: Ctx, env: Env, span: Span, except: Set<string> = new Set()): void {
    if (ctx.ghost) return;
    for (const slot of env.vars.values()) {
      if (slot.moved || except.has(slot.name)) continue;
      if (this.valMode(slot.value) === "linear") {
        const v = slot.value;
        const hint = v.k === "endpoint"
          ? (this.endpointAtEnd(v) ? `Close it with \`close ${slot.name};\`.` : `Its protocol is not finished: the next step is \`${renderSession(this.unfold(v).state)}\`.`)
          : "Pass it on, return it, destructure it, or `release` it explicitly.";
        throw new SimError("linearity", `Linear value \`${slot.name}\` (${describeVal(v)}) was never consumed: it would be silently dropped here.`, span, ctx.proc, hint);
      }
    }
  }

  // ---------------------------------------------------------------- types

  resolveAlias(t: TypeExpr): TypeExpr {
    let cur = t;
    for (let i = 0; i < 20 && cur.k === "named"; i++) {
      const d = this.decls.get(cur.name);
      if (d && d.k === "type") cur = d.type; else break;
    }
    return cur;
  }

  *coerce(ctx: Ctx, v: Val, t: TypeExpr | undefined, what: string, span: Span): Gen<Val> {
    if (!t) return v;
    const ty = this.resolveAlias(t);
    const mismatch = () => new SimError("runtime", `${what}: expected a value of type \`${renderType(t)}\`, got ${describeVal(v)} \`${renderVal(v)}\`.`, span, ctx.proc);
    switch (ty.k) {
      case "int": {
        if (v.k !== "int") throw mismatch();
        if (v.bits !== null && (v.bits !== ty.bits || v.signed !== ty.signed)) {
          throw new SimError("arithmetic", `${what}: expected \`${renderType(ty)}\` but got a \`${v.signed ? "I" : "U"}${v.bits}\`. Phil never converts integer widths implicitly.`, span, ctx.proc, `Use \`convert value to ${renderType(ty)}\`.`);
        }
        return this.checkRange({ k: "int", v: v.v, bits: ty.bits, signed: ty.signed }, `${what}: ${v.v} does not fit in \`${renderType(ty)}\``, span, ctx);
      }
      case "float":
        if (v.k === "float") return { k: "float", v: ty.bits === 32 ? Math.fround(v.v) : v.v, bits: ty.bits };
        throw mismatch();
      case "bool": if (v.k !== "bool") throw mismatch(); return v;
      case "bytes": if (v.k !== "bytes") throw mismatch(); return v;
      case "unit": if (v.k !== "unit") throw mismatch(); return v;
      case "string": if (v.k !== "string") throw mismatch(); return v;
      case "char": if (v.k !== "char") throw mismatch(); return v;
      case "tuple": {
        if (v.k !== "tuple" || v.elems.length !== ty.elems.length) throw mismatch();
        const elems: Val[] = [];
        for (let i = 0; i < ty.elems.length; i++) elems.push(yield* this.coerce(ctx, v.elems[i], ty.elems[i], what, span));
        return { k: "tuple", elems };
      }
      case "refine": {
        const base = yield* this.coerce(ctx, v, ty.base, what, span);
        const env = new Env(ctx.env);
        env.vars.set(ty.v, { name: ty.v, value: base, borrowed: 0 });
        const ok = this.evalPropSync({ ...ctx, env, ghost: true }, ty.prop);
        this.checks++;
        this.trace.push({ kind: "check", proc: ctx.proc, what: "refinement", text: `${renderVal(base)} satisfies ${this.text(ty.prop.span)}`, step: this.steps, span });
        if (!ok) throw new SimError("contract", `${what}: the value ${renderVal(base)} violates the refinement \`${this.text(ty.prop.span).replace(new RegExp(`\\b${ty.v}\\b`, "g"), ty.v)}\`.`, span, ctx.proc,
          "Refinement types are checked statically by Phil; the simulator checks them when a value is bound.");
        return base;
      }
      case "named": {
        const d = this.decls.get(ty.name);
        if (d?.k === "record") { if (v.k !== "record" || v.type !== ty.name) throw mismatch(); return v; }
        if (d?.k === "data") { if (v.k !== "variant" || v.type !== ty.name) throw mismatch(); return v; }
        if (!d && this.roleProtocol.has(ty.name)) {
          if (v.k !== "endpoint" || v.role !== ty.name) throw mismatch();
          const proto = ty.args[0]?.k === "type" && ty.args[0].type.k === "named" ? ty.args[0].type.name : undefined;
          if (proto && v.session.protocol !== proto) throw mismatch();
          return v;
        }
        return v;
      }
      default: return v;
    }
  }

  checkRange(v: Extract<Val, { k: "int" }>, message: string, span: Span, ctx: Ctx): Val {
    if (v.bits === null) return v;
    const min = v.signed ? -(1n << BigInt(v.bits - 1)) : 0n;
    const max = v.signed ? (1n << BigInt(v.bits - 1)) - 1n : (1n << BigInt(v.bits)) - 1n;
    if (v.v < min || v.v > max) {
      throw new SimError("arithmetic", `${message} (range ${min}…${max}).`, span, ctx.proc,
        "Phil arithmetic is language semantics, not host behaviour: values never wrap around silently.");
    }
    return v;
  }

  // ---------------------------------------------------------------- statements

  *evalBlock(ctx: Ctx, block: Block, keepLast = false): Gen<Val> {
    const env = new Env(ctx.env);
    const inner: Ctx = { ...ctx, env };
    let last: Val = { k: "unit" };
    try {
      for (let i = 0; i < block.stmts.length; i++) {
        const s = block.stmts[i];
        const isLast = i === block.stmts.length - 1;
        last = yield* this.evalStmt(inner, s, keepLast && isLast);
      }
    } catch (sig) {
      // Leaving a block early still drops its locals.
      if (sig instanceof ReturnSignal || sig instanceof ContinueSignal || sig instanceof BreakSignal) {
        this.checkDrops(inner, env, sig instanceof ReturnSignal ? [block.span[1] - 1, block.span[1]] : sig.span);
      }
      throw sig;
    }
    this.checkDrops(inner, env, [block.span[1] - 1, block.span[1]]);
    return keepLast ? last : { k: "unit" };
  }

  *evalStmt(ctx: Ctx, s: Stmt, keep: boolean): Gen<Val> {
    this.tick(s.span);
    switch (s.k) {
      case "let": {
        const v = yield* this.evalExpr(ctx, s.value);
        yield* this.bindPattern(ctx, s.pattern, v);
        return { k: "unit" };
      }
      case "return": {
        const v = yield* this.evalExpr(ctx, s.value);
        throw new ReturnSignal(v);
      }
      case "expr": {
        const v = yield* this.evalExpr(ctx, s.value);
        if (!keep && !ctx.ghost && this.valMode(v) === "linear") {
          throw new SimError("linearity", `This statement produces a linear value (${describeVal(v)}) and then discards it.`, s.span, ctx.proc,
            v.k === "endpoint" ? "Bind the successor endpoint with `let next = …;` and keep following the protocol." : "Bind it with `let` and consume it.");
        }
        return v;
      }
    }
  }

  *bindPattern(ctx: Ctx, p: Pattern, v: Val): Gen<void> {
    switch (p.k) {
      case "id": this.declare(ctx, p.name, v, p.span); return;
      case "tuple":
        if (v.k !== "tuple" || v.elems.length !== p.elems.length) {
          throw new SimError("runtime", `Cannot destructure ${describeVal(v)} \`${renderVal(v)}\` with a ${p.elems.length}-element tuple pattern.`, p.span, ctx.proc);
        }
        for (let i = 0; i < p.elems.length; i++) yield* this.bindPattern(ctx, p.elems[i], v.elems[i]);
        return;
      case "record": {
        const fields = v.k === "record" && (v.type === p.type || p.type.endsWith("." + v.type)) ? v.fields
          : v.k === "variant" && v.fields && v.tag === p.type.split(".").pop() ? v.fields : undefined;
        if (!fields) throw new SimError("runtime", `Cannot destructure ${describeVal(v)} with a \`${p.type} { … }\` pattern.`, p.span, ctx.proc);
        this.gone(ctx, v, "destructured", p.span);
        const named = new Set(p.fields.map((f) => f.name));
        for (const [name, fv] of fields) {
          if (!named.has(name) && this.valMode(fv) === "linear") {
            throw new SimError("linearity", `The pattern leaves out field \`${name}\`, which holds a linear value; it would be dropped.`, p.span, ctx.proc);
          }
        }
        for (const f of p.fields) {
          const fv = fields.get(f.name);
          if (!fv) throw new SimError("runtime", `\`${p.type}\` has no field \`${f.name}\`.`, f.span, ctx.proc);
          if (f.pattern) yield* this.bindPattern(ctx, f.pattern, fv);
          else this.declare(ctx, f.name, fv, f.span);
        }
        return;
      }
    }
  }

  // ---------------------------------------------------------------- expressions

  *evalExpr(ctx: Ctx, e: Expr): Gen<Val> {
    this.tick(e.span);
    switch (e.k) {
      case "int": return { k: "int", v: e.value, bits: null, signed: false };
      case "float": return { k: "float", v: e.value, bits: null };
      case "string": return { k: "string", v: e.value };
      case "char": return { k: "char", v: e.value };
      case "bool": return { k: "bool", v: e.value };
      case "unit": return { k: "unit" };
      case "name": return this.evalName(ctx, e.path, e.span);
      case "field": {
        const target = yield* this.evalObserve(ctx, e.target);
        return this.fieldOf(ctx, target, e.name, e.span, "expression");
      }
      case "tuple": {
        const elems: Val[] = [];
        for (const x of e.elems) elems.push(yield* this.evalExpr(ctx, x));
        return { k: "tuple", elems };
      }
      case "binop": {
        const l = yield* this.evalExpr(ctx, e.l);
        const r = yield* this.evalExpr(ctx, e.r);
        return this.arith(ctx, e.op, l, r, e.span);
      }
      case "neg": {
        const v = yield* this.evalExpr(ctx, e.e);
        if (v.k === "float") return { ...v, v: -v.v };
        if (v.k !== "int") throw new SimError("runtime", `Cannot negate ${describeVal(v)}.`, e.span, ctx.proc);
        if (v.bits !== null && !v.signed && v.v !== 0n) {
          throw new SimError("arithmetic", `Cannot negate the unsigned value ${v.v} (\`U${v.bits}\`).`, e.span, ctx.proc, "Convert to a signed type first.");
        }
        return this.checkRange({ ...v, v: -v.v }, `Negation overflows`, e.span, ctx);
      }
      case "call": return yield* this.evalCall(ctx, e);
      case "construct": return yield* this.evalConstruct(ctx, e);
      case "borrow": return yield* this.evalBorrow(ctx, e);
      case "if": {
        const c = yield* this.evalExpr(ctx, e.cond);
        if (c.k !== "bool") throw new SimError("runtime", `\`if\` needs a Bool condition, got ${describeVal(c)}.`, e.cond.span, ctx.proc);
        const branch = c.v ? e.then : e.else;
        if (!branch) {
          if (e.join) throw new SimError("runtime", "An `if` with a join needs an `else` branch to supply the join state.", e.span, ctx.proc);
          return { k: "unit" };
        }
        const v = yield* this.evalBlock(ctx, branch, !!e.join);
        if (e.join) yield* this.bindJoin(ctx, e.join, v, branch.span);
        return { k: "unit" };
      }
      case "match": case "decide": return yield* this.evalMatch(ctx, e);
      case "closure": {
        const env = new Env();
        for (const name of e.captures ?? []) {
          const v = this.use(ctx, name, e.span);
          env.vars.set(name, { name, value: v, borrowed: 0 });
        }
        let mode: Mode = (e.mode as Mode | undefined) ?? "unrestricted";
        for (const s of env.vars.values()) mode = maxMode(mode, this.valMode(s.value));
        return { k: "closure", params: e.params, block: e.block, env, mode, satisfies: e.satisfies, name: `closure@${this.line(e.span)}` };
      }
      case "loop": return yield* this.evalLoop(ctx, e);
      case "continue": case "break": {
        const vals: Val[] = [];
        for (const a of e.args) vals.push(yield* this.evalExpr(ctx, a));
        throw e.k === "continue" ? new ContinueSignal(vals, e.span) : new BreakSignal(vals, e.span);
      }
      case "send": {
        const value = yield* this.evalExpr(ctx, e.value);
        const ep = yield* this.evalEndpoint(ctx, e.on, "send");
        const state = this.unfold(ep);
        if (state.state.k !== "send") throw this.protocolError(ctx, ep, state.state, "send", e.span);
        const coerced = yield* this.coerce(ctx, value, state.state.param.type, `Message \`${state.state.param.name}\` of ${ep.session.name}.${ep.role}`, e.span);
        yield { op: "send", ep, value: coerced, span: e.span };
        return this.successor(ep, state.state.cont, state.rec);
      }
      case "receive": {
        const ep = yield* this.evalEndpoint(ctx, e.on, "receive");
        const state = this.unfold(ep);
        if (state.state.k !== "receive") throw this.protocolError(ctx, ep, state.state, "receive", e.span);
        const declared = renderType(this.resolveAlias(state.state.param.type));
        const asked = renderType(this.resolveAlias(e.type));
        if (declared !== asked) {
          throw new SimError("protocol", `Protocol mismatch on ${ep.session.name}.${ep.role}: this step receives \`${state.state.param.name} : ${declared}\`, but the code receives \`${asked}\`.`, e.span, ctx.proc);
        }
        const value = (yield { op: "recv", ep, span: e.span }) as Val;
        return { k: "tuple", elems: [this.successor(ep, state.state.cont, state.rec), value] };
      }
      case "select": {
        const args: Val[] = [];
        for (const a of e.args) args.push(yield* this.evalExpr(ctx, a));
        const ep = yield* this.evalEndpoint(ctx, e.on, "select");
        const state = this.unfold(ep);
        if (state.state.k !== "select") throw this.protocolError(ctx, ep, state.state, `select ${e.label}`, e.span);
        const label = e.label.split(".").pop()!;
        const branch = state.state.branches.find((b) => b.label === label);
        if (!branch) {
          throw new SimError("protocol", `\`${label}\` is not a branch of this protocol step. The choices are: ${state.state.branches.map((b) => "`" + b.label + "`").join(", ")}.`, e.span, ctx.proc);
        }
        if (branch.params.length !== args.length) {
          throw new SimError("protocol", `Branch \`${label}\` carries ${branch.params.length} value(s), but ${args.length} were given.`, e.span, ctx.proc);
        }
        const coerced: Val[] = [];
        for (let i = 0; i < args.length; i++) coerced.push(yield* this.coerce(ctx, args[i], branch.params[i].type, `Branch value \`${branch.params[i].name}\``, e.span));
        yield { op: "select", ep, label, args: coerced, span: e.span };
        return this.successor(ep, branch.cont, state.rec);
      }
      case "offer": {
        const ep = yield* this.evalEndpoint(ctx, e.on, "offer");
        const state = this.unfold(ep);
        if (state.state.k !== "offer") throw this.protocolError(ctx, ep, state.state, "offer", e.span);
        const handled = new Set(e.arms.map((a) => a.pattern.path[a.pattern.path.length - 1]));
        const missing = state.state.branches.filter((b) => !handled.has(b.label)).map((b) => b.label);
        if (missing.length) {
          throw new SimError("protocol", `This \`offer\` has no arm for ${missing.map((m) => "`" + m + "`").join(", ")}, which the peer may select.`, e.span, ctx.proc, "An offer must handle every branch the protocol allows.");
        }
        const offered = state.state.branches;
        const extra = e.arms.map((a) => a.pattern.path[a.pattern.path.length - 1]).filter((l) => !offered.some((b) => b.label === l));
        if (extra.length) {
          throw new SimError("protocol", `\`${extra[0]}\` is not a branch of this protocol step. The peer can select: ${state.state.branches.map((b) => "`" + b.label + "`").join(", ")}.`, e.span, ctx.proc);
        }
        const got = (yield { op: "offer", ep, span: e.span }) as { label: string; args: Val[] };
        const branch = state.state.branches.find((b) => b.label === got.label)!;
        const arm = e.arms.find((a) => a.pattern.path[a.pattern.path.length - 1] === got.label);
        if (!arm) throw new SimError("protocol", `The peer selected \`${got.label}\`, but this \`offer\` has no arm for it.`, e.span, ctx.proc, "An offer must handle every branch the protocol allows.");
        const env = new Env(ctx.env);
        const inner: Ctx = { ...ctx, env };
        const next = this.successor(ep, branch.cont, state.rec);
        const epName = e.on.k === "name" && e.on.path.length === 1 ? e.on.path[0] : "_endpoint";
        env.vars.set(epName, { name: epName, value: next, borrowed: 0, declSpan: arm.span });
        const binders = arm.pattern.binders ?? [];
        binders.forEach((b, i) => env.vars.set(b, { name: b, value: got.args[i] ?? { k: "unit" }, borrowed: 0, declSpan: arm.span }));
        return yield* this.evalArmBody(inner, arm, env);
      }
      case "close": {
        const ep = yield* this.evalEndpoint(ctx, e.e, "close");
        const st = this.unfold(ep);
        if (st.state.k !== "end") {
          throw new SimError("protocol", `Cannot close ${ep.session.name}.${ep.role} yet: the protocol's next step is \`${renderSession(st.state)}\`.`, e.span, ctx.proc,
            "`close` requires an endpoint that has reached an `end` state; it cannot skip unfinished protocol steps.");
        }
        ep.session.closed.add(ep.role);
        this.trace.push({ kind: "close", proc: ctx.proc, session: ep.session.name, role: ep.role, step: this.steps, span: e.span });
        return { k: "unit" };
      }
      case "release": {
        this.gone(ctx, yield* this.evalExpr(ctx, e.e), "released", e.span);
        return { k: "unit" };
      }
      case "reject": {
        const v = yield* this.evalExpr(ctx, e.e);
        throw new NegativeOutcome(v, e.span);
      }
      case "fail": {
        const args: Val[] = [];
        for (const a of e.args) args.push(yield* this.evalExpr(ctx, a));
        if (e.on) {
          const r = yield* this.evalExpr(ctx, e.on);
          if (r.k === "endpoint") r.session.closed.add(r.role + "!failed");
        }
        throw new FatalSignal(e.target, args, e.span);
      }
      case "fallback": {
        try {
          return yield* this.evalExpr(ctx, e.base);
        } catch (sig) {
          if (!(sig instanceof NegativeOutcome)) throw sig;
          if (e.mode === "fail") {
            const args: Val[] = [];
            for (const a of e.args) args.push(yield* this.evalExpr(ctx, a));
            throw new FatalSignal(e.target, args, e.span);
          }
          const v = yield* this.evalExpr(ctx, e.e);
          throw new NegativeOutcome(v, e.span);
        }
      }
      case "convert": {
        const v = yield* this.evalExpr(ctx, e.e);
        const ty = this.resolveAlias(e.type);
        if (ty.k === "int") {
          if (v.k === "int") return this.checkRange({ k: "int", v: v.v, bits: ty.bits, signed: ty.signed }, `convert: ${v.v} does not fit in \`${renderType(ty)}\``, e.span, ctx);
          if (v.k === "float") {
            if (!Number.isInteger(v.v)) throw new SimError("arithmetic", `convert: ${v.v} is not a whole number, so it cannot become \`${renderType(ty)}\` exactly.`, e.span, ctx.proc);
            return this.checkRange({ k: "int", v: BigInt(v.v), bits: ty.bits, signed: ty.signed }, `convert: ${v.v} does not fit in \`${renderType(ty)}\``, e.span, ctx);
          }
        }
        if (ty.k === "float" && (v.k === "int" || v.k === "float")) {
          const n = v.k === "int" ? Number(v.v) : v.v;
          return { k: "float", v: ty.bits === 32 ? Math.fround(n) : n, bits: ty.bits };
        }
        throw new SimError("runtime", `Cannot convert ${describeVal(v)} to \`${renderType(e.type)}\`.`, e.span, ctx.proc);
      }
      case "accept": case "transport": {
        const v = yield* this.evalExpr(ctx, e.e);
        return yield* this.coerce(ctx, v, e.type, e.k === "accept" ? "accept" : "transport", e.span);
      }
      case "prove": {
        const ok = this.evalPropSync({ ...ctx, ghost: true }, e.prop);
        this.checks++;
        this.trace.push({ kind: "check", proc: ctx.proc, what: "prove", text: this.text(e.prop.span), step: this.steps, span: e.span });
        if (!ok) {
          throw new SimError("contract", `\`prove(${this.text(e.prop.span)})\` is false here.`, e.span, ctx.proc,
            "In real Phil this is a compile-time proof obligation; the simulator found a run where it does not hold.");
        }
        return { k: "proof", text: this.text(e.prop.span) };
      }
      case "unsupported":
        throw new SimError("unsupported", `\`${e.keyword}\` is valid Phil but the simulator does not execute it yet.`, e.span, ctx.proc);
    }
  }

  /** Evaluate an expression for inspection only (field access / borrow targets): names are not consumed. */
  *evalObserve(ctx: Ctx, e: Expr): Gen<Val> {
    if (e.k === "name") {
      const slot = ctx.env.lookup(e.path[0]);
      if (slot) {
        let v = slot.value;
        if (slot.moved && !ctx.ghost) {
          throw new SimError("linearity", `\`${e.path[0]}\` was already consumed on line ${this.line(slot.moved)}.`, e.span, ctx.proc);
        }
        for (const f of e.path.slice(1)) v = this.fieldOf(ctx, v, f, e.span, "inspect");
        return v;
      }
    }
    return yield* this.evalExpr(ctx, e);
  }

  fieldOf(ctx: Ctx, target: Val, name: string, span: Span, _how: string): Val {
    let base = target;
    const viaView = base.k === "view";
    if (base.k === "view") base = base.of;
    const fields = base.k === "record" ? base.fields : base.k === "variant" ? base.fields : undefined;
    if (!fields) throw new SimError("runtime", `${describeVal(base)} has no fields (reading \`.${name}\`).`, span, ctx.proc);
    const v = fields.get(name);
    if (!v) throw new SimError("runtime", `\`${base.k === "record" ? base.type : describeVal(base)}\` has no field \`${name}\`.`, span, ctx.proc);
    if (!ctx.ghost) {
      if (!viaView && this.valMode(base) !== "unrestricted") {
        throw new SimError("linearity", `Cannot read \`.${name}\` directly from a ${this.valMode(base)} \`${describeVal(base)}\` value.`, span, ctx.proc,
          `Destructure it with \`let ${base.k === "record" ? base.type : "T"} { ${name}, … } = …;\`, or inspect it inside \`borrow … as view { … }\`.`);
      }
      if (viaView && this.valMode(v) !== "unrestricted") {
        throw new SimError("linearity", `Cannot move the ${this.valMode(v)} field \`${name}\` out of a borrowed view.`, span, ctx.proc);
      }
    }
    return v;
  }

  evalName(ctx: Ctx, path: string[], span: Span): Val {
    const head = path[0];
    const slot = ctx.env.lookup(head);
    if (slot) {
      if (path.length === 1) return this.use(ctx, head, span);
      let v = slot.value;
      if (slot.moved && !ctx.ghost) throw new SimError("linearity", `\`${head}\` was already consumed on line ${this.line(slot.moved)}.`, span, ctx.proc);
      for (const f of path.slice(1)) v = this.fieldOf(ctx, v, f, span, "path");
      return v;
    }
    const last = path[path.length - 1];
    const variant = this.findVariant(path);
    if (variant) {
      if ((variant.variant.tuple?.length ?? 0) > 0 || variant.variant.fields) {
        throw new SimError("runtime", `Variant \`${last}\` carries a payload; write \`${last}(…)\`${variant.variant.fields ? " or `construct " + last + " { … }`" : ""}.`, span, ctx.proc);
      }
      return { k: "variant", type: variant.data.name, tag: last, payload: [] };
    }
    const d = this.decls.get(path.join("."));
    if (d?.k === "fn") return { k: "fnref", name: d.name };
    throw new SimError("runtime", `Unknown name \`${path.join(".")}\`.`, span, ctx.proc);
  }

  findVariant(path: string[]) {
    const last = path[path.length - 1];
    const list = this.variants.get(last);
    if (!list) return undefined;
    if (path.length > 1) return list.find((x) => x.data.name === path[path.length - 2]) ?? list[0];
    return list[0];
  }

  arith(ctx: Ctx, op: string, l: Val, r: Val, span: Span): Val {
    if (l.k === "float" || r.k === "float") {
      if (l.k !== "float" || r.k !== "float") throw new SimError("arithmetic", `Cannot mix ${describeVal(l)} and ${describeVal(r)} in \`${op}\`.`, span, ctx.proc, "Use `convert` to make both sides the same type.");
      const bits = l.bits ?? r.bits;
      const f = (x: number) => (bits === 32 ? Math.fround(x) : x);
      switch (op) {
        case "+": return { k: "float", v: f(l.v + r.v), bits };
        case "-": return { k: "float", v: f(l.v - r.v), bits };
        case "*": return { k: "float", v: f(l.v * r.v), bits };
        case "/": return { k: "float", v: f(l.v / r.v), bits };
        default: throw new SimError("arithmetic", `\`${op}\` is not defined for floating-point values in the simulator.`, span, ctx.proc);
      }
    }
    if (l.k !== "int" || r.k !== "int") {
      throw new SimError("runtime", `\`${op}\` needs numbers, got ${describeVal(l)} and ${describeVal(r)}.`, span, ctx.proc);
    }
    if (l.bits !== null && r.bits !== null && (l.bits !== r.bits || l.signed !== r.signed) && op !== "<<" && op !== ">>") {
      throw new SimError("arithmetic", `Mismatched integer types: \`${l.signed ? "I" : "U"}${l.bits}\` ${op} \`${r.signed ? "I" : "U"}${r.bits}\`.`, span, ctx.proc, "Phil never widens or narrows implicitly; use `convert`.");
    }
    const bits = l.bits ?? (op === "<<" || op === ">>" ? null : r.bits);
    const signed = l.bits !== null ? l.signed : r.signed;
    const shown = `${l.v} ${op} ${r.v}`;
    let v: bigint;
    switch (op) {
      case "+": v = l.v + r.v; break;
      case "-": v = l.v - r.v; break;
      case "*": v = l.v * r.v; break;
      case "/": case "%":
        if (r.v === 0n) throw new SimError("arithmetic", `Division by zero (\`${shown}\`).`, span, ctx.proc);
        v = op === "/" ? l.v / r.v : l.v % r.v;
        break;
      case "<<": case ">>": {
        if (r.v < 0n || (bits !== null && r.v >= BigInt(bits))) {
          throw new SimError("arithmetic", `Invalid shift count ${r.v}${bits !== null ? ` for a ${bits}-bit value` : ""}.`, span, ctx.proc);
        }
        v = op === "<<" ? l.v << r.v : l.v >> r.v;
        break;
      }
      default: throw new SimError("runtime", `Unknown operator ${op}.`, span, ctx.proc);
    }
    const typeName = bits !== null ? `${signed ? "I" : "U"}${bits}` : "";
    return this.checkRange({ k: "int", v, bits, signed }, `Arithmetic overflow: ${shown} = ${v} does not fit in \`${typeName}\``, span, ctx);
  }

  // ---------------------------------------------------------------- calls

  *evalCall(ctx: Ctx, e: Extract<Expr, { k: "call" }>): Gen<Val> {
    const name = e.path.join(".");
    const head = e.path[0];
    const local = e.path.length === 1 ? ctx.env.lookup(head) : undefined;

    // Variant constructor
    if (!local) {
      const variant = this.findVariant(e.path);
      if (variant && !this.decls.has(name)) {
        const types = variant.variant.tuple ?? [];
        if (types.length !== e.args.length) {
          throw new SimError("runtime", `Variant \`${variant.variant.name}\` carries ${types.length} value(s), but ${e.args.length} were given.`, e.span, ctx.proc);
        }
        const payload: Val[] = [];
        for (let i = 0; i < types.length; i++) {
          const v = yield* this.evalExpr(ctx, e.args[i]);
          payload.push(yield* this.coerce(ctx, v, types[i], `${variant.variant.name} payload ${i + 1}`, e.args[i].span));
        }
        return this.applyFields(ctx, this.born(ctx, { k: "variant", type: variant.data.name, tag: variant.variant.name, payload }, e.span), e);
      }
    }

    const args: Val[] = [];
    for (const a of e.args) args.push(yield* this.evalExpr(ctx, a));

    let result: Val;
    if (local) {
      const callee = this.use(ctx, head, e.span);
      if (callee.k === "closure") result = yield* this.callClosure(ctx, callee, args, e.span);
      else if (callee.k === "fnref") result = yield* this.callFn(ctx, this.decls.get(callee.name) as Extract<Decl, { k: "fn" }>, args, e.span);
      else throw new SimError("runtime", `\`${head}\` is ${describeVal(callee)}, not something that can be called.`, e.span, ctx.proc);
    } else {
      const d = this.decls.get(name);
      if (d?.k === "fn") result = yield* this.callFn(ctx, d, args, e.span);
      else if (HOST_OPERATIONS[name]) result = this.host(ctx, name, args, e.span);
      else if (d?.k === "claim") throw new SimError("runtime", `\`${name}\` is a claim (a proposition), not a function. Use it inside \`prove(…)\`, \`requires\` or \`ensures\`.`, e.span, ctx.proc);
      else if (d?.k === "callable") throw new SimError("runtime", `\`${name}\` is a callable contract. Call a function that \`satisfies ${name}\` instead.`, e.span, ctx.proc);
      else {
        throw new SimError("runtime", `Unknown function \`${name}\`.`, e.span, ctx.proc,
          `The simulator provides these host operations: ${Object.keys(HOST_OPERATIONS).join(", ")}. Anything else must be declared with \`fn\`.`);
      }
    }
    return this.applyFields(ctx, result, e);
  }

  applyFields(ctx: Ctx, v: Val, e: Extract<Expr, { k: "call" }>): Val {
    let out = v;
    for (const f of e.fields) out = this.fieldOf(ctx, out, f, e.span, "call");
    return out;
  }

  host(ctx: Ctx, name: string, args: Val[], span: Span): Val {
    if (name === "console_write") {
      this.trace.push({ kind: "console", proc: ctx.proc, text: args.map((a) => (a.k === "string" ? a.v : renderVal(a))).join(" "), step: this.steps, span });
      return { k: "unit" };
    }
    if (args.length !== 2) throw new SimError("runtime", `\`${name}\` takes two arguments.`, span, ctx.proc);
    const [a, b] = args;
    const cmp = this.compare(a, b);
    if (cmp === undefined) {
      if (name === "eq" || name === "ne") return { k: "bool", v: (name === "eq") === this.equal(a, b) };
      throw new SimError("runtime", `\`${name}\` cannot compare ${describeVal(a)} and ${describeVal(b)}.`, span, ctx.proc);
    }
    const v = { lt: cmp < 0, le: cmp <= 0, gt: cmp > 0, ge: cmp >= 0, eq: cmp === 0, ne: cmp !== 0 }[name as "lt"];
    return { k: "bool", v };
  }

  compare(a: Val, b: Val): number | undefined {
    if (a.k === "int" && b.k === "int") return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    if (a.k === "float" && b.k === "float") return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    if (a.k === "string" && b.k === "string") return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    if (a.k === "char" && b.k === "char") return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    return undefined;
  }
  equal(a: Val, b: Val): boolean {
    const c = this.compare(a, b);
    if (c !== undefined) return c === 0;
    if (a.k === "bool" && b.k === "bool") return a.v === b.v;
    if (a.k === "unit" && b.k === "unit") return true;
    if (a.k === "tuple" && b.k === "tuple") return a.elems.length === b.elems.length && a.elems.every((x, i) => this.equal(x, b.elems[i]));
    if (a.k === "record" && b.k === "record") return a.type === b.type && [...a.fields].every(([k, v]) => this.equal(v, b.fields.get(k)!));
    if (a.k === "variant" && b.k === "variant") return a.type === b.type && a.tag === b.tag && a.payload.every((x, i) => this.equal(x, b.payload[i]));
    if (a.k === "view") return this.equal(a.of, b);
    if (b.k === "view") return this.equal(a, b.of);
    return false;
  }

  contractOf(name: string): Extract<Decl, { k: "callable" }> | undefined {
    const d = this.decls.get(name);
    return d?.k === "callable" ? d : undefined;
  }

  *callFn(ctx: Ctx, d: Extract<Decl, { k: "fn" }>, args: Val[], span: Span): Gen<Val> {
    return yield* this.invoke(ctx, d.name, d.params, d.ret, d.satisfies, d.body, new Env(), args, span);
  }
  *callClosure(ctx: Ctx, c: Extract<Val, { k: "closure" }>, args: Val[], span: Span): Gen<Val> {
    const env = new Env();
    for (const [k, s] of c.env.vars) env.vars.set(k, { ...s, moved: undefined });
    return yield* this.invoke(ctx, c.name, c.params, undefined, c.satisfies, c.block, env, args, span);
  }

  *invoke(ctx: Ctx, name: string, params: Param[], ret: TypeExpr | undefined, satisfies: string, body: Block, env: Env, args: Val[], span: Span): Gen<Val> {
    if (args.length !== params.length) {
      throw new SimError("runtime", `\`${name}\` takes ${params.length} argument(s), but ${args.length} were given.`, span, ctx.proc);
    }
    const inner: Ctx = { proc: ctx.proc, env, ghost: ctx.ghost };
    for (let i = 0; i < params.length; i++) {
      const v = yield* this.coerce(inner, args[i], params[i].type, `Argument \`${params[i].name}\` of \`${name}\``, span);
      env.vars.set(params[i].name, { name: params[i].name, value: v, borrowed: 0, declSpan: params[i].span });
    }
    const contract = this.contractOf(satisfies);
    // The callable's parameter names may differ from the implementation's; bind both.
    const contractEnv = new Env(env);
    if (contract) {
      contract.params.forEach((p, i) => { if (i < params.length) contractEnv.vars.set(p.name, { name: p.name, value: env.vars.get(params[i].name)!.value, borrowed: 0 }); });
      for (const req of contract.requires) {
        this.checks++;
        const ok = this.evalPropSync({ ...inner, env: contractEnv, ghost: true }, req);
        this.trace.push({ kind: "check", proc: ctx.proc, what: "requires", text: `${name}: ${this.text(req.span)}`, step: this.steps, span });
        if (!ok) {
          throw new SimError("contract", `Precondition of \`${name}\` violated: \`requires ${this.text(req.span)}\` is false for ${this.describeArgs(contract.params, args)}.`, span, ctx.proc,
            `The caller is responsible for establishing \`requires\` clauses of \`${satisfies}\`.`);
        }
      }
    }
    let result: Val = { k: "unit" };
    try {
      yield* this.evalBlock(inner, body);
    } catch (sig) {
      if (sig instanceof ReturnSignal) result = sig.value;
      else {
        if (sig instanceof NegativeOutcome && contract && contract.outcomes.length && !contract.outcomes.some((o) => o.kind === "negative")) {
          throw new SimError("contract", `\`${name}\` rejected, but its contract \`${satisfies}\` declares no negative outcome.`, sig.span, ctx.proc);
        }
        if (sig instanceof NegativeOutcome) this.checkDrops(inner, env, sig.span);
        throw sig;
      }
    }
    this.checkDrops(inner, env, [body.span[1] - 1, body.span[1]]);
    const retType = ret ?? contract?.ret;
    result = yield* this.coerce(inner, result, retType, `Result of \`${name}\``, span);
    if (contract) {
      for (const ens of contract.ensures) {
        this.checks++;
        const ok = this.evalPropSync({ ...inner, env: contractEnv, ghost: true }, ens);
        this.trace.push({ kind: "check", proc: ctx.proc, what: "ensures", text: `${name}: ${this.text(ens.span)}`, step: this.steps, span });
        if (!ok) {
          throw new SimError("contract", `Postcondition of \`${name}\` violated: \`ensures ${this.text(ens.span)}\` is false after the call.`, span, ctx.proc,
            `The implementation of \`${name}\` is responsible for its \`ensures\` clauses.`);
        }
      }
    }
    return result;
  }

  describeArgs(params: Param[], args: Val[]): string {
    return params.map((p, i) => `${p.name} = ${args[i] ? renderVal(args[i]) : "?"}`).join(", ");
  }

  // ---------------------------------------------------------------- compound forms

  *evalConstruct(ctx: Ctx, e: Extract<Expr, { k: "construct" }>): Gen<Val> {
    const d = this.decls.get(e.type);
    let fieldsDecl: Param[] | undefined;
    let make: (fields: Map<string, Val>) => Val;
    if (d?.k === "record") {
      fieldsDecl = d.fields;
      make = (fields) => ({ k: "record", type: d.name, fields });
    } else {
      const variant = this.findVariant(e.type.split("."));
      if (!variant || !variant.variant.fields) throw new SimError("runtime", `\`${e.type}\` is not a record type or a record-style variant.`, e.span, ctx.proc);
      fieldsDecl = variant.variant.fields;
      make = (fields) => ({ k: "variant", type: variant.data.name, tag: variant.variant.name, payload: [...fields.values()], fields });
    }
    const fields = new Map<string, Val>();
    for (const f of e.fields) {
      const decl = fieldsDecl.find((x) => x.name === f.name);
      if (!decl) throw new SimError("runtime", `\`${e.type}\` has no field \`${f.name}\`.`, f.value.span, ctx.proc);
      if (fields.has(f.name)) throw new SimError("runtime", `Field \`${f.name}\` is given twice.`, f.value.span, ctx.proc);
      const v = yield* this.evalExpr(ctx, f.value);
      fields.set(f.name, yield* this.coerce(ctx, v, decl.type, `Field \`${e.type}.${f.name}\``, f.value.span));
    }
    const missing = fieldsDecl.filter((x) => !fields.has(x.name));
    if (missing.length) throw new SimError("runtime", `Missing field${missing.length > 1 ? "s" : ""} ${missing.map((m) => "`" + m.name + "`").join(", ")} in \`construct ${e.type}\`.`, e.span, ctx.proc);
    const ordered = new Map(fieldsDecl.map((f) => [f.name, fields.get(f.name)!]));
    return this.born(ctx, make(ordered), e.span);
  }

  *evalBorrow(ctx: Ctx, e: Extract<Expr, { k: "borrow" }>): Gen<Val> {
    let slot: Slot | undefined;
    let target: Val;
    if (e.target.k === "name" && e.target.path.length === 1 && (slot = ctx.env.lookup(e.target.path[0]))) {
      if (slot.moved && !ctx.ghost) throw new SimError("linearity", `Cannot borrow \`${slot.name}\`: it was already consumed on line ${this.line(slot.moved)}.`, e.span, ctx.proc);
      target = slot.value;
      slot.borrowed++;
    } else {
      target = yield* this.evalExpr(ctx, e.target);
    }
    const borrowId = this.nextBorrow++;
    const env = new Env(ctx.env);
    env.vars.set(e.as, { name: e.as, value: { k: "view", of: target, borrowId }, borrowed: 0, declSpan: e.span });
    let result: Val = { k: "unit" };
    try {
      yield* this.evalBlock({ ...ctx, env }, e.block);
    } catch (sig) {
      if (sig instanceof ReturnSignal) result = sig.value;
      else { if (slot) slot.borrowed--; throw sig; }
    }
    if (slot) slot.borrowed--;
    if (this.containsView(result, borrowId)) {
      throw new SimError("linearity", `The borrowed view \`${e.as}\` escapes its \`borrow\` block.`, e.span, ctx.proc, "Return a copy of an unrestricted field instead, e.g. `return view.id;`.");
    }
    return result;
  }
  containsView(v: Val, id: number): boolean {
    if (v.k === "view") return v.borrowId === id;
    if (v.k === "tuple") return v.elems.some((x) => this.containsView(x, id));
    if (v.k === "record") return [...v.fields.values()].some((x) => this.containsView(x, id));
    if (v.k === "variant") return v.payload.some((x) => this.containsView(x, id));
    return false;
  }

  *bindJoin(ctx: Ctx, join: NonNullable<Extract<Expr, { k: "if" }>["join"]>, v: Val, span: Span): Gen<void> {
    const values = join.slots.length === 1 ? [v] : v.k === "tuple" ? v.elems : [];
    if (values.length !== join.slots.length) {
      throw new SimError("runtime", `This branch must supply ${join.slots.length} join value(s) as its final expression.`, span, ctx.proc);
    }
    const env = new Env(ctx.env);
    for (let i = 0; i < join.slots.length; i++) {
      const s = join.slots[i];
      const val = yield* this.coerce(ctx, values[i], s.type, `Join state \`${s.name}\``, span);
      this.declare(ctx, s.name, val, s.span);
      env.vars.set(s.name, { name: s.name, value: val, borrowed: 0 });
    }
    if (join.invariant) {
      this.checks++;
      const ok = this.evalPropSync({ ...ctx, ghost: true }, join.invariant);
      this.trace.push({ kind: "check", proc: ctx.proc, what: "join invariant", text: this.text(join.invariant.span), step: this.steps, span });
      if (!ok) throw new SimError("contract", `Join invariant \`${this.text(join.invariant.span)}\` does not hold for the values this branch supplies.`, span, ctx.proc);
    }
  }

  *evalMatch(ctx: Ctx, e: Extract<Expr, { k: "match" | "decide" }>): Gen<Val> {
    let target: Val;
    try {
      target = yield* this.evalExpr(ctx, e.target);
    } catch (sig) {
      if (e.k === "decide" && sig instanceof NegativeOutcome) target = sig.value;
      else throw sig;
    }
    const tag = target.k === "variant" ? target.tag : target.k === "record" ? target.type : undefined;
    if (!tag) throw new SimError("runtime", `\`${e.k}\` needs a sum-type value or an outcome, got ${describeVal(target)} \`${renderVal(target)}\`.`, e.target.span, ctx.proc);
    this.gone(ctx, target, "matched", e.span);
    const arm = e.arms.find((a) => a.pattern.path[a.pattern.path.length - 1] === tag);
    if (!arm) throw new SimError("runtime", `No arm matches \`${tag}\`. A \`${e.k}\` must cover every case.`, e.span, ctx.proc);
    const env = new Env(ctx.env);
    const inner: Ctx = { ...ctx, env };
    if (arm.pattern.binders) {
      const payload = target.k === "variant" ? target.payload : [...(target as Extract<Val, { k: "record" }>).fields.values()];
      if (arm.pattern.binders.length !== payload.length) {
        throw new SimError("runtime", `\`${tag}\` carries ${payload.length} value(s), but the arm binds ${arm.pattern.binders.length}.`, arm.span, ctx.proc);
      }
      arm.pattern.binders.forEach((b, i) => env.vars.set(b, { name: b, value: payload[i], borrowed: 0, declSpan: arm.span }));
    } else if (arm.pattern.fieldBinders) {
      const fields = target.k === "record" ? target.fields : target.k === "variant" ? target.fields : undefined;
      if (!fields) throw new SimError("runtime", `\`${tag}\` has no named fields.`, arm.span, ctx.proc);
      for (const fb of arm.pattern.fieldBinders) {
        const v = fields.get(fb.field);
        if (!v) throw new SimError("runtime", `\`${tag}\` has no field \`${fb.field}\`.`, arm.span, ctx.proc);
        env.vars.set(fb.as, { name: fb.as, value: v, borrowed: 0, declSpan: arm.span });
      }
    } else if (target.k === "variant" && target.payload.some((x) => this.valMode(x) === "linear")) {
      throw new SimError("linearity", `The arm for \`${tag}\` ignores a linear payload; it would be dropped.`, arm.span, ctx.proc);
    }
    const v = yield* this.evalArmBody(inner, arm, env, !!e.join);
    if (e.join) yield* this.bindJoin(ctx, e.join, v, arm.span);
    return { k: "unit" };
  }

  *evalArmBody(ctx: Ctx, arm: Arm, env: Env, keep = false): Gen<Val> {
    let v: Val;
    if ("stmts" in arm.body) v = yield* this.evalBlock(ctx, arm.body, keep);
    else v = yield* this.evalStmt(ctx, arm.body, keep);
    this.checkDrops(ctx, env, arm.span);
    return v;
  }

  *evalLoop(ctx: Ctx, e: Extract<Expr, { k: "loop" }>): Gen<Val> {
    let values: Val[] = [];
    for (const s of e.state) values.push(yield* this.evalExpr(ctx, s.init));
    for (;;) {
      this.tick(e.span);
      const env = new Env(ctx.env);
      const inner: Ctx = { ...ctx, env };
      if (values.length !== e.state.length) {
        throw new SimError("runtime", `This loop has ${e.state.length} state value(s), but \`continue\` supplied ${values.length}.`, e.span, ctx.proc,
          "Bare `continue` supplies zero values; it does not reuse the current ones.");
      }
      for (let i = 0; i < e.state.length; i++) {
        const s = e.state[i];
        const v = yield* this.coerce(inner, values[i], s.type, `Loop state \`${s.name}\``, e.span);
        env.vars.set(s.name, { name: s.name, value: v, borrowed: 0, declSpan: e.span });
      }
      if (e.invariant) {
        this.checks++;
        const ok = this.evalPropSync({ ...inner, ghost: true }, e.invariant);
        this.trace.push({ kind: "check", proc: ctx.proc, what: "loop invariant", text: this.text(e.invariant.span), step: this.steps, span: e.invariant.span });
        if (!ok) {
          throw new SimError("contract", `Loop invariant \`${this.text(e.invariant.span)}\` does not hold on entry (${e.state.map((s) => `${s.name} = ${renderVal(env.vars.get(s.name)!.value)}`).join(", ")}).`, e.invariant.span, ctx.proc,
            "Failing an invariant is an error, not a loop exit; use `break` to leave the loop.");
        }
      }
      try {
        yield* this.evalBlock(inner, e.block);
      } catch (sig) {
        if (sig instanceof ContinueSignal) { this.checkDrops(inner, env, sig.span); values = sig.values; continue; }
        if (sig instanceof BreakSignal) {
          this.checkDrops(inner, env, sig.span);
          return sig.values.length === 0 ? { k: "unit" } : sig.values.length === 1 ? sig.values[0] : { k: "tuple", elems: sig.values };
        }
        throw sig;
      }
      throw new SimError("runtime", "The loop body finished without `continue` or `break`.", [e.block.span[1] - 1, e.block.span[1]], ctx.proc,
        "Phil loops repeat only through an explicit `continue (...)` and end only through `break`.");
    }
  }

  // ---------------------------------------------------------------- propositions

  evalPropSync(ctx: Ctx, p: Prop): boolean {
    switch (p.k) {
      case "bool": return p.value;
      case "not": return !this.evalPropSync(ctx, p.p);
      case "and": return this.evalPropSync(ctx, p.l) && this.evalPropSync(ctx, p.r);
      case "or": return this.evalPropSync(ctx, p.l) || this.evalPropSync(ctx, p.r);
      case "rel": {
        const l = this.runSync(ctx, p.l), r = this.runSync(ctx, p.r);
        if (p.op === "==" || p.op === "!=") return (p.op === "==") === this.equal(l, r);
        if (p.op === "in" || p.op === "disjoint") throw new SimError("unsupported", `\`${p.op}\` propositions over collections are not supported by the simulator.`, p.span, ctx.proc);
        const c = this.compare(l.k === "view" ? l.of : l, r.k === "view" ? r.of : r);
        if (c === undefined) throw new SimError("runtime", `Cannot compare ${describeVal(l)} and ${describeVal(r)} with \`${p.op}\`.`, p.span, ctx.proc);
        return { "<": c < 0, "<=": c <= 0, ">": c > 0, ">=": c >= 0 }[p.op as "<"];
      }
      case "claim": {
        const d = this.decls.get(p.name);
        if (!d || d.k !== "claim") throw new SimError("runtime", `Unknown claim \`${p.name}\`.`, p.span, ctx.proc);
        if (!d.body) {
          this.trace.push({ kind: "assume", proc: ctx.proc, text: `${p.name}(…) has no definition; assumed true`, step: this.steps, span: p.span });
          return true;
        }
        const env = new Env();
        d.params.forEach((param, i) => {
          const a = p.args[i];
          env.vars.set(param.name, { name: param.name, value: a ? this.runSync(ctx, a) : { k: "unit" }, borrowed: 0 });
        });
        return this.evalPropSync({ ...ctx, env, ghost: true }, d.body);
      }
    }
  }

  runSync(ctx: Ctx, e: Expr): Val {
    const g = this.evalExpr({ ...ctx, ghost: true }, e);
    const r = g.next();
    if (!r.done) throw new SimError("runtime", "Propositions cannot communicate (send/receive inside a contract).", e.span, ctx.proc);
    return r.value;
  }

  // ---------------------------------------------------------------- sessions

  *evalEndpoint(ctx: Ctx, e: Expr, op: string): Gen<Extract<Val, { k: "endpoint" }>> {
    const v = yield* this.evalExpr(ctx, e);
    if (v.k !== "endpoint") throw new SimError("protocol", `\`${op}\` needs a protocol endpoint, got ${describeVal(v)}.`, e.span, ctx.proc);
    return v;
  }

  unfold(ep: Extract<Val, { k: "endpoint" }>): { state: Session; rec: Map<string, Session> } {
    let state = ep.state;
    let rec = ep.rec;
    for (let i = 0; i < 100; i++) {
      if (state.k === "rec") { rec = new Map(rec); rec.set(state.name, state); state = state.body; continue; }
      if (state.k === "continue") {
        const target = rec.get(state.name);
        if (!target || target.k !== "rec") throw new SimError("protocol", `Unknown recursion variable \`${state.name}\` in protocol.`);
        state = target.body;
        continue;
      }
      if (state.k === "ref") throw new SimError("unsupported", `Session reference \`${state.name}\` is not supported by the simulator; write the session inline.`);
      break;
    }
    return { state, rec };
  }
  endpointAtEnd(ep: Extract<Val, { k: "endpoint" }>): boolean { return this.unfold(ep).state.k === "end"; }

  successor(ep: Extract<Val, { k: "endpoint" }>, next: Session, rec: Map<string, Session>): Val {
    return { k: "endpoint", id: this.nextId++, session: ep.session, role: ep.role, state: next, rec };
  }

  protocolError(ctx: Ctx, ep: Extract<Val, { k: "endpoint" }>, state: Session, attempted: string, span: Span): SimError {
    const hint = state.k === "offer"
      ? `At an \`offer\` step the peer chooses: handle it with \`offer ${ep.role === "" ? "ep" : "endpoint"} { ${state.branches.map((b) => b.label + " => { … }").join(" ")} };\`.`
      : state.k === "select" ? `At a \`select\` step this side chooses: \`select ${state.branches[0]?.label ?? "Label"} on …\`.`
      : state.k === "end" ? "The protocol is finished here; `close` the endpoint." : `Protocol \`${ep.session.protocol}\`, role \`${ep.role}\`.`;
    return new SimError("protocol", `Protocol violation on ${ep.session.name}.${ep.role}: the code tries to \`${attempted}\`, but the protocol's next step is \`${renderSession(state)}\`.`, span, ctx.proc, hint);
  }

  // ---------------------------------------------------------------- program setup

  entries(): EntryInfo[] {
    const target = this.runTarget();
    if (!target) return [];
    const out: EntryInfo[] = [];
    if (target.kind === "architecture") {
      for (const it of target.decl.items) if (it.k === "entry") out.push({ name: it.name, type: it.type, typeText: renderType(it.type), source: target.decl.name });
      for (const en of target.program?.entries ?? []) out.push({ name: en.name, type: en.type, typeText: renderType(en.type), source: target.program!.name });
    } else {
      for (const p of target.decl.params) out.push({ name: p.name, type: p.type, typeText: renderType(p.type), source: target.decl.name });
    }
    return out;
  }

  runTarget():
    | { kind: "architecture"; decl: Extract<Decl, { k: "architecture" }>; program?: Extract<Decl, { k: "program" }> }
    | { kind: "component"; decl: Extract<Decl, { k: "component" }>; program?: Extract<Decl, { k: "program" }> }
    | undefined {
    const programs = this.program.decls.filter((d): d is Extract<Decl, { k: "program" }> => d.k === "program");
    const program = programs.find((p) => p.name === "main") ?? programs[0];
    if (program) {
      const d = this.decls.get(program.target);
      if (d?.k === "architecture") return { kind: "architecture", decl: d, program };
      if (d?.k === "component") return { kind: "component", decl: d, program };
      return undefined;
    }
    const main = this.decls.get("main");
    if (main?.k === "component") return { kind: "component", decl: main };
    const archs = this.program.decls.filter((d): d is Extract<Decl, { k: "architecture" }> => d.k === "architecture");
    if (archs.length === 1) return { kind: "architecture", decl: archs[0] };
    const comps = this.program.decls.filter((d): d is Extract<Decl, { k: "component" }> => d.k === "component");
    if (comps.length === 1) return { kind: "component", decl: comps[0] };
    return undefined;
  }

  *runComponent(proc: string, comp: Extract<Decl, { k: "component" }>, inputs: Map<string, Val>): Gen<{ status: string; text: string }> {
    const env = new Env();
    const ctx: Ctx = { proc, env, ghost: false };
    for (const p of comp.params) {
      const v = inputs.get(p.name);
      if (!v) throw new SimError("wiring", `Parameter \`${p.name}\` of \`${comp.name}\` is not bound. Add \`bind ${proc}.${p.name} = …;\` to the architecture.`, p.span, proc);
      env.vars.set(p.name, { name: p.name, value: yield* this.coerce(ctx, v, p.type, `Input \`${p.name}\``, p.span), borrowed: 0, declSpan: p.span });
    }
    try {
      yield* this.evalBlock(ctx, comp.body);
    } catch (sig) {
      if (sig instanceof ReturnSignal) {
        this.checkDrops(ctx, env, [comp.body.span[1] - 1, comp.body.span[1]]);
        const v = yield* this.coerce(ctx, sig.value, comp.provides, `Value provided by \`${comp.name}\``, comp.nameSpan);
        return { status: "returned", text: renderVal(v) };
      }
      if (sig instanceof NegativeOutcome) return { status: "rejected", text: renderVal(sig.value) };
      if (sig instanceof FatalSignal) return { status: "failed", text: `${sig.target}${sig.args.length ? `(${sig.args.map((a) => renderVal(a)).join(", ")})` : ""}` };
      if (sig instanceof ContinueSignal || sig instanceof BreakSignal) throw new SimError("runtime", "`continue`/`break` outside a loop.", sig.span, proc);
      throw sig;
    }
    this.checkDrops(ctx, env, [comp.body.span[1] - 1, comp.body.span[1]]);
    if (comp.provides && this.resolveAlias(comp.provides).k !== "unit") {
      throw new SimError("runtime", `\`${comp.name}\` finished without returning the \`${renderType(comp.provides)}\` it provides.`, comp.nameSpan, proc);
    }
    return { status: "finished", text: "" };
  }

  /** An automatic stand-in for a role marked `external`: follows its session type with default values. */
  *externalPeer(ep: Extract<Val, { k: "endpoint" }>, policy = 0): Gen<{ status: string; text: string }> {
    let cur: Extract<Val, { k: "endpoint" }> = ep;
    for (let i = 0; i < 10_000; i++) {
      const { state, rec } = this.unfold(cur);
      const span: Span = [0, 0];
      switch (state.k) {
        case "end": cur.session.closed.add(cur.role); this.trace.push({ kind: "close", proc: `external ${cur.role}`, session: cur.session.name, role: cur.role, step: this.steps }); return { status: "finished", text: "" };
        case "send": {
          const value = this.defaultValue(state.param.type);
          yield { op: "send", ep: cur, value, span };
          cur = this.successor(cur, state.cont, rec) as typeof cur;
          break;
        }
        case "receive":
          yield { op: "recv", ep: cur, span };
          cur = this.successor(cur, state.cont, rec) as typeof cur;
          break;
        case "select": {
          const n = state.branches.length;
          const pick = policy === 1 ? n - 1 : policy === 2 ? i % n : n > 1 && i > 20 ? n - 1 : 0;
          const branch = state.branches[pick];
          yield { op: "select", ep: cur, label: branch.label, args: branch.params.map((p) => this.defaultValue(p.type)), span };
          cur = this.successor(cur, branch.cont, rec) as typeof cur;
          break;
        }
        case "offer": {
          const got = (yield { op: "offer", ep: cur, span }) as { label: string };
          const branch = state.branches.find((b) => b.label === got.label)!;
          cur = this.successor(cur, branch.cont, rec) as typeof cur;
          break;
        }
        default: throw new SimError("unsupported", "The simulated external peer cannot follow this session.");
      }
    }
    return { status: "finished", text: "" };
  }

  defaultValue(t: TypeExpr): Val {
    const ty = this.resolveAlias(t);
    switch (ty.k) {
      case "int": return { k: "int", v: 0n, bits: ty.bits, signed: ty.signed };
      case "float": return { k: "float", v: 0, bits: ty.bits };
      case "bool": return { k: "bool", v: false };
      case "bytes": return { k: "bytes", id: this.fresh() };
      case "string": return { k: "string", v: "" };
      case "char": return { k: "char", v: " " };
      case "tuple": return { k: "tuple", elems: ty.elems.map((e) => this.defaultValue(e)) };
      case "refine": return this.defaultValue(ty.base);
      default: return { k: "unit" };
    }
  }
}

// ------------------------------------------------------------------ scheduler

interface Proc {
  name: string;
  component: string;
  gen: Gen<{ status: string; text: string }>;
  status: "ready" | "blocked" | "done";
  pending?: Req;
  resume?: unknown;
  result?: { status: string; text: string };
  external?: boolean;
}

export function parseEntryValue(sim: Simulator, raw: string, type: TypeExpr): Val {
  const ty = sim.resolveAlias(type);
  const text = raw.trim();
  switch (ty.k) {
    case "int": {
      if (!/^-?\d+$/.test(text)) throw new SimError("wiring", `Entry value "${raw}" is not a whole number.`);
      return { k: "int", v: BigInt(text), bits: null, signed: false };
    }
    case "float": return { k: "float", v: Number(text), bits: null };
    case "bool":
      if (text !== "true" && text !== "false") throw new SimError("wiring", `Entry value "${raw}" must be true or false.`);
      return { k: "bool", v: text === "true" };
    case "string": return { k: "string", v: raw };
    case "char": return { k: "char", v: [...raw][0] ?? " " };
    case "unit": return { k: "unit" };
    case "bytes": return { k: "bytes", id: sim.fresh() };
    case "refine": return parseEntryValue(sim, raw, ty.base);
    default: throw new SimError("unsupported", `Entries of type \`${renderType(type)}\` cannot be typed into the simulator.`);
  }
}

export interface RunOptions { stepLimit?: number; order?: number; extPolicy?: number; entryValues?: Map<string, Val> }

export function run(program: Program, inputs: Record<string, string>, opts: RunOptions = {}): RunResult {
  const sim = new Simulator(program, opts);
  const procs: Proc[] = [];
  const sessions: SessionInst[] = [];
  const sessionInfo: RunResult["sessions"] = [];
  const result = (ok: boolean, error?: SimError): RunResult => ({
    ok, error, trace: sim.trace, checks: sim.checks, steps: sim.steps,
    processes: procs.map((p) => ({ name: p.name, component: p.component, status: p.result ? `${p.result.status}${p.result.text ? " " + p.result.text : ""}` : p.status === "blocked" ? "blocked" : "not finished", external: p.external })),
    sessions: sessionInfo,
  });

  try {
    const target = sim.runTarget();
    if (!target) {
      throw new SimError("wiring", "Nothing to run. Add `program main = instantiate YourArchitecture;`, or write a `component main`.");
    }
    const entryValues = new Map<string, Val>();
    for (const en of sim.entries()) {
      const given = opts.entryValues?.get(en.name);
      if (given) { entryValues.set(en.name, given); continue; }
      const raw = sim.resolveAlias(en.type).k === "bytes" ? "-" : inputs[en.name];
      if (raw === undefined || raw === "") throw new SimError("wiring", `Enter a value for entry \`${en.name} : ${en.typeText}\`.`);
      entryValues.set(en.name, parseEntryValue(sim, raw, en.type));
    }

    if (target.kind === "component") {
      const comp = target.decl;
      procs.push({ name: comp.name, component: comp.name, gen: sim.runComponent(comp.name, comp, entryValues), status: "ready" });
      sim.trace.push({ kind: "start", proc: comp.name, detail: `component ${comp.name}` });
    } else {
      const arch = target.decl;
      const instances = new Map<string, Extract<Decl, { k: "component" }>>();
      const binds = new Map<string, Map<string, Val>>();
      const sessionsByName = new Map<string, SessionInst>();
      const roleOwners = new Map<string, string>();
      for (const it of arch.items) {
        if (it.k === "instance") {
          const d = sim.decls.get(it.target);
          if (!d || d.k !== "component") throw new SimError("wiring", `Instance \`${it.name}\` refers to \`${it.target}\`, which is not a component.`, it.span);
          instances.set(it.name, d);
          binds.set(it.name, new Map());
        } else if (it.k === "protocol") {
          const d = sim.decls.get(it.target);
          if (!d || d.k !== "protocol") throw new SimError("wiring", `\`${it.target}\` is not a protocol.`, it.span);
          const s: SessionInst = { id: sessions.length + 1, name: it.name, protocol: d.name, roles: d.roles.map((r) => r.name), closed: new Set(), owners: new Map() };
          sessions.push(s);
          sessionsByName.set(it.name, s);
        }
      }
      const endpointFor = (path: string[], span: Span): Extract<Val, { k: "endpoint" }> => {
        const s = sessionsByName.get(path[0]);
        if (!s || path.length !== 2) throw new SimError("wiring", `\`${path.join(".")}\` is not a protocol role of this architecture.`, span);
        const proto = sim.decls.get(s.protocol) as Extract<Decl, { k: "protocol" }>;
        const role = proto.roles.find((r) => r.name === path[1]);
        if (!role) throw new SimError("wiring", `Protocol \`${s.protocol}\` has no role \`${path[1]}\`.`, span);
        return { k: "endpoint", id: 0, session: s, role: role.name, state: role.session, rec: new Map() };
      };
      const issued = new Set<string>();
      for (const it of arch.items) {
        if (it.k === "role") {
          const key = it.path.join(".");
          endpointFor(it.path, it.span);
          roleOwners.set(key, it.target === "external" ? "external" : it.target.join("."));
          sessionsByName.get(it.path[0])!.owners.set(it.path[1], it.target === "external" ? "external" : it.target.join("."));
        } else if (it.k === "bind") {
          const [inst, param] = it.to;
          if (!instances.has(inst) || it.to.length !== 2) throw new SimError("wiring", `\`bind ${it.to.join(".")}\` must name \`instance.parameter\`.`, it.span);
          const comp = instances.get(inst)!;
          if (!comp.params.some((p) => p.name === param)) throw new SimError("wiring", `Component \`${comp.name}\` has no parameter \`${param}\`.`, it.span);
          let v: Val;
          if (it.from.length === 1 && entryValues.has(it.from[0])) v = entryValues.get(it.from[0])!;
          else if (sessionsByName.has(it.from[0])) {
            const key = it.from.join(".");
            const owner = roleOwners.get(key);
            if (owner !== undefined && owner !== inst) {
              throw new SimError("wiring", `\`${key}\` is assigned to \`${owner}\`, but this bind gives it to \`${inst}\`.`, it.span);
            }
            if (issued.has(key)) throw new SimError("linearity", `The endpoint \`${key}\` is bound twice; an endpoint is linear and has exactly one owner.`, it.span);
            issued.add(key);
            v = endpointFor(it.from, it.span);
          } else throw new SimError("wiring", `\`${it.from.join(".")}\` is neither an entry nor a protocol role.`, it.span);
          binds.get(inst)!.set(param, v);
        }
      }
      for (const s of sessions) {
        sessionInfo.push({ name: s.name, protocol: s.protocol, roles: s.roles.map((r) => ({ role: r, owner: s.owners.get(r) ?? "(unassigned)" })) });
        for (const role of s.roles) {
          if (s.owners.get(role) !== "external") continue;
          const ep = endpointFor([s.name, role], arch.span);
          procs.push({ name: `external ${role}`, component: "(simulated external peer)", gen: sim.externalPeer(ep, opts.extPolicy ?? 0), status: "ready", external: true });
        }
      }
      const processItems = arch.items.filter((i): i is Extract<ArchItem, { k: "process" }> => i.k === "process");
      for (const it of processItems) {
        const comp = instances.get(it.target);
        if (!comp) throw new SimError("wiring", `Process \`${it.name}\` activates \`${it.target}\`, which is not an instance.`, it.span);
        procs.push({ name: it.target, component: comp.name, gen: sim.runComponent(it.target, comp, binds.get(it.target)!), status: "ready" });
        sim.trace.push({ kind: "start", proc: it.target, detail: `${it.name}: ${comp.name}` });
      }
      // Externals start after internal processes so lanes read left to right.
      procs.sort((a, b) => Number(!!a.external) - Number(!!b.external));
      if (processItems.length === 0) throw new SimError("wiring", `Architecture \`${arch.name}\` declares no \`process\`, so nothing runs.`, arch.nameSpan);
      for (const [key, owner] of roleOwners) {
        if (owner !== "external" && !issued.has(key)) {
          throw new SimError("wiring", `Role \`${key}\` is assigned to \`${owner}\`, but its endpoint is never bound to a parameter (add \`bind ${owner}.endpoint = ${key};\`).`, arch.nameSpan);
        }
      }
    }

    if (opts.order) {
      // Explore a different scheduling order: rotate/reverse the internal processes.
      const internal = procs.filter((p) => !p.external), ext = procs.filter((p) => p.external);
      const k = opts.order % internal.length;
      const rotated = [...internal.slice(k), ...internal.slice(0, k)];
      if (opts.order >= internal.length) rotated.reverse();
      procs.splice(0, procs.length, ...rotated, ...ext);
    }
    // Scheduler: run each ready process until it blocks; pair complementary requests.
    const isOut = (r: Req) => r.op === "send" || r.op === "select";
    for (let rounds = 0; ; rounds++) {
      for (const p of procs) {
        while (p.status === "ready") {
          let step: IteratorResult<Req, { status: string; text: string }>;
          try {
            step = p.gen.next(p.resume);
          } catch (err) {
            if (err instanceof SimError) { err.process = err.process ?? p.name; throw err; }
            throw err;
          }
          p.resume = undefined;
          if (step.done) {
            p.status = "done";
            p.result = step.value;
            const ev = step.value.status === "rejected" ? "reject" : step.value.status === "failed" ? "fail" : "return";
            if (!p.external) sim.trace.push({ kind: ev, proc: p.name, text: step.value.text, step: sim.steps } as TraceEvent);
          } else {
            p.status = "blocked";
            p.pending = step.value;
          }
        }
      }
      // Match pending requests per session (deterministic: process order).
      let progressed = false;
      for (const pa of procs) {
        if (pa.status !== "blocked" || !pa.pending) continue;
        const a = pa.pending;
        const pb = procs.find((q) => q !== pa && q.status === "blocked" && q.pending && q.pending.ep.session === a.ep.session && q.pending.ep.role !== a.ep.role);
        if (!pb) continue;
        const b = pb.pending!;
        if (isOut(a) === isOut(b)) continue; // both sending or both receiving: they wait (possibly forever)
        const [ps, pr] = isOut(a) ? [pa, pb] : [pb, pa];
        const snd = ps.pending!, rcv = pr.pending!;
        if (snd.op === "send" && rcv.op === "recv") {
          sim.trace.push({ kind: "message", from: ps.name, to: pr.name, session: snd.ep.session.name, text: renderVal(snd.value), step: sim.steps, span: snd.span });
          for (const oid of sim.oidsIn(snd.value)) sim.trace.push({ kind: "own", op: "move", oid, proc: ps.name, to: pr.name, text: "sent", step: sim.steps, span: snd.span });
          pr.resume = snd.value;
        } else if (snd.op === "select" && rcv.op === "offer") {
          sim.trace.push({ kind: "select", from: ps.name, to: pr.name, session: snd.ep.session.name, label: snd.label, text: snd.args.length ? `${snd.label}(${snd.args.map((x) => renderVal(x)).join(", ")})` : snd.label, step: sim.steps, span: snd.span });
          pr.resume = { label: snd.label, args: snd.args };
        } else {
          throw new SimError("protocol", `The two sides of \`${a.ep.session.name}\` disagree: \`${ps.name}\` wants to ${snd.op} while \`${pr.name}\` wants to ${rcv.op === "recv" ? "receive" : rcv.op}. The protocol's roles are not dual.`, snd.span, ps.name);
        }
        ps.resume = ps.resume ?? undefined;
        pa.status = "ready"; pb.status = "ready"; pa.pending = undefined; pb.pending = undefined;
        progressed = true;
      }
      if (procs.every((p) => p.status === "done")) break;
      if (!progressed && procs.every((p) => p.status !== "ready")) {
        const blocked = procs.filter((p) => p.status === "blocked");
        const describe = (p: Proc) => {
          const r = p.pending!;
          const peerRole = r.ep.session.roles.find((x) => x !== r.ep.role);
          const peer = procs.find((q) => q !== p && q.pending?.ep.session === r.ep.session) ?? procs.find((q) => q.name === r.ep.session.owners.get(peerRole ?? ""));
          const peerState = peer?.status === "done" ? `, but \`${peer.name}\` has already finished` : r.ep.session.closed.has(`${peerRole}!failed`) ? ", but the peer failed" : "";
          return `\`${p.name}\` waits to ${r.op === "recv" ? "receive" : r.op} on ${r.ep.session.name}.${r.ep.role}${peerState}`;
        };
        throw new SimError("deadlock", `Deadlock: no process can make progress. ${blocked.map(describe).join("; ")}.`, blocked[0]?.pending?.span, blocked[0]?.name,
          "Check that both sides of each protocol perform matching steps in the same order.");
      }
      if (rounds > 1_000_000) throw new SimError("limit", "Scheduler round limit reached.");
    }
    return result(true);
  } catch (err) {
    if (err instanceof SimError) return result(false, err);
    if (err instanceof ReturnSignal || err instanceof ContinueSignal || err instanceof BreakSignal) {
      return result(false, new SimError("runtime", "Control flow escaped its construct."));
    }
    if (err instanceof RangeError) {
      return result(false, new SimError("limit", "Recursion is too deep for the simulator (the call stack overflowed).", undefined, undefined,
        "Check the base case of your `recursive fn`, or use a `loop` instead."));
    }
    return result(false, new SimError("runtime", `Internal simulator error: ${(err as Error).message}`));
  }
}
