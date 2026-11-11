// Abstract syntax for the executable part of Phil Grammar v1.
//
// The AST parser runs only after src/parser.ts has accepted the file, so it can
// assume syntactically valid input. Static-only clauses that do not affect the
// simulator (generic requirements, effects, authority, cost, …) are skipped.

import { lex, Token } from "../lexer";

export type Span = [number, number];

// ------------------------------------------------------------------ types

export type TypeExpr =
  | { k: "unit" } | { k: "bool" } | { k: "char" } | { k: "string" } | { k: "float"; bits: 32 | 64 }
  | { k: "int"; signed: boolean; bits: number }
  | { k: "bytes" }
  | { k: "proof"; prop: Prop }
  | { k: "named"; name: string; args: StaticArg[] }
  | { k: "refine"; v: string; base: TypeExpr; prop: Prop }
  | { k: "tuple"; elems: TypeExpr[] }
  | { k: "opaque"; text: string };

export type StaticArg = { k: "type"; type: TypeExpr } | { k: "session"; session: Session } | { k: "other" };

export type Session =
  | { k: "send" | "receive"; param: Param; cont: Session }
  | { k: "select" | "offer"; branches: SessionBranch[] }
  | { k: "end"; name: string }
  | { k: "rec"; name: string; body: Session }
  | { k: "continue"; name: string }
  | { k: "ref"; name: string };
export interface SessionBranch { label: string; params: Param[]; cont: Session }

export interface Param { name: string; type: TypeExpr; span: Span }

// ------------------------------------------------------------------ propositions

export type Prop =
  | { k: "or" | "and"; l: Prop; r: Prop; span: Span }
  | { k: "not"; p: Prop; span: Span }
  | { k: "rel"; op: string; l: Expr; r: Expr; span: Span }
  | { k: "bool"; value: boolean; span: Span }
  | { k: "claim"; name: string; args: Expr[]; span: Span };

// ------------------------------------------------------------------ expressions

export type Expr = (
  | { k: "int"; value: bigint }
  | { k: "float"; value: number }
  | { k: "string"; value: string }
  | { k: "char"; value: string }
  | { k: "bool"; value: boolean }
  | { k: "unit" }
  | { k: "name"; path: string[] }
  | { k: "call"; path: string[]; args: Expr[]; fields: string[] }
  | { k: "field"; target: Expr; name: string }
  | { k: "tuple"; elems: Expr[] }
  | { k: "binop"; op: string; l: Expr; r: Expr }
  | { k: "neg"; e: Expr }
  | { k: "construct"; type: string; fields: { name: string; value: Expr }[] }
  | { k: "borrow"; target: Expr; as: string; block: Block }
  | { k: "if"; cond: Expr; join?: Join; then: Block; else?: Block }
  | { k: "match" | "decide"; target: Expr; join?: Join; arms: Arm[] }
  | { k: "closure"; mode?: string; params: Param[]; satisfies: string; captures?: string[]; block: Block }
  | { k: "loop"; state: { name: string; type?: TypeExpr; init: Expr }[]; invariant?: Prop; block: Block }
  | { k: "continue" | "break"; args: Expr[] }
  | { k: "receive"; type: TypeExpr; on: Expr }
  | { k: "send"; value: Expr; on: Expr }
  | { k: "select"; label: string; args: Expr[]; on: Expr }
  | { k: "offer"; on: Expr; arms: Arm[] }
  | { k: "reject"; e: Expr }
  | { k: "fail"; target: string; args: Expr[]; on?: Expr }
  | { k: "close" | "release"; e: Expr }
  | { k: "convert"; e: Expr; type: TypeExpr }
  | { k: "accept"; e: Expr; type: TypeExpr }
  | { k: "transport"; e: Expr; type: TypeExpr }
  | { k: "prove"; prop: Prop }
  | { k: "fallback"; base: Expr; mode: "fail"; target: string; args: Expr[] }
  | { k: "fallback"; base: Expr; mode: "reject"; e: Expr }
  | { k: "unsupported"; keyword: string }
) & { span: Span };

export interface Join { slots: Param[]; invariant?: Prop }
export interface ArmPattern { path: string[]; binders?: string[]; fieldBinders?: { field: string; as: string }[] }
export interface Arm { pattern: ArmPattern; body: Block | Stmt; span: Span }

export type Pattern =
  | { k: "id"; name: string; span: Span }
  | { k: "tuple"; elems: Pattern[]; span: Span }
  | { k: "record"; type: string; fields: { name: string; pattern?: Pattern; span: Span }[]; span: Span };

