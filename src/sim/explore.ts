// Bug hunter: bounded exhaustive exploration on top of the simulator.
//
// Instead of one run, it tries boundary values for every entry (or function
// parameter), several scheduling orders and several external-peer strategies,
// and reports each distinct failure with the smallest input found for it.
// It is a bounded search, not a proof: "no failures" means none within the bound.

import type { Program, Decl, TypeExpr } from "./ast";
import { Simulator, SimError, Val, Env, run, renderVal, renderType, RunOptions, ErrorKind } from "./interp";

export interface Finding {
  kind: ErrorKind;
  message: string;
  hint?: string;
  span?: [number, number];
  process?: string;
  where: string; // program or function name
  inputs: { name: string; text: string }[];
  replay?: { inputs: Record<string, string>; order: number; extPolicy: number };
  count: number;
}
export interface ExploreResult {
  mode: "program" | "functions" | "none";
  runs: number;
  skipped: number; // inputs the program's own contract excludes
  inconclusive: number; // runs that hit the step limit
  findings: Finding[];
  truncated: boolean;
  ms: number;
  targets: string[];
  unsupported: string[];
}

const CAP = 4;

/** Candidate values for a type: boundaries and small cases. undefined = cannot generate. */
export function candidates(sim: Simulator, type: TypeExpr, depth = 0): Val[] | undefined {
  const t = sim.resolveAlias(type);
  if (depth > 3) return undefined;
  switch (t.k) {
    case "int": {
      const max = t.signed ? (1n << BigInt(t.bits - 1)) - 1n : (1n << BigInt(t.bits)) - 1n;
      const vs = t.signed ? [0n, 1n, -1n, max, -max - 1n] : [0n, 1n, 2n, max];
      return vs.map((v) => ({ k: "int", v, bits: t.bits, signed: t.signed }));
    }
    case "bool": return [{ k: "bool", v: true }, { k: "bool", v: false }];
    case "unit": return [{ k: "unit" }];
    case "string": return [{ k: "string", v: "" }, { k: "string", v: "a" }];
    case "char": return [{ k: "char", v: "a" }];
    case "float": return [{ k: "float", v: 0, bits: t.bits }, { k: "float", v: 1.5, bits: t.bits }];
    case "bytes": return [{ k: "bytes", id: sim.fresh() }];
    case "proof": return [{ k: "proof", text: "assumed" }];
    case "refine": {
      const base = candidates(sim, t.base, depth);
      if (!base) return undefined;
      const ok = base.filter((v) => {
        const env = new Env();
        env.vars.set(t.v, { name: t.v, value: v, borrowed: 0 });
        try { return sim.evalPropSync({ proc: "?", env, ghost: true }, t.prop); } catch { return false; }
      });
      // Boundaries rarely satisfy a refinement; probe a few small values too.
      if (!ok.length && base[0]?.k === "int") {
        for (let i = 0n; i < 64n && ok.length < 3; i++) {
          const v: Val = { ...(base[0] as Extract<Val, { k: "int" }>), v: i };
          const env = new Env();
          env.vars.set(t.v, { name: t.v, value: v, borrowed: 0 });
          try { if (sim.evalPropSync({ proc: "?", env, ghost: true }, t.prop)) ok.push(v); } catch { /* skip */ }
        }
      }
      return ok.length ? ok : undefined;
    }
    case "tuple": {
      const parts = t.elems.map((e) => candidates(sim, e, depth + 1));
      if (parts.some((p) => !p)) return undefined;
      return product(parts as Val[][], CAP).map((elems) => ({ k: "tuple", elems }));
    }
    case "named": {
      const d = sim.decls.get(t.name);
      if (d?.k === "record") {
        const parts = d.fields.map((f) => candidates(sim, f.type, depth + 1));
        if (parts.some((p) => !p)) return undefined;
        return product(parts as Val[][], CAP).map((vals) => ({ k: "record", type: d.name, fields: new Map(d.fields.map((f, i) => [f.name, vals[i]])) }));
      }
      if (d?.k === "data") {
        const out: Val[] = [];
        for (const v of d.variants) {
          const types = v.tuple ?? v.fields?.map((f) => f.type) ?? [];
          const parts = types.map((e) => candidates(sim, e, depth + 1));
          if (parts.some((p) => !p)) continue;
          for (const payload of product(parts as Val[][], 2)) {
            out.push({ k: "variant", type: d.name, tag: v.name, payload, fields: v.fields ? new Map(v.fields.map((f, i) => [f.name, payload[i]])) : undefined });
          }
        }
        return out.length ? out : undefined;
      }
      return undefined;
    }
    default: return undefined;
  }
}

function product<T>(lists: T[][], cap: number): T[][] {
  let out: T[][] = [[]];
  for (const l of lists) {
    const next: T[][] = [];
    for (const prefix of out) for (const x of l) { next.push([...prefix, x]); if (next.length >= 400) break; }
    out = next;
  }
  // Keep a spread: first, last and evenly spaced combinations.
  if (out.length <= cap * 16) return out;
  const stride = Math.ceil(out.length / (cap * 16));
  return out.filter((_, i) => i % stride === 0 || i === out.length - 1);
}

function entryText(v: Val): string | undefined {
  if (v.k === "int") return v.v.toString();
  if (v.k === "bool") return String(v.v);
  if (v.k === "string") return v.v;
  if (v.k === "char") return v.v;
  if (v.k === "float") return String(v.v);
  return undefined;
}