export type Stmt =
  | { k: "let"; pattern: Pattern; value: Expr; span: Span }
  | { k: "return"; value: Expr; span: Span }
  | { k: "expr"; value: Expr; span: Span };
export interface Block { stmts: Stmt[]; span: Span }

// ------------------------------------------------------------------ declarations

export type Mode = "unrestricted" | "affine" | "linear";

export type Decl = (
  | { k: "record"; name: string; mode?: Mode; fields: Param[] }
  | { k: "data"; name: string; mode?: Mode; variants: { name: string; tuple?: TypeExpr[]; fields?: Param[]; span: Span }[] }
  | { k: "type"; name: string; type: TypeExpr }
  | { k: "claim"; name: string; params: Param[]; body?: Prop }
  | { k: "callable"; name: string; params: Param[]; ret: TypeExpr; requires: Prop[]; ensures: Prop[]; outcomes: { kind: string; type: TypeExpr }[] }
  | { k: "fn"; name: string; params: Param[]; ret?: TypeExpr; satisfies: string; body: Block }
  | { k: "protocol"; name: string; roles: { name: string; session: Session }[] }
  | { k: "capability"; name: string; mode: Mode }
  | { k: "component"; name: string; params: Param[]; provides?: TypeExpr; body: Block }
  | { k: "architecture"; name: string; items: ArchItem[] }
  | { k: "program"; name: string; target: string; entries: Param[] }
  | { k: "other"; name: string; what: string }
) & { span: Span; nameSpan: Span };

export type ArchItem =
  | { k: "instance"; name: string; target: string; span: Span }
  | { k: "process"; name: string; target: string; span: Span }
  | { k: "protocol"; name: string; target: string; span: Span }
  | { k: "role"; path: string[]; target: string[] | "external"; span: Span }
  | { k: "bind"; to: string[]; from: string[]; span: Span }
  | { k: "entry"; name: string; type: TypeExpr; span: Span }
  | { k: "other"; span: Span };

export interface Program { decls: Decl[]; source: string }

// ------------------------------------------------------------------ parser

class AstError extends Error {}

const COMMANDS = new Set([
  "construct", "borrow", "if", "match", "decide", "closure", "loop", "continue", "break", "receive_frame",
  "receive_exact", "receive", "recognize", "validate", "send_exact", "send", "select", "offer", "commit_receive",
  "reject", "fail", "close", "release", "convert", "transport", "accept", "invoke", "prove",
]);

class P {
  p = 0;
  constructor(readonly toks: Token[]) {}
  get t(): Token { return this.toks[this.p]; }
  at(k: number): Token { return this.toks[Math.min(this.p + k, this.toks.length - 1)]; }
  isSym(s: string, k = 0) { const t = this.at(k); return t.kind === "sym" && t.text === s; }
  isKw(s: string, k = 0) { const t = this.at(k); return t.kind === "kw" && t.text === s; }
  next(): Token { return this.toks[this.p++]; }
  sym(s: string): Token { if (!this.isSym(s)) throw new AstError(`expected ${s} at ${this.t.text}`); return this.next(); }
  kw(s: string): Token { if (!this.isKw(s)) throw new AstError(`expected ${s} at ${this.t.text}`); return this.next(); }
  eatSym(s: string) { if (this.isSym(s)) { this.p++; return true; } return false; }
  eatKw(s: string) { if (this.isKw(s)) { this.p++; return true; } return false; }
  ident(): string { const t = this.next(); if (t.kind !== "ident") throw new AstError(`expected identifier at ${t.text}`); return t.text; }
  span(startTok: number): Span { return [this.toks[startTok].start, this.toks[Math.max(this.p - 1, startTok)].end]; }

  /** Backtracking helper: run fn, restore position if it throws. */
  try<T>(fn: () => T): T | undefined {
    const save = this.p;
    try { return fn(); } catch (e) { if (!(e instanceof AstError)) throw e; this.p = save; return undefined; }
  }
  /** Skip a balanced group starting at the current opener. */
  skipGroup(): void {
    const open = this.next().text;
    const close = open === "(" ? ")" : open === "[" ? "]" : "}";
    let depth = 1;
    while (depth > 0 && this.t.kind !== "eof") {
      const t = this.next();
      if (t.kind === "sym" && t.text === open) depth++;
      else if (t.kind === "sym" && t.text === close) depth--;
    }
  }
  /** Skip to and including the next `;` at depth 0. */
  skipItem(): void {
    let depth = 0;
    while (this.t.kind !== "eof") {
      const t = this.next();
      if (t.kind !== "sym") continue;
      if ("([{".includes(t.text)) depth++;
      else if (")]}".includes(t.text)) depth--;
      else if (t.text === ";" && depth === 0) return;
    }
  }

  qname(): string[] {
    const parts = [this.ident()];
    while (this.isSym(".") && this.at(1).kind === "ident") { this.p++; parts.push(this.ident()); }
    return parts;
  }

  // ---------------------------------------------------------------- file

  file(): Decl[] {
    const decls: Decl[] = [];
    if (this.eatKw("module")) this.skipItem();
    while (this.isKw("import")) this.skipItem();
    while (this.t.kind !== "eof") {
      while (this.isSym("@")) { this.p++; this.ident(); this.skipGroup(); }
      decls.push(this.decl());
    }
    return decls;
  }

  genericsAndReqs(): void {
    if (this.isSym("[")) this.skipGroup();
  }
  requiresBlock(): void {
    if (this.isKw("requires") && this.isSym("{", 1)) { this.p++; this.skipGroup(); }
  }
  mode(): Mode | undefined {
    if (this.eatKw("mode")) return this.next().text as Mode;
    return undefined;
  }

  decl(): Decl {
    const start = this.p;
    const t = this.t;
    const named = <T extends object>(kw: string, f: (name: string, nameSpan: Span) => T): T & { span: Span; nameSpan: Span } => {
      while (this.t.kind === "kw" && this.t.text !== kw) this.p++;
      this.kw(kw);
      const nt = this.p;
      const name = this.ident();
      const nameSpan: Span = [this.toks[nt].start, this.toks[nt].end];
      const out = f(name, nameSpan);
      return { ...out, span: this.span(start), nameSpan };
    };
    switch (t.text) {
      case "record":
        return named("record", (name) => {
          this.genericsAndReqs();
          const mode = this.mode();
          this.requiresBlock();
          this.sym("{");
          const fields = this.fieldList("}");
          this.sym("}");
          return { k: "record" as const, name, mode, fields };
        });
      case "data":
        return named("data", (name) => {
          this.genericsAndReqs();
          const mode = this.mode();
          this.requiresBlock();
          this.sym("=");
          const variants: { name: string; tuple?: TypeExpr[]; fields?: Param[]; span: Span }[] = [];
          do {
            const vs = this.p;
            const vname = this.ident();
            let tuple: TypeExpr[] | undefined, fields: Param[] | undefined;
            if (this.eatSym("(")) {
              tuple = [];
              if (!this.isSym(")")) { do tuple.push(this.type()); while (this.eatSym(",")); }
              this.sym(")");
            } else if (this.eatSym("{")) {
              fields = this.fieldList("}");
              this.sym("}");
            }
            variants.push({ name: vname, tuple, fields, span: this.span(vs) });
          } while (this.eatSym("|"));
          this.sym(";");
          return { k: "data" as const, name, mode, variants };
        });
      case "type":
        return named("type", (name) => {
          this.genericsAndReqs();
          this.requiresBlock();
          this.sym("=");
          const type = this.type();
          this.sym(";");
          return { k: "type" as const, name, type };
        });
      case "claim":
        return named("claim", (name) => {
          this.genericsAndReqs();
          this.requiresBlock();
          const params = this.isSym("(") ? this.params() : [];
          const body = this.eatSym("=") ? this.prop() : undefined;
          this.sym(";");
          return { k: "claim" as const, name, params, body };
        });
      case "callable":
        return named("callable", (name) => {
          this.genericsAndReqs();
          this.requiresBlock();
          const params = this.params();
          this.sym("->");
          const ret = this.type();
          const requires: Prop[] = [], ensures: Prop[] = [], outcomes: { kind: string; type: TypeExpr }[] = [];
          this.sym("{");
          while (!this.isSym("}")) {
            if (this.eatKw("requires")) { requires.push(this.prop()); this.sym(";"); }
            else if (this.eatKw("ensures")) { ensures.push(this.prop()); this.sym(";"); }
            else if (this.eatKw("outcomes")) {
              this.sym("{");
              while (!this.isSym("}")) {
                const kind = this.next().text;
                outcomes.push({ kind, type: this.type() });
                this.eatSym(",");
              }
              this.sym("}");
              this.sym(";");
            } else if (this.isKw("outcome")) {
              this.p++; this.next(); this.type(); this.skipGroup();
            } else this.skipItem();
          }
          this.sym("}");
          return { k: "callable" as const, name, params, ret, requires, ensures, outcomes };
        });
      case "recursive":
      case "fn":
        return named("fn", (name) => {
          this.genericsAndReqs();
          this.requiresBlock();
          const params = this.params();
          const ret = this.eatSym("->") ? this.type() : undefined;
          this.kw("satisfies");
          const satisfies = this.typeName();
          const body = this.block();
          return { k: "fn" as const, name, params, ret, satisfies, body };
        });
      case "protocol":
        return named("protocol", (name) => {
          this.genericsAndReqs();
          this.requiresBlock();
          this.sym("{");
          const roles: { name: string; session: Session }[] = [];
          while (this.eatKw("role")) {
            const rname = this.ident();
            this.sym("=");
            roles.push({ name: rname, session: this.session() });
            this.sym(";");
          }
          this.sym("}");
          return { k: "protocol" as const, name, roles };
        });
      case "capability":
        return named("capability", (name) => {
          this.genericsAndReqs();
          const mode = this.mode() ?? "linear";
          this.requiresBlock();
          this.skipGroup();
          return { k: "capability" as const, name, mode };
        });
      case "component":
        return named("component", (name) => {
          this.genericsAndReqs();
          this.requiresBlock();
          const params = this.isSym("(") ? this.params() : [];
          const provides = this.eatKw("provides") ? this.type() : undefined;
          const body = this.block();
          return { k: "component" as const, name, params, provides, body };
        });
      case "architecture":
        return named("architecture", (name) => {
          this.genericsAndReqs();
          this.requiresBlock();
          this.sym("{");
          const items: ArchItem[] = [];
          while (!this.isSym("}")) items.push(this.archItem());
          this.sym("}");
          return { k: "architecture" as const, name, items };
        });
      case "program":
        return named("program", (name) => {
          this.sym("=");
          this.kw("instantiate");
          const target = this.typeName();
          const entries: Param[] = [];
          if (this.eatSym("{")) {
            while (!this.isSym("}")) {
              const s = this.p;
              if (this.eatKw("entry")) {
                const ename = this.ident(); this.sym(":");
                entries.push({ name: ename, type: this.type(), span: this.span(s) });
                this.sym(";");
              } else this.skipItem();
            }
            this.sym("}");
          }
          this.sym(";");
          return { k: "program" as const, name, target, entries };
        });
      default: {
        // provider / implementation / boundary / opaque: kept as named placeholders.
        const what = t.text;
        while (this.t.kind === "kw") this.p++;
        const nt = this.p;
        const name = this.ident();
        const nameSpan: Span = [this.toks[nt].start, this.toks[nt].end];
        // Skip to the end of the declaration: either `;` or a balanced `{...}` at depth 0.
        while (this.t.kind !== "eof") {
          if (this.isSym("{")) { this.skipGroup(); if (!this.isSym(";")) break; }
          if (this.isSym("[") || this.isSym("(")) { this.skipGroup(); continue; }
          if (this.eatSym(";")) break;
          this.p++;
        }
        return { k: "other", name, what, span: this.span(start), nameSpan };
      }
    }
  }