export function explore(program: Program, userInputs: Record<string, string> = {}, opts: { maxRuns?: number; budgetMs?: number; stepLimit?: number } = {}): ExploreResult {
  const t0 = Date.now();
  const maxRuns = opts.maxRuns ?? 1500, budget = opts.budgetMs ?? 1500, stepLimit = opts.stepLimit ?? 20_000;
  const res: ExploreResult = { mode: "none", runs: 0, skipped: 0, inconclusive: 0, findings: [], truncated: false, ms: 0, targets: [], unsupported: [] };
  const found = new Map<string, Finding>();
  const record = (e: SimError, where: string, inputs: Finding["inputs"], replay?: Finding["replay"]) => {
    const key = `${e.kind}@${e.span?.[0] ?? -1}@${where}`;
    const prev = found.get(key);
    if (prev) { prev.count++; return; }
    found.set(key, { kind: e.kind, message: e.message, hint: e.hint, span: e.span, process: e.process, where, inputs, replay, count: 1 });
  };
  const over = () => res.runs >= maxRuns || Date.now() - t0 > budget;

  const probe = new Simulator(program);
  const target = probe.runTarget();
  if (target) {
    res.mode = "program";
    res.targets.push(target.program?.name ?? target.decl.name);
    const entries = probe.entries();
    const domains: Val[][] = [];
    for (const en of entries) {
      const c = candidates(probe, en.type) ?? [];
      const raw = userInputs[en.name];
      if (raw !== undefined && /^-?\d+$/.test(raw.trim()) && c[0]?.k === "int") c.unshift({ ...(c[0] as Extract<Val, { k: "int" }>), v: BigInt(raw.trim()) });
      if (!c.length) { res.unsupported.push(`entry ${en.name} : ${en.typeText}`); res.ms = Date.now() - t0; return res; }
      domains.push(c);
    }
    const nProcs = target.kind === "architecture" ? target.decl.items.filter((i) => i.k === "process").length : 1;
    const hasExternal = target.kind === "architecture" && target.decl.items.some((i) => i.k === "role" && i.target === "external");
    const orders = nProcs > 1 ? Math.min(nProcs * 2, 6) : 1;
    const policies = hasExternal ? 3 : 1;
    outer:
    for (const combo of product(domains, CAP)) {
      for (let order = 0; order < orders; order++) {
        for (let extPolicy = 0; extPolicy < policies; extPolicy++) {
          if (over()) { res.truncated = true; break outer; }
          const values = new Map(entries.map((en, i) => [en.name, combo[i]]));
          const o: RunOptions = { stepLimit, order, extPolicy, entryValues: values };
          const r = run(program, {}, o);
          res.runs++;
          if (r.ok) continue;
          const e = r.error!;
          if (e.kind === "limit") { res.inconclusive++; continue; }
          if (e.message.startsWith("Input `")) { res.skipped++; continue; } // excluded by the entry's own type
          const texts: Record<string, string> = {};
          let replayable = true;
          entries.forEach((en, i) => { const t = entryText(combo[i]); if (t === undefined) { if (combo[i].k !== "bytes") replayable = false; } else texts[en.name] = t; });
          record(e, res.targets[0], entries.map((en, i) => ({ name: en.name, text: renderVal(combo[i]) })), replayable ? { inputs: texts, order, extPolicy } : undefined);
        }
      }
    }
  } else {
    // No runnable program: check every function on generated arguments.
    const fns = program.decls.filter((d): d is Extract<Decl, { k: "fn" }> => d.k === "fn");
    if (fns.length) res.mode = "functions";
    for (const fn of fns) {
      const domains = fn.params.map((p) => candidates(probe, p.type));
      if (domains.some((d) => !d)) {
        const bad = fn.params[domains.findIndex((d) => !d)];
        res.unsupported.push(`${fn.name}(${bad.name} : ${renderType(bad.type)})`);
        continue;
      }
      res.targets.push(fn.name);
      for (const combo of product(domains as Val[][], CAP)) {
        if (over()) { res.truncated = true; break; }
        const sim = new Simulator(program, { stepLimit });
        // Linear arguments must be distinct objects per run.
        const args = combo.map((v) => (v.k === "bytes" ? { k: "bytes" as const, id: sim.fresh() } : v));
        res.runs++;
        try {
          const g = sim.callFn({ proc: fn.name, env: new Env(), ghost: false }, fn, args, fn.nameSpan);
          const step = g.next();
          if (!step.done) res.inconclusive++; // communicates; needs an architecture
        } catch (err) {
          if (!(err instanceof SimError)) continue; // reject / fail outcomes are legitimate results
          if (err.kind === "limit") { res.inconclusive++; continue; }
          if (err.kind === "unsupported") { res.inconclusive++; continue; }
          if (err.message.startsWith(`Precondition of \`${fn.name}\``) || err.message.startsWith("Argument `")) { res.skipped++; continue; }
          record(err, fn.name, fn.params.map((p, i) => ({ name: p.name, text: renderVal(args[i]) })));
        }
      }
    }
  }
  res.findings = [...found.values()].sort((a, b) => (a.span?.[0] ?? 0) - (b.span?.[0] ?? 0));
  res.ms = Date.now() - t0;
  return res;
}