  archItem(): ArchItem {
    const s = this.p;
    const t = this.next().text;
    switch (t) {
      case "instance": case "process": case "protocol": {
        const name = this.ident(); this.sym("=");
        const target = this.qname().join(".");
        if (this.isSym("[")) this.skipGroup();
        this.sym(";");
        return { k: t, name, target, span: this.span(s) };
      }
      case "role": {
        const path = this.qname(); this.sym("=");
        const target = this.eatKw("external") ? "external" as const : this.qname();
        this.sym(";");
        return { k: "role", path, target, span: this.span(s) };
      }
      case "bind": {
        const to = this.qname(); this.sym("=");
        const from = this.qname(); this.sym(";");
        return { k: "bind", to, from, span: this.span(s) };
      }
      case "entry": {
        const name = this.ident(); this.sym(":");
        const type = this.type(); this.sym(";");
        return { k: "entry", name, type, span: this.span(s) };
      }
      default:
        this.p--;
        this.skipItem();
        return { k: "other", span: this.span(s) };
    }
  }

  fieldList(close: string): Param[] {
    const out: Param[] = [];
    while (!this.isSym(close)) {
      const s = this.p;
      const name = this.ident(); this.sym(":");
      out.push({ name, type: this.type(), span: this.span(s) });
      if (!this.eatSym(",")) break;
    }
    return out;
  }
  params(): Param[] {
    this.sym("(");
    const out = this.fieldList(")");
    this.sym(")");
    return out;
  }

  // ---------------------------------------------------------------- types

  typeName(): string {
    const name = this.qname().join(".");
    if (this.isSym("[")) this.skipGroup();
    return name;
  }
  type(): TypeExpr {
    const t = this.t;
    if (t.kind === "uint" || t.kind === "sint") { this.p++; return { k: "int", signed: t.kind === "sint", bits: parseInt(t.text.slice(1), 10) }; }
    if (t.kind === "kw") {
      switch (t.text) {
        case "Unit": this.p++; return { k: "unit" };
        case "Bool": this.p++; return { k: "bool" };
        case "Char": this.p++; return { k: "char" };
        case "String": this.p++; return { k: "string" };
        case "F32": this.p++; return { k: "float", bits: 32 };
        case "F64": this.p++; return { k: "float", bits: 64 };
        case "Bytes": this.p++; if (this.isSym("[")) this.skipGroup(); return { k: "bytes" };
        case "Proof": { this.p++; this.sym("["); const prop = this.prop(); this.sym("]"); return { k: "proof", prop }; }
        case "Frame": case "Validated": { const s = this.p; this.p++; this.skipGroup(); return { k: "opaque", text: this.toks.slice(s, this.p).map((x) => x.text).join("") }; }
      }
    }
    if (this.isSym("{")) {
      this.p++;
      const v = this.ident(); this.sym(":");
      const base = this.type(); this.sym("|");
      const prop = this.prop(); this.sym("}");
      return { k: "refine", v, base, prop };
    }
    if (this.isSym("(")) {
      this.p++;
      const elems = [this.type()];
      while (this.eatSym(",")) elems.push(this.type());
      this.sym(")");
      return { k: "tuple", elems };
    }
    const name = this.qname().join(".");
    const args: StaticArg[] = [];
    if (this.eatSym("[")) {
      while (!this.isSym("]")) {
        const before = this.p;
        const sess = ["send", "receive", "select", "offer", "end", "recursive", "continue"].includes(this.t.text) && this.t.kind === "kw"
          ? this.try(() => this.session()) : undefined;
        if (sess) args.push({ k: "session", session: sess });
        else {
          const ty = this.try(() => this.type());
          if (ty && (this.isSym(",") || this.isSym("]"))) args.push({ k: "type", type: ty });
          else {
            this.p = before;
            let depth = 0;
            while (this.t.kind !== "eof" && !(depth === 0 && (this.isSym(",") || this.isSym("]")))) {
              if (this.t.kind === "sym" && "([{".includes(this.t.text)) depth++;
              if (this.t.kind === "sym" && ")]}".includes(this.t.text)) depth--;
              this.p++;
            }
            args.push({ k: "other" });
          }
        }
        if (!this.eatSym(",")) break;
      }
      this.sym("]");
    }
    return { k: "named", name, args };
  }

  session(): Session {
    const t = this.t;
    if (t.kind === "kw") {
      switch (t.text) {
        case "send": case "receive": {
          this.p++; this.sym("(");
          const s = this.p;
          const name = this.ident(); this.sym(":");
          const param: Param = { name, type: this.type(), span: this.span(s) };
          this.sym(")");
          if (this.eatKw("using")) this.typeName();
          if (this.eatKw("when")) this.prop();
          this.kw("then");
          return { k: t.text, param, cont: this.session() };
        }
        case "select": case "offer": {
          this.p++; this.sym("{");
          const branches: SessionBranch[] = [];
          do {
            const label = this.ident();
            const params: Param[] = this.isSym("(") ? this.params() : [];
            if (this.eatKw("using")) this.typeName();
            if (this.eatKw("when")) this.prop();
            this.sym("=>");
            branches.push({ label, params, cont: this.session() });
          } while (this.eatSym("|"));
          this.sym("}");
          return { k: t.text, branches };
        }
        case "end": this.p++; return { k: "end", name: this.ident() };
        case "recursive": { this.p++; const name = this.ident(); this.sym("="); return { k: "rec", name, body: this.session() }; }
        case "continue": this.p++; return { k: "continue", name: this.ident() };
      }
    }
    return { k: "ref", name: this.typeName() };
  }

  // ---------------------------------------------------------------- statements

  block(): Block {
    const s = this.p;
    this.sym("{");
    const stmts: Stmt[] = [];
    while (!this.isSym("}")) stmts.push(this.stmt());
    this.sym("}");
    return { stmts, span: this.span(s) };
  }
  stmt(): Stmt {
    const s = this.p;
    if (this.eatKw("let")) {
      const pattern = this.pattern(); this.sym("=");
      const value = this.expr(); this.sym(";");
      return { k: "let", pattern, value, span: this.span(s) };
    }
    if (this.eatKw("return")) {
      const value = this.expr(); this.sym(";");
      return { k: "return", value, span: this.span(s) };
    }
    const value = this.expr(); this.sym(";");
    return { k: "expr", value, span: this.span(s) };
  }
  pattern(): Pattern {
    const s = this.p;
    if (this.isSym("(")) {
      this.p++;
      const elems = [this.pattern()];
      while (this.eatSym(",")) elems.push(this.pattern());
      this.sym(")");
      return { k: "tuple", elems, span: this.span(s) };
    }
    const rec = this.try(() => {
      const type = this.qname().join(".");
      this.sym("{");
      const fields: { name: string; pattern?: Pattern; span: Span }[] = [];
      while (!this.isSym("}")) {
        const fs = this.p;
        const name = this.ident();
        const pattern = this.eatSym("=") ? this.pattern() : undefined;
        fields.push({ name, pattern, span: this.span(fs) });
        if (!this.eatSym(",")) break;
      }
      this.sym("}");
      return { k: "record" as const, type, fields, span: this.span(s) };
    });
    if (rec) return rec;
    return { k: "id", name: this.ident(), span: this.span(s) };
  }

  // ---------------------------------------------------------------- expressions

  expr(): Expr {
    const s = this.p;
    const base = this.base();
    if (this.isKw("or") && (this.isKw("fail", 1) || this.isKw("reject", 1))) {
      this.p++;
      if (this.eatKw("fail")) {
        const target = this.typeName();
        const args = this.isSym("(") ? this.args() : [];
        return { k: "fallback", base, mode: "fail", target, args, span: this.span(s) };
      }
      this.kw("reject");
      return { k: "fallback", base, mode: "reject", e: this.base(), span: this.span(s) };
    }
    return base;
  }
  args(): Expr[] {
    this.sym("(");
    const out: Expr[] = [];
    if (!this.isSym(")")) { do out.push(this.expr()); while (this.eatSym(",")); }
    this.sym(")");
    return out;
  }
  base(): Expr {
    if (this.t.kind === "kw" && COMMANDS.has(this.t.text)) return this.command();
    return this.shift();
  }
  binary(next: () => Expr, ops: string[]): Expr {
    const s = this.p;
    let l = next();
    while (this.t.kind === "sym" && ops.includes(this.t.text)) {
      const op = this.next().text;
      const r = next();
      l = { k: "binop", op, l, r, span: this.span(s) };
    }
    return l;
  }
  shift(): Expr { return this.binary(() => this.additive(), ["<<", ">>"]); }
  additive(): Expr { return this.binary(() => this.multiplicative(), ["+", "-"]); }
  multiplicative(): Expr { return this.binary(() => this.unary(), ["*", "/", "%"]); }
  unary(): Expr {
    const s = this.p;
    if (this.eatSym("-")) return { k: "neg", e: this.unary(), span: this.span(s) };
    return this.postfix();
  }
  postfix(): Expr {
    const s = this.p;
    if (this.t.kind === "ident") {
      const path = this.qname();
      if (this.isSym("[")) this.skipGroup(); // static arguments are type-level
      if (this.isSym("(")) {
        const args = this.args();
        const fields: string[] = [];
        while (this.isSym(".") && this.at(1).kind === "ident") { this.p++; fields.push(this.ident()); }
        return { k: "call", path, args, fields, span: this.span(s) };
      }
      return { k: "name", path, span: this.span(s) };
    }
    let e = this.primary();
    while (this.isSym(".") && this.at(1).kind === "ident") {
      this.p++;
      e = { k: "field", target: e, name: this.ident(), span: this.span(s) };
    }
    return e;
  }
  primary(): Expr {
    const s = this.p;
    const t = this.next();
    switch (t.kind) {
      case "int": return { k: "int", value: BigInt(t.text), span: this.span(s) };
      case "float": return { k: "float", value: parseFloat(t.text), span: this.span(s) };
      case "string": return { k: "string", value: decodeQuoted(t.text), span: this.span(s) };
      case "char": return { k: "char", value: decodeQuoted(t.text), span: this.span(s) };
    }
    if (t.kind === "kw") {
      if (t.text === "true" || t.text === "false") return { k: "bool", value: t.text === "true", span: this.span(s) };
      if (t.text === "unit") return { k: "unit", span: this.span(s) };
    }
    if (t.kind === "sym" && t.text === "(") {
      const first = this.expr();
      if (this.eatSym(")")) return first;
      const elems = [first];
      while (this.eatSym(",")) elems.push(this.expr());
      this.sym(")");
      return { k: "tuple", elems, span: this.span(s) };
    }
    throw new AstError(`unexpected ${t.text}`);
  }
  arms(): Arm[] {
    this.sym("{");
    const arms: Arm[] = [];
    while (!this.isSym("}")) {
      const s = this.p;
      const path = this.qname();
      const pattern: ArmPattern = { path };
      if (this.eatSym("(")) {
        pattern.binders = [];
        if (!this.isSym(")")) { do pattern.binders.push(this.ident()); while (this.eatSym(",")); }
        this.sym(")");
      } else if (this.eatSym("{")) {
        pattern.fieldBinders = [];
        while (!this.isSym("}")) {
          const field = this.ident();
          const as = this.eatKw("as") ? this.ident() : field;
          pattern.fieldBinders.push({ field, as });
          if (!this.eatSym(",")) break;
        }
        this.sym("}");
      }
      this.sym("=>");
      const body = this.isSym("{") ? this.block() : this.stmt();
      arms.push({ pattern, body, span: this.span(s) });
    }
    this.sym("}");
    return arms;
  }
  join(): Join | undefined {
    if (!this.eatKw("join")) return undefined;
    this.kw("state");
    const slots = this.params();
    const invariant = this.eatKw("invariant") ? this.prop() : undefined;
    return { slots, invariant };
  }
  command(): Expr {
    const s = this.p;
    const kw = this.next().text;
    const done = <T extends object>(o: T) => ({ ...o, span: this.span(s) }) as unknown as Expr;
    switch (kw) {
      case "construct": {
        const type = this.typeName();
        this.sym("{");
        const fields: { name: string; value: Expr }[] = [];
        while (!this.isSym("}")) {
          const name = this.ident(); this.sym("=");
          fields.push({ name, value: this.expr() });
          if (!this.eatSym(",")) break;
        }
        this.sym("}");
        return done({ k: "construct", type, fields });
      }
      case "borrow": {
        const target = this.base(); this.kw("as");
        const as = this.ident();
        return done({ k: "borrow", target, as, block: this.block() });
      }
      case "if": {
        const cond = this.expr();
        const join = this.join();
        const then = this.block();
        const els = this.eatKw("else") ? this.block() : undefined;
        return done({ k: "if", cond, join, then, else: els });
      }
      case "match": {
        const target = this.expr();
        const join = this.join();
        return done({ k: "match", target, join, arms: this.arms() });
      }
      case "decide": {
        const target = this.base();
        return done({ k: "decide", target, arms: this.arms() });
      }
      case "closure": {
        const mode = this.eatKw("mode") ? this.next().text : undefined;
        const params = this.params();
        this.kw("satisfies");
        const satisfies = this.typeName();
        let captures: string[] | undefined;
        if (this.eatKw("captures")) {
          this.sym("(");
          captures = [];
          if (!this.isSym(")")) { do captures.push(this.ident()); while (this.eatSym(",")); }
          this.sym(")");
        }
        return done({ k: "closure", mode, params, satisfies, captures, block: this.block() });
      }
      case "loop": {
        const state: { name: string; type?: TypeExpr; init: Expr }[] = [];
        if (this.eatKw("state")) {
          this.sym("(");
          while (!this.isSym(")")) {
            const name = this.ident();
            const type = this.eatSym(":") ? this.type() : undefined;
            this.sym("=");
            state.push({ name, type, init: this.expr() });
            if (!this.eatSym(",")) break;
          }
          this.sym(")");
        }
        const invariant = this.eatKw("invariant") ? this.prop() : undefined;
        return done({ k: "loop", state, invariant, block: this.block() });
      }
      case "continue": case "break":
        return done({ k: kw, args: this.isSym("(") ? this.args() : [] });
      case "receive": {
        const type = this.type(); this.kw("on");
        return done({ k: "receive", type, on: this.base() });
      }
      case "send": {
        const value = this.base(); this.kw("on");
        return done({ k: "send", value, on: this.base() });
      }
      case "select": {
        const label = this.qname().join(".");
        const args = this.isSym("(") ? this.args() : [];
        if (this.eatKw("using")) this.base();
        this.kw("on");
        return done({ k: "select", label, args, on: this.base() });
      }
      case "offer": {
        const on = this.base();
        return done({ k: "offer", on, arms: this.arms() });
      }
      case "reject": return done({ k: "reject", e: this.base() });
      case "fail": {
        const target = this.typeName();
        const args = this.isSym("(") ? this.args() : [];
        this.kw("on");
        return done({ k: "fail", target, args, on: this.base() });
      }
      case "close": case "release": return done({ k: kw, e: this.base() });
      case "convert": {
        const e = this.expr(); this.kw("to");
        return done({ k: "convert", e, type: this.type() });
      }
      case "accept": {
        const e = this.base(); this.kw("as");
        return done({ k: "accept", e, type: this.type() });
      }
      case "transport": {
        const e = this.base(); this.kw("to");
        const type = this.type(); this.kw("using"); this.base();
        return done({ k: "transport", e, type });
      }
      case "invoke": {
        const path = this.qname();
        if (this.isSym("[")) this.skipGroup();
        return done({ k: "call", path, args: this.args(), fields: [] });
      }
      case "prove": {
        this.sym("(");
        const prop = this.prop();
        this.sym(")");
        return done({ k: "prove", prop });
      }
      default: {
        // receive_frame, receive_exact, recognize, validate, send_exact, commit_receive:
        // parse past them (valid syntax) but mark as unsupported by the simulator.
        this.p = s;
        const end = this.findCommandEnd();
        this.p = end;
        return done({ k: "unsupported", keyword: kw });
      }
    }
  }
  /** For unsupported commands: skip to the token that ends the enclosing expression. */
  findCommandEnd(): number {
    let q = this.p + 1, depth = 0;
    for (; q < this.toks.length - 1; q++) {
      const t = this.toks[q];
      if (t.kind === "sym") {
        if ("([{".includes(t.text)) depth++;
        else if (")]}".includes(t.text)) { if (depth === 0) break; depth--; }
        else if ((t.text === ";" || t.text === ",") && depth === 0) break;
      }
      if (t.kind === "kw" && t.text === "or" && depth === 0) break;
    }
    return q;
  }

  // ---------------------------------------------------------------- propositions

  prop(): Prop {
    const s = this.p;
    let l = this.propAnd();
    while (this.isKw("or")) { this.p++; const r = this.propAnd(); l = { k: "or", l, r, span: this.span(s) }; }
    return l;
  }
  propAnd(): Prop {
    const s = this.p;
    let l = this.propNot();
    while (this.isKw("and")) { this.p++; const r = this.propNot(); l = { k: "and", l, r, span: this.span(s) }; }
    return l;
  }
  propNot(): Prop {
    const s = this.p;
    if (this.eatKw("not")) return { k: "not", p: this.propNot(), span: this.span(s) };
    return this.propAtom();
  }
  relOp(): string | undefined {
    const t = this.t;
    if (t.kind === "sym" && ["==", "!=", "<=", ">=", "<", ">"].includes(t.text)) return t.text;
    if (t.kind === "kw" && (t.text === "in" || t.text === "disjoint")) return t.text;
    return undefined;
  }
  propAtom(): Prop {
    const s = this.p;
    const rel = this.try(() => {
      const l = this.shift();
      const op = this.relOp();
      if (!op) throw new AstError("no relation");
      this.p++;
      const r = this.shift();
      return { k: "rel" as const, op, l, r, span: this.span(s) };
    });
    if (rel) return rel;
    if (this.eatSym("(")) { const p = this.prop(); this.sym(")"); return p; }
    if (this.isKw("true") || this.isKw("false")) return { k: "bool", value: this.next().text === "true", span: this.span(s) };
    const name = this.typeName();
    return { k: "claim", name, args: this.args(), span: this.span(s) };
  }
}

export function decodeQuoted(text: string): string {
  const body = text.slice(1, -1);
  return body.replace(/\\(u\{([0-9a-fA-F]+)\}|.)/g, (_m, esc: string, hex?: string) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ({ n: "\n", r: "\r", t: "\t", '"': '"', "'": "'", "\\": "\\" } as Record<string, string>)[esc] ?? esc;
  });
}

export function buildAst(source: string): Program {
  const { tokens } = lex(source);
  const p = new P(tokens);
  return { decls: p.file(), source };
}
