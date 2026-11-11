// Phil Grammar-v1 parser (syntax only).
//
// A backtracking recursive-descent parser written directly from
// grammar/phase1-surface.ebnf, with overlaps resolved as documented in
// grammar/phase1-surface-determinacy.json. Like the upstream parser, accepting
// a file means *syntactic* acceptance only; ownership, typing, authority and
// proof obligations are decided by the Phil checker.
//
// Errors are reported at the furthest position any alternative reached, with
// the set of tokens that would have been accepted there. After an error the
// parser resynchronises at the next top-level declaration so that a single
// mistake does not hide the rest of the file.

import { Token, lex, LexResult, LexDiagnostic, Fix } from "./lexer";

export type SymbolKind =
  | "module" | "record" | "data" | "type" | "claim" | "callable" | "function"
  | "provider" | "implementation" | "protocol" | "capability" | "boundary"
  | "architecture" | "component" | "program"
  | "field" | "variant" | "operation" | "law" | "lifecycle" | "role" | "instance"
  | "process" | "ref" | "entry" | "authority" | "variable" | "parameter";

export interface PhilSymbol {
  name: string;
  kind: SymbolKind;
  detail: string;
  /** token index range [startTok, endTok] inclusive */
  startTok: number;
  endTok: number;
  nameTok: number;
  children: PhilSymbol[];
}

export interface ParseDiagnostic {
  code: string;
  message: string;
  start: number;
  end: number;
  severity: "error" | "warning" | "information" | "hint";
  related?: { message: string; start: number; end: number }[];
  fix?: Fix;
}

export interface ParseResult {
  lex: LexResult;
  symbols: PhilSymbol[];
  diagnostics: ParseDiagnostic[];
  /** true when the file was not valid Grammar v1 and looks like legacy Phase 0 syntax */
  legacy: boolean;
}

type Event =
  | { t: "open"; name: string; kind: SymbolKind; detail: string; startTok: number; nameTok: number }
  | { t: "close"; endTok: number }
  | { t: "group"; what: string; items: number[] }
  | { t: "error"; diag: ParseDiagnostic };

const DECL_START = new Set([
  "record", "data", "type", "claim", "callable", "fn", "recursive", "provider", "opaque",
  "protocol", "capability", "boundary", "architecture", "component", "program",
]);

/** Words from other languages that people reach for; mapped to an explanation. */
const FOREIGN: Record<string, string> = {
  unsafe: "Phil has no `unsafe` blocks: every operation must be checked or carry an explicit assumption/obligation.",
  unchecked: "Phil has no `unchecked` blocks: uncertainty must be stated as an explicit assumption or obligation.",
  spawn: "Phil has no term-level `spawn`. Concurrency is declared statically with `process` items in an `architecture`.",
  await: "Phil has no `await`. Communicate over protocol endpoints with `send`/`receive`; processes are declared in an `architecture`.",
  async: "Phil has no `async`. Processes are declared statically in an `architecture`.",
  try: "Phil has no `try`/`catch`. Handle failure with `decide`/`match` on outcomes, or `... or fail X` / `... or reject e`.",
  catch: "Phil has no `try`/`catch`. Handle failure with `decide`/`match` on outcomes, or `... or fail X` / `... or reject e`.",
  throw: "Phil has no exceptions. Use `fail X on endpoint` for fatal control or `reject e` for typed-negative control.",
  atomic: "Phil has no `atomic` blocks. Synchronisation happens through protocol rendezvous.",
  malloc: "Phil has no manual allocation; physical storage is a realization choice, not source semantics.",
  free: "Phil has no manual deallocation; use `release` or `close` to discharge linear resources.",
  macro: "Phil has no macros.",
  typeof: "Phil has no runtime reflection.",
  reflect: "Phil has no runtime reflection.",
  while: "Phil has no `while`. Use `loop state (...) invariant P { ... continue (...); ... break; }`.",
  for: "Phil has no `for`. Use `loop state (...) invariant P { ... }`.",
  mut: "Phil has no mutable bindings. Thread state through `loop state (...)` and `continue (...)`, or rebind with a new `let`.",
  var: "Phil uses `let` bindings, which are immutable.",
  const: "Phil uses `let` bindings, which are immutable.",
  struct: "Use `record Name { field : Type, ... }`.",
  enum: "Use `data Name = A | B(T) | C { field : T };`.",
  class: "Phil has no classes. Use `record`/`data` for values and `provider`/`capability` for behaviour and authority.",
  trait: "Use a `provider` contract (with `operation`/`law` items) or a `callable` contract.",
  interface: "Use a `provider` contract or a `callable` contract.",
  impl: "Use `provider implementation Name satisfies Contract { ... }`.",
  function: "Functions are declared with `fn name(params) -> T satisfies Contract { ... }`.",
  func: "Functions are declared with `fn name(params) -> T satisfies Contract { ... }`.",
  def: "Functions are declared with `fn name(params) -> T satisfies Contract { ... }`.",
  null: "Phil has no `null`. Model absence with a `data` type.",
  nil: "Phil has no `nil`. Model absence with a `data` type.",
  self: "Phil has no implicit `self`; pass values explicitly.",
  this: "Phil has no implicit `this`; pass values explicitly.",
  goto: "Phil has no `goto`.",
  yield: "Phil has no generators. Use `send` on a protocol endpoint.",
  switch: "Use `match expr { Pattern => ... }`.",
  case: "Use `match expr { Pattern => ... }`.",
  elif: "Use `else { if ... }`.",
  elsif: "Use `else { if ... }`.",
  new: "Construct values with `construct Name { field = value }`.",
  use: "Use `import module.name;` or `import module.name { a, b };`.",
  include: "Use `import module.name;`.",
  pub: "Phil has no visibility modifiers.",
  public: "Phil has no visibility modifiers.",
  private: "Phil has no visibility modifiers.",
  static: "Phil has no `static` modifier.",
  lambda: "Use `closure (params) satisfies Contract { ... }`.",
  assert: "Use `prove(P)` for compile-time evidence; runtime checks use `validate`.",
  print: "Output is an explicit effect through a provider (for example a console provider), not a built-in.",
  println: "Output is an explicit effect through a provider (for example a console provider), not a built-in.",
};

function describe(tok: Token): string {
  switch (tok.kind) {
    case "eof": return "end of file";
    case "ident": return `identifier \`${tok.text}\``;
    case "kw": return `keyword \`${tok.text}\``;
    case "int": case "float": return `number \`${tok.text}\``;
    case "string": return "string literal";
    case "char": return "character literal";
    case "uint": case "sint": return `type \`${tok.text}\``;
    default: return `\`${tok.text}\``;
  }
}

class Parser {
  p = 0;
  furthest = 0;
  expected = new Set<string>();
  events: Event[] = [];

  constructor(readonly toks: Token[], readonly lexDiagnostics: LexDiagnostic[] = []) {}

  /** Records a syntax error at the current furthest failure (unless it is a knock-on lexical error). */
  recordError(): void {
    const diag = syntaxDiagnostic(this, this.toks);
    const atTok = this.toks[this.furthest];
    const prevEnd = this.furthest > 0 ? this.toks[this.furthest - 1].end : 0;
    if (this.lexDiagnostics.some((l) => l.start >= prevEnd && l.start <= atTok.start)) return;
    this.events.push({ t: "error", diag });
  }

  private memoTable = new Map<number, { ok: boolean; end: number; events: Event[]; f: number; exp: Set<string> }>();
  private ruleIds = new Map<string, number>();

  /** Packrat memoisation: each (rule, position) is parsed at most once. */
  memo(rule: string, fn: () => boolean): boolean {
    let id = this.ruleIds.get(rule);
    if (id === undefined) { id = this.ruleIds.size; this.ruleIds.set(rule, id); }
    const key = this.p * 64 + id;
    const savedF = this.furthest, savedExp = this.expected;
    const hit = this.memoTable.get(key);
    if (hit) {
      this.mergeFailure(savedF, savedExp, hit.f, hit.exp);
      if (!hit.ok) return false;
      this.p = hit.end;
      // Events reference token indices only, so they can be replayed verbatim.
      for (const e of hit.events) this.events.push(e.t === "open" ? { ...e } : e);
      return true;
    }
    const start = this.p, evStart = this.events.length;
    this.furthest = start;
    this.expected = new Set();
    const ok = this.attempt(fn);
    const entry = { ok, end: this.p, events: ok ? this.events.slice(evStart).map((e) => (e.t === "open" ? { ...e } : e)) : [], f: this.furthest, exp: this.expected };
    this.memoTable.set(key, entry);
    this.mergeFailure(savedF, savedExp, entry.f, entry.exp);
    return ok;
  }
  private mergeFailure(savedF: number, savedExp: Set<string>, f: number, exp: Set<string>): void {
    if (f > savedF) { this.furthest = f; this.expected = new Set(exp); }
    else if (f === savedF) { this.furthest = savedF; this.expected = new Set([...savedExp, ...exp]); }
    else { this.furthest = savedF; this.expected = savedExp; }
  }

  // ---------------------------------------------------------------- basics

  get tok(): Token { return this.toks[this.p]; }
  at(k = 0): Token { return this.toks[Math.min(this.p + k, this.toks.length - 1)]; }

  fail(label: string): false {
    if (this.p > this.furthest) {
      this.furthest = this.p;
      this.expected = new Set([label]);
    } else if (this.p === this.furthest) {
      this.expected.add(label);
    }
    return false;
  }

  sym(s: string): boolean {
    const t = this.tok;
    if (t.kind === "sym" && t.text === s) { this.p++; return true; }
    return this.fail("`" + s + "`");
  }
  kw(s: string): boolean {
    const t = this.tok;
    if (t.kind === "kw" && t.text === s) { this.p++; return true; }
    return this.fail("`" + s + "`");
  }
  isSym(s: string, k = 0): boolean { const t = this.at(k); return t.kind === "sym" && t.text === s; }
  isKw(s: string, k = 0): boolean { const t = this.at(k); return t.kind === "kw" && t.text === s; }

  ident(): boolean {
    if (this.tok.kind === "ident") { this.p++; return true; }
    return this.fail("identifier");
  }
  kind(k: Token["kind"], label: string): boolean {
    if (this.tok.kind === k) { this.p++; return true; }
    return this.fail(label);
  }

  /** Runs fn; on failure restores position and discards events. */
  attempt(fn: () => boolean): boolean {
    const p = this.p;
    const e = this.events.length;
    if (fn()) return true;
    this.p = p;
    this.events.length = e;
    return false;
  }
  opt(fn: () => boolean): true { this.attempt(fn); return true; }
  many(fn: () => boolean): true {
    for (;;) {
      const before = this.p;
      if (!this.attempt(fn) || this.p === before) return true;
    }
  }
  alt(...fns: (() => boolean)[]): boolean {
    for (const f of fns) if (this.attempt(f)) return true;
    return false;
  }
  /** item { sep item } */
  sepBy1(item: () => boolean, sep: string): boolean {
    if (!item()) return false;
    return this.many(() => this.sym(sep) && item());
  }
  /** [ item { sep item } ] */
  sepBy(item: () => boolean, sep: string): boolean {
    return this.opt(() => this.sepBy1(item, sep));
  }
  /** [ item { "," item } [ "," ] ] — trailing comma admitted */
  commaListTrailing(item: () => boolean): boolean {
    return this.opt(() => this.sepBy1(item, ",") && this.opt(() => this.sym(",")));
  }

  open(kind: SymbolKind, nameTok: number, startTok: number, detail = ""): void {
    this.events.push({ t: "open", name: this.toks[nameTok].text, kind, detail, startTok, nameTok });
  }
  close(): true {
    this.events.push({ t: "close", endTok: Math.max(this.p - 1, 0) });
    return true;
  }
  /** Wraps a construct so it becomes an outline symbol named by the identifier at `nameOffset`. */
  symbolized(kind: SymbolKind, detail: string, body: () => boolean): boolean {
    const start = this.p;
    const openIndex = this.events.length;
    this.events.push({ t: "open", name: "", kind, detail, startTok: start, nameTok: start });
    if (!body()) return false;
    this.close();
    return true;
  }
  /** Marks the identifier just consumed as the name of the innermost open symbol. */
  named(): true {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e.t === "open" && e.name === "") {
        e.name = this.toks[this.p - 1].text;
        e.nameTok = this.p - 1;
        return true;
      }
    }
    return true;
  }
  nameIdent(): boolean { return this.ident() && this.named(); }
  group(what: string, items: number[]): true {
    if (items.length > 1) this.events.push({ t: "group", what, items });
    return true;
  }

  // ---------------------------------------------------------------- top level

  qualifiedName(): boolean {
    return this.ident() && this.many(() => this.sym(".") && this.ident());
  }
  identifierList(): boolean { return this.sepBy1(() => this.ident(), ","); }

  moduleDecl(): boolean {
    return this.symbolized("module", "module", () => {
      if (!this.kw("module")) return false;
      const nameStart = this.p;
      if (!this.qualifiedName()) return false;
      const ev = this.events[this.events.length - 1];
      if (ev.t === "open") {
        ev.name = this.toks.slice(nameStart, this.p).map((t) => t.text).join("");
        ev.nameTok = nameStart;
      }
      return this.sym(";");
    });
  }
  importDecl(): boolean {
    return this.kw("import") && this.qualifiedName() &&
      this.opt(() => this.sym("{") && this.identifierList() && this.sym("}")) && this.sym(";");
  }
  attribute(): boolean {
    return this.sym("@") && this.ident() && this.sym("(") && this.kind("string", "string literal") && this.sym(")");
  }
  topLevelDecl(): boolean {
    const start = this.p;
    if (!(this.many(() => this.attribute()) && this.declaration())) return false;
    // Extend the declaration symbol to include its attributes.
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e.t === "open") {
        if (e.startTok >= start) e.startTok = start;
        break;
      }
    }
    return true;
  }
  declaration(): boolean {
    return this.alt(
      () => this.recordDecl(),
      () => this.dataDecl(),
      () => this.typeAliasDecl(),
      () => this.claimDecl(),
      () => this.callableContractDecl(),
      () => this.functionDecl(),
      () => this.providerContractDecl(),
      () => this.providerImplementationDecl(),
      () => this.opaqueProviderImplementationDecl(),
      () => this.protocolDecl(),
      () => this.capabilityDecl(),
      () => this.boundaryDecl(),
      () => this.architectureDecl(),
      () => this.componentDecl(),
      () => this.programDecl(),
    );
  }

  // ---------------------------------------------------------------- generics

  structuralMode(): boolean {
    return this.alt(() => this.kw("unrestricted"), () => this.kw("affine"), () => this.kw("linear"));
  }
  genericParams(): boolean {
    return this.sym("[") && this.sepBy1(() => this.genericParam(), ",") && this.sym("]");
  }
  genericParam(): boolean { return this.ident() && this.sym(":") && this.genericKind(); }
  genericKind(): boolean {
    return this.alt(
      () => this.kw("Type"), () => this.kw("Nat"), () => this.kw("Session"),
      () => this.kw("Message"), () => this.kw("Effects"),
      () => this.kw("provider") && this.typeExpression(),
      () => this.kw("callable") && this.typeExpression(),
      () => this.kw("boundary") && this.typeExpression(),
      () => this.kw("architecture") && this.typeExpression(),
    );
  }
  genericRequirements(): boolean {
    return this.kw("requires") && this.sym("{") && this.many(() => this.genericRequirement()) && this.sym("}");
  }
  genericRequirement(): boolean {
    return this.alt(
      () => this.kw("structural") && this.ident() && this.sym(":") && this.ident() && this.sym(";"),
      () => this.kw("proposition") && this.proposition() && this.sym(";"),
      () => this.kw("provider") && this.ident() && this.sym(":") && this.typeExpression() && this.sym(";"),
      () => this.kw("callable") && this.ident() && this.sym(":") && this.typeExpression() && this.sym(";"),
      () => this.kw("boundary") && this.ident() && this.sym(":") && this.typeExpression() && this.sym(";"),
      () => this.kw("architecture") && this.ident() && this.sym(":") && this.typeExpression() && this.sym(";"),
      () => this.kw("effects") && this.ident() && this.kw("within") && this.effectSetExpression() && this.sym(";"),
      () => this.kw("authority") && this.typeExpression() && this.sym(";"),
      () => this.kw("boundary") && this.kw("representation") && this.typeExpression() && this.sym(";"),
      () => this.kw("representation") && this.proposition() && this.sym(";"),
      () => this.kw("placement") && this.proposition() && this.sym(";"),
      () => this.kw("cost") && this.proposition() && this.sym(";"),
      () => this.kw("environment") && this.proposition() && this.sym(";"),
    );
  }
  termParams(paramSymbols = false): boolean {
    const names: number[] = [];
    const param = () => {
      const nameTok = this.p;
      if (!this.ident()) return false;
      if (paramSymbols) {
        this.open("parameter", nameTok, nameTok);
      }
      if (!(this.sym(":") && this.typeExpression())) return false;
      if (paramSymbols) this.close();
      names.push(nameTok);
      return true;
    };
    return this.sym("(") && this.sepBy(param, ",") && this.sym(")") && this.group("parameter", names);
  }
  termParam(): boolean { return this.ident() && this.sym(":") && this.typeExpression(); }

  // ---------------------------------------------------------------- types

  typeExpression(): boolean { return this.memo("typeExpression", () => this._typeExpression()); }
  _typeExpression(): boolean {
    return this.alt(() => this.nonreferenceTypeExpression(), () => this.staticReference());
  }
  nonreferenceTypeExpression(): boolean {
    const t = this.tok;
    if (t.kind === "uint" || t.kind === "sint") { this.p++; return true; }
    return this.alt(
      () => this.kw("Unit"), () => this.kw("Bool"), () => this.kw("Char"), () => this.kw("String"),
      () => this.kw("F32"), () => this.kw("F64"),
      () => this.kw("Bytes") && this.opt(() => this.sym("[") && this.expression() && this.sym("]")),
      () => this.kw("Frame") && this.sym("[") && this.staticReference() && this.sym("]"),
      () => this.kw("Proof") && this.sym("[") && this.proposition() && this.sym("]"),
      () => this.kw("Validated") && this.sym("[") && this.staticReference() && this.sym(",") &&
        this.expression() && this.sym(",") && this.expression() && this.sym("]"),
      () => this.refinementType(),
      () => this.tupleType(),
    ) || this.fail("type");
  }
  refinementType(): boolean {
    return this.sym("{") && this.ident() && this.sym(":") && this.typeExpression() && this.sym("|") &&
      this.proposition() && this.sym("}");
  }
  tupleType(): boolean {
    return this.sym("(") && this.typeExpression() && this.sym(",") && this.typeExpression() &&
      this.many(() => this.sym(",") && this.typeExpression()) && this.sym(")");
  }
  staticReference(): boolean { return this.memo("staticReference", () => this._staticReference()); }
  _staticReference(): boolean {
    return this.qualifiedName() && this.opt(() => this.staticArguments());
  }
  staticArguments(): boolean {
    return this.sym("[") && this.sepBy(() => this.staticArgument(), ",") && this.sym("]");
  }
  staticArgument(): boolean { return this.memo("staticArgument", () => this._staticArgument()); }
  _staticArgument(): boolean {
    return this.alt(
      () => this.nonreferenceTypeExpression(),
      () => this.nonreferenceSessionExpression(),
      () => this.staticValueExpression(),
      () => this.effectSetLiteral(),
    );
  }
  staticValueExpression(): boolean { return this.memo("staticValueExpression", () => this._staticValueExpression()); }
  _staticValueExpression(): boolean {
    return this.staticMultiplicative() &&
      this.many(() => this.alt(() => this.sym("+"), () => this.sym("-")) && this.staticMultiplicative());
  }
  staticMultiplicative(): boolean {
    return this.staticPostfix() && this.many(() => this.sym("*") && this.staticPostfix());
  }
  staticPostfix(): boolean {
    return this.alt(
      () => this.qualifiedName() &&
        this.opt(() => this.staticArguments() && this.many(() => this.sym(".") && this.ident())),
      () => this.staticNonreferencePrimary() && this.many(() => this.sym(".") && this.ident()),
    );
  }
  staticNonreferencePrimary(): boolean {
    return this.alt(
      () => this.kw("true"), () => this.kw("false"), () => this.kw("unit"),
      () => this.kind("int", "integer"),
      () => this.sym("(") && this.staticValueExpression() && this.sym(")"),
    );
  }
  termArguments(): boolean { return this.memo("termArguments", () => this._termArguments()); }
  _termArguments(): boolean {
    return this.sym("(") && this.sepBy(() => this.expression(), ",") && this.sym(")");
  }

  // ---------------------------------------------------------------- declarations

  fieldList(): boolean {
    const names: number[] = [];
    const field = () => {
      const nameTok = this.p;
      if (!this.ident()) return false;
      this.open("field", nameTok, nameTok);
      if (!(this.sym(":") && this.typeExpression())) return false;
      this.close();
      names.push(nameTok);
      return true;
    };
    return this.commaListTrailing(field) && this.group("field", names);
  }

  recordDecl(): boolean {
    return this.symbolized("record", "record", () =>
      this.kw("record") && this.nameIdent() && this.opt(() => this.genericParams()) &&
      this.opt(() => this.kw("mode") && this.structuralMode()) && this.opt(() => this.genericRequirements()) &&
      this.sym("{") && this.fieldList() && this.sym("}"));
  }
  dataDecl(): boolean {
    const variants: number[] = [];
    const variant = () => {
      const nameTok = this.p;
      if (!this.ident()) return false;
      this.open("variant", nameTok, nameTok);
      if (!this.opt(() => this.variantPayload())) return false;
      this.close();
      variants.push(nameTok);
      return true;
    };
    return this.symbolized("data", "data", () =>
      this.kw("data") && this.nameIdent() && this.opt(() => this.genericParams()) &&
      this.opt(() => this.kw("mode") && this.structuralMode()) && this.opt(() => this.genericRequirements()) &&
      this.sym("=") && this.sepBy1(variant, "|") && this.sym(";") && this.group("variant", variants));
  }
  variantPayload(): boolean {
    return this.alt(
      () => this.sym("{") && this.fieldList() && this.sym("}"),
      () => this.sym("(") && this.sepBy(() => this.typeExpression(), ",") && this.sym(")"),
    );
  }
  typeAliasDecl(): boolean {
    return this.symbolized("type", "type", () =>
      this.kw("type") && this.nameIdent() && this.opt(() => this.genericParams()) &&
      this.opt(() => this.genericRequirements()) && this.sym("=") && this.typeExpression() && this.sym(";"));
  }
  claimDecl(): boolean {
    return this.symbolized("claim", "claim", () =>
      this.kw("claim") && this.nameIdent() && this.opt(() => this.genericParams()) &&
      this.opt(() => this.genericRequirements()) && this.opt(() => this.termParams()) &&
      this.opt(() => this.sym("=") && this.proposition()) && this.sym(";"));
  }
  callableContractDecl(): boolean {
    return this.symbolized("callable", "callable", () =>
      this.kw("callable") && this.nameIdent() && this.opt(() => this.genericParams()) &&
      this.opt(() => this.genericRequirements()) && this.termParams() && this.sym("->") &&
      this.typeExpression() && this.sym("{") && this.many(() => this.callableClause()) && this.sym("}"));
  }
  callableClause(): boolean {
    return this.alt(
      () => this.kw("requires") && this.proposition() && this.sym(";"),
      () => this.kw("consumes") && this.nameSet() && this.sym(";"),
      () => this.kw("borrows") && this.nameSet() && this.sym(";"),
      () => this.kw("authority") && this.typeSet() && this.sym(";"),
      () => this.kw("effects") && this.effectSetExpression() && this.sym(";"),
      () => this.kw("outcomes") && this.outcomeSet() && this.sym(";"),
      () => this.outcomeResidue(),
      () => this.kw("ensures") && this.proposition() && this.sym(";"),
      () => this.kw("obligation") && this.proposition() && this.sym(";"),
      () => this.kw("assumes") && this.proposition() && this.sym(";"),
      () => this.kw("cost") && this.expression() && this.sym(";"),
      () => this.kw("callee") && this.calleeTransition() && this.sym(";"),
    );
  }
  outcomeKind(): boolean {
    return this.alt(() => this.kw("success"), () => this.kw("negative"), () => this.kw("terminal"), () => this.kw("fatal"));
  }
  outcomeSet(): boolean {
    return this.sym("{") && this.sepBy(() => this.outcomeKind() && this.typeExpression(), ",") && this.sym("}");
  }
  outcomeResidue(): boolean {
    return this.kw("outcome") && this.outcomeKind() && this.typeExpression() && this.sym("{") &&
      this.many(() => this.outcomeResidueClause()) && this.sym("}");
  }
  outcomeResidueClause(): boolean {
    return this.alt(
      () => this.kw("state") && this.sym("(") && this.sepBy(() => this.stateSlot(), ",") && this.sym(")") && this.sym(";"),
      () => this.kw("callee") && this.calleeTransition() && this.sym(";"),
      () => this.kw("ensures") && this.proposition() && this.sym(";"),
      () => this.kw("obligation") && this.proposition() && this.sym(";"),
    );
  }
  calleeTransition(): boolean {
    return this.alt(
      () => this.kw("preserve"),
      () => this.kw("consume"),
      () => this.kw("replace") && this.kw("with") && this.staticReference() &&
        this.opt(() => this.kw("state") && this.expression()),
    );
  }
  nameSet(): boolean { return this.sym("{") && this.sepBy(() => this.qualifiedName(), ",") && this.sym("}"); }
  typeSet(): boolean { return this.sym("{") && this.sepBy(() => this.typeExpression(), ",") && this.sym("}"); }
  effectSetExpression(): boolean {
    return this.alt(() => this.effectSetLiteral(), () => this.staticReference());
  }
  effectSetLiteral(): boolean {
    return this.sym("{") && this.sepBy(() => this.staticReference() && this.opt(() => this.termArguments()), ",") &&
      this.sym("}");
  }
  functionDecl(): boolean {
    return this.symbolized("function", "fn", () =>
      this.opt(() => this.kw("recursive")) && this.kw("fn") && this.nameIdent() &&
      this.opt(() => this.genericParams()) && this.opt(() => this.genericRequirements()) && this.termParams(true) &&
      this.opt(() => this.sym("->") && this.typeExpression()) && this.kw("satisfies") && this.typeExpression() &&
      this.block());
  }
  providerContractDecl(): boolean {
    return this.symbolized("provider", "provider", () =>
      this.kw("provider") && this.nameIdent() && this.opt(() => this.genericParams()) &&
      this.opt(() => this.genericRequirements()) && this.sym("{") &&
      this.many(() => this.providerContractItem()) && this.sym("}"));
  }
  providerContractItem(): boolean {
    return this.alt(
      () => this.symbolized("operation", "operation", () =>
        this.kw("operation") && this.nameIdent() && this.sym(":") && this.typeExpression() && this.sym(";")),
      () => this.symbolized("law", "law", () =>
        this.kw("law") && this.nameIdent() && this.sym(":") && this.proposition() && this.sym(";")),
      () => this.symbolized("lifecycle", "lifecycle", () =>
        this.kw("lifecycle") && this.nameIdent() && this.sym(":") && this.proposition() && this.sym(";")),
    );
  }
  providerImplementationDecl(): boolean {
    return this.symbolized("implementation", "provider implementation", () =>
      this.kw("provider") && this.kw("implementation") && this.nameIdent() &&
      this.opt(() => this.genericParams()) && this.opt(() => this.genericRequirements()) &&
      this.kw("satisfies") && this.typeExpression() && this.sym("{") &&
      this.many(() => this.providerImplementationItem()) && this.sym("}"));
  }
  providerImplementationItem(): boolean {
    return this.alt(
      () => this.symbolized("operation", "operation", () =>
        this.kw("operation") && this.nameIdent() && this.kw("satisfies") && this.typeExpression() && this.block()),
      () => this.symbolized("law", "law", () =>
        this.kw("law") && this.nameIdent() && this.sym("=") && this.proposition() && this.sym(";")),
      () => this.symbolized("lifecycle", "lifecycle", () =>
        this.kw("lifecycle") && this.nameIdent() && this.sym("=") && this.proposition() && this.sym(";")),
    );
  }
  opaqueProviderImplementationDecl(): boolean {
    return this.symbolized("implementation", "opaque provider implementation", () =>
      this.kw("opaque") && this.kw("provider") && this.kw("implementation") && this.nameIdent() &&
      this.opt(() => this.genericParams()) && this.opt(() => this.genericRequirements()) &&
      this.kw("satisfies") && this.typeExpression() && this.sym(";"));
  }
  protocolDecl(): boolean {
    return this.symbolized("protocol", "protocol", () =>
      this.kw("protocol") && this.nameIdent() && this.opt(() => this.genericParams()) &&
      this.opt(() => this.genericRequirements()) && this.sym("{") && this.roleSessionDecl() &&
      this.roleSessionDecl() && this.sym("}"));
  }
  roleSessionDecl(): boolean {
    return this.symbolized("role", "role", () =>
      this.kw("role") && this.nameIdent() && this.sym("=") && this.sessionExpression() && this.sym(";"));
  }
  sessionExpression(): boolean { return this.memo("sessionExpression", () => this._sessionExpression()); }
  _sessionExpression(): boolean {
    return this.alt(() => this.nonreferenceSessionExpression(), () => this.staticReference()) || this.fail("session");
  }
  nonreferenceSessionExpression(): boolean {
    const msg = (word: string) => () =>
      this.kw(word) && this.sym("(") && this.termParam() && this.sym(")") &&
      this.opt(() => this.kw("using") && this.staticReference()) &&
      this.opt(() => this.kw("when") && this.proposition()) && this.kw("then") && this.sessionExpression();
    const branches = (word: string) => () => {
      const labels: number[] = [];
      const branch = () => {
        labels.push(this.p);
        return this.sessionBranch();
      };
      return this.kw(word) && this.sym("{") && this.sepBy1(branch, "|") && this.sym("}") && this.group("branch", labels);
    };
    return this.alt(
      msg("send"),
      msg("receive"),
      branches("select"),
      branches("offer"),
      () => this.kw("end") && this.ident(),
      () => this.kw("recursive") && this.ident() && this.sym("=") && this.sessionExpression(),
      () => this.kw("continue") && this.ident(),
    );
  }
  sessionBranch(): boolean {
    return this.ident() &&
      this.opt(() => this.sym("(") && this.sepBy(() => this.termParam(), ",") && this.sym(")")) &&
      this.opt(() => this.kw("using") && this.staticReference()) &&
      this.opt(() => this.kw("when") && this.proposition()) && this.sym("=>") && this.sessionExpression();
  }
  capabilityDecl(): boolean {
    return this.symbolized("capability", "capability", () =>
      this.kw("capability") && this.nameIdent() && this.opt(() => this.genericParams()) && this.kw("mode") &&
      this.structuralMode() && this.opt(() => this.genericRequirements()) && this.sym("{") &&
      this.many(() => this.capabilityItem()) && this.sym("}"));
  }
  capabilityItem(): boolean {
    return this.alt(
      () => this.kw("permits") && this.staticReference() && this.sym(";"),
      () => this.kw("requires") && this.proposition() && this.sym(";"),
      () => this.symbolized("law", "law", () =>
        this.kw("law") && this.nameIdent() && this.sym(":") && this.proposition() && this.sym(";")),
    );
  }
  boundaryDecl(): boolean {
    return this.symbolized("boundary", "boundary", () =>
      this.kw("boundary") && this.nameIdent() && this.opt(() => this.genericParams()) &&
      this.opt(() => this.genericRequirements()) && this.sym(":") && this.typeExpression() && this.sym("{") &&
      this.many(() => this.boundaryItem()) && this.sym("}"));
  }
  boundaryItem(): boolean {
    return this.alt(
      () => this.kw("receive") && this.kw("using") && this.staticReference() && this.sym(";"),
      () => this.kw("send") && this.kw("using") && this.staticReference() && this.sym(";"),
      () => this.kw("correspondence") && this.proposition() && this.sym(";"),
      () => this.kw("canonical") && this.sym(";"),
      () => this.kw("failure") && this.typeExpression() && this.sym(";"),
      () => this.symbolized("law", "law", () =>
        this.kw("law") && this.nameIdent() && this.sym(":") && this.proposition() && this.sym(";")),
    );
  }
  architectureDecl(): boolean {
    return this.symbolized("architecture", "architecture", () =>
      this.kw("architecture") && this.nameIdent() && this.opt(() => this.genericParams()) &&
      this.opt(() => this.genericRequirements()) && this.sym("{") &&
      this.many(() => this.architectureItem()) && this.sym("}"));
  }
  architectureItem(): boolean {
    const named = (kind: SymbolKind, word: string, rest: () => boolean) => () =>
      this.symbolized(kind, word, () => this.kw(word) && this.nameIdent() && rest());
    return this.alt(
      named("instance", "instance", () => this.sym("=") && this.staticReference() && this.sym(";")),
      named("ref", "ref", () => this.sym("=") && this.qualifiedName() && this.sym(";")),
      named("process", "process", () => this.sym("=") && this.qualifiedName() && this.sym(";")),
      named("protocol", "protocol", () => this.sym("=") && this.staticReference() && this.sym(";")),
      () => this.kw("role") && this.qualifiedName() && this.sym("=") &&
        this.alt(() => this.kw("external"), () => this.qualifiedName()) && this.sym(";"),
      () => this.kw("bind") && this.qualifiedName() && this.sym("=") && this.qualifiedName() && this.sym(";"),
      named("authority", "authority", () =>
        this.sym(":") && this.typeExpression() && this.kw("originates") && this.kw("at") &&
        this.qualifiedName() && this.sym(";")),
      () => this.kw("grant") && this.qualifiedName() && this.sym("=") && this.expression() && this.sym(";"),
      () => this.kw("boundary") && this.qualifiedName() && this.sym("=") && this.qualifiedName() && this.sym(";"),
      named("entry", "entry", () => this.sym(":") && this.typeExpression() && this.sym(";")),
      () => this.kw("assume") && this.proposition() && this.kw("within") && this.qualifiedName() && this.sym(";"),
      () => this.kw("export") && this.kw("obligation") && this.qualifiedName() && this.kw("to") &&
        this.qualifiedName() && this.sym(";"),
      () => this.kw("observable") && this.qualifiedName() && this.sym(";"),
      () => this.kw("constraint") && this.proposition() && this.sym(";"),
    );
  }
  componentDecl(): boolean {
    return this.symbolized("component", "component", () =>
      this.kw("component") && this.nameIdent() && this.opt(() => this.genericParams()) &&
      this.opt(() => this.genericRequirements()) && this.opt(() => this.termParams(true)) &&
      this.opt(() => this.kw("provides") && this.typeExpression()) && this.block());
  }
  programDecl(): boolean {
    return this.symbolized("program", "program", () =>
      this.kw("program") && this.nameIdent() && this.sym("=") && this.kw("instantiate") && this.staticReference() &&
      this.opt(() => this.sym("{") && this.many(() => this.programItem()) && this.sym("}")) && this.sym(";"));
  }
  programItem(): boolean {
    return this.alt(
      () => this.symbolized("entry", "entry", () =>
        this.kw("entry") && this.nameIdent() && this.sym(":") && this.typeExpression() && this.sym(";")),
      () => this.kw("assume") && this.proposition() && this.kw("within") && this.qualifiedName() && this.sym(";"),
      () => this.kw("export") && this.kw("obligation") && this.qualifiedName() && this.kw("to") &&
        this.qualifiedName() && this.sym(";"),
      () => this.kw("observable") && this.qualifiedName() && this.sym(";"),
    );
  }

  // ---------------------------------------------------------------- statements

  block(): boolean { return this.memo("block", () => this._block()); }
  _block(): boolean {
    if (!this.sym("{")) return false;
    for (;;) {
      if (this.isSym("}")) { this.p++; return true; }
      if (this.tok.kind === "eof") return this.sym("}");
      // Parse one statement with a fresh failure frontier so the error (if any) belongs to it.
      const savedF = this.furthest, savedExp = this.expected;
      this.furthest = this.p;
      this.expected = new Set();
      const start = this.p;
      if (this.attempt(() => this.statement())) {
        if (savedF > this.furthest) { this.furthest = savedF; this.expected = savedExp; }
        continue;
      }
      // Statement-level recovery: report, then skip to just after the next `;`
      // (or up to the closing `}`) at this nesting depth.
      if (this.furthest === start && !this.isSym("}")) this.fail("`}`");
      this.recordError();
      let depth = 0;
      let q = start;
      for (; q < this.toks.length - 1; q++) {
        const t = this.toks[q];
        if (t.kind !== "sym") continue;
        if (t.text === "{" || t.text === "(" || t.text === "[") depth++;
        else if (t.text === "}" || t.text === ")" || t.text === "]") {
          if (depth === 0) break;
          depth--;
        } else if (t.text === ";" && depth === 0) { q++; break; }
      }
      if (q === start) q++; // always make progress
      this.p = q;
      this.furthest = q;
      this.expected = new Set();
    }
  }
  statement(): boolean {
    return this.alt(
      () => this.kw("let") && this.pattern() && this.sym("=") && this.expression() && this.sym(";"),
      () => this.kw("return") && this.expression() && this.sym(";"),
      () => this.expression() && this.sym(";"),
    );
  }
  pattern(): boolean { return this.memo("pattern", () => this._pattern()); }
  _pattern(): boolean {
    return this.alt(
      () => this.recordPattern(),
      () => this.tuplePattern(),
      () => {
        const t = this.p;
        if (!this.ident()) return false;
        this.open("variable", t, t, "let");
        return this.close();
      },
    );
  }
  tuplePattern(): boolean {
    return this.sym("(") && this.pattern() && this.sym(",") && this.pattern() &&
      this.many(() => this.sym(",") && this.pattern()) && this.sym(")");
  }
  recordPattern(): boolean {
    const fieldPattern = () => {
      const t = this.p;
      if (!this.ident()) return false;
      if (this.isSym("=")) return this.sym("=") && this.pattern();
      this.open("variable", t, t, "let");
      return this.close();
    };
    return this.qualifiedName() && this.sym("{") && this.sepBy1(fieldPattern, ",") &&
      this.opt(() => this.sym(",")) && this.sym("}");
  }

  // ---------------------------------------------------------------- expressions

  expression(): boolean { return this.memo("expression", () => this._expression()); }
  _expression(): boolean {
    return this.baseExpression() && this.opt(() => this.kw("or") && this.fallback());
  }
  fallback(): boolean {
    return this.alt(
      () => this.kw("fail") && this.failureTarget(),
      () => this.kw("reject") && this.baseExpression(),
    );
  }
  baseExpression(): boolean { return this.memo("baseExpression", () => this._baseExpression()); }
  _baseExpression(): boolean {
    const t = this.tok;
    if (t.kind === "kw" && COMMAND_KEYWORDS.has(t.text)) return this.commandExpression();
    return this.shiftExpression() || this.fail("expression");
  }
  commandExpression(): boolean {
    switch (this.tok.text) {
      case "construct":
        return this.kw("construct") && this.staticReference() && this.sym("{") &&
          this.commaListTrailing(() => this.ident() && this.sym("=") && this.expression()) && this.sym("}");
      case "borrow":
        return this.kw("borrow") && this.baseExpression() && this.kw("as") && this.ident() && this.block();
      case "if":
        return this.kw("if") && this.expression() && this.opt(() => this.joinClause()) && this.block() &&
          this.opt(() => this.kw("else") && this.block());
      case "match":
        return this.kw("match") && this.expression() && this.opt(() => this.joinClause()) && this.arms();
      case "decide":
        return this.kw("decide") && this.baseExpression() && this.arms();
      case "closure":
        return this.kw("closure") && this.opt(() => this.kw("mode") && this.structuralMode()) && this.termParams() &&
          this.kw("satisfies") && this.typeExpression() &&
          this.opt(() => this.kw("captures") && this.sym("(") && this.opt(() => this.identifierList()) && this.sym(")")) &&
          this.block();
      case "loop":
        return this.kw("loop") &&
          this.opt(() => this.kw("state") && this.sym("(") && this.sepBy(() => this.stateBinding(), ",") && this.sym(")")) &&
          this.opt(() => this.kw("invariant") && this.proposition()) && this.block();
      case "continue":
        return this.kw("continue") && this.opt(() => this.sym("(") && this.sepBy(() => this.expression(), ",") && this.sym(")"));
      case "break":
        return this.kw("break") && this.opt(() => this.sym("(") && this.sepBy(() => this.expression(), ",") && this.sym(")"));
      case "receive_frame":
        return this.kw("receive_frame") && this.sym("(") && this.expression() && this.sym(")");
      case "receive_exact":
        return this.kw("receive_exact") && this.baseExpression() &&
          this.opt(() => this.kw("using") && this.baseExpression()) && this.kw("on") && this.baseExpression();
      case "receive":
        return this.kw("receive") && this.typeExpression() && this.kw("on") && this.baseExpression();
      case "recognize":
        return this.kw("recognize") && this.staticReference() && this.kw("from") && this.baseExpression();
      case "validate":
        return this.kw("validate") && this.staticReference() && this.opt(() => this.kw("at") && this.baseExpression()) &&
          this.kw("on") && this.baseExpression();
      case "send_exact":
        return this.kw("send_exact") && this.baseExpression() && this.kw("on") && this.baseExpression();
      case "send":
        return this.kw("send") && this.baseExpression() && this.kw("on") && this.baseExpression();
      case "select":
        return this.kw("select") && this.qualifiedName() && this.opt(() => this.termArguments()) &&
          this.opt(() => this.kw("using") && this.baseExpression()) && this.kw("on") && this.baseExpression();
      case "offer":
        return this.kw("offer") && this.baseExpression() && this.arms();
      case "commit_receive":
        return this.kw("commit_receive") && this.baseExpression() && this.kw("using") && this.baseExpression();
      case "reject":
        return this.kw("reject") && this.baseExpression();
      case "fail":
        return this.kw("fail") && this.failureTarget() && this.kw("on") && this.baseExpression();
      case "close":
        return this.kw("close") && this.baseExpression();
      case "release":
        return this.kw("release") && this.baseExpression();
      case "convert":
        return this.kw("convert") && this.expression() && this.kw("to") && this.typeExpression();
      case "transport":
        return this.kw("transport") && this.baseExpression() && this.kw("to") && this.typeExpression() &&
          this.kw("using") && this.baseExpression();
      case "accept":
        return this.kw("accept") && this.baseExpression() && this.kw("as") && this.typeExpression();
      case "invoke":
        return this.kw("invoke") && this.staticReference() && this.termArguments();
      case "prove":
        return this.kw("prove") && this.sym("(") && this.proposition() && this.sym(")");
    }
    return this.fail("expression");
  }
  failureTarget(): boolean { return this.staticReference() && this.opt(() => this.termArguments()); }
  stateSlot(): boolean { return this.ident() && this.sym(":") && this.typeExpression(); }
  stateBinding(): boolean {
    return this.ident() && this.opt(() => this.sym(":") && this.typeExpression()) && this.sym("=") && this.expression();
  }
  joinClause(): boolean {
    return this.kw("join") && this.kw("state") && this.sym("(") && this.sepBy(() => this.stateSlot(), ",") &&
      this.sym(")") && this.opt(() => this.kw("invariant") && this.proposition());
  }
  arms(): boolean {
    const labels: number[] = [];
    const arm = () => {
      labels.push(this.p);
      return this.matchArm();
    };
    if (!(this.sym("{") && arm() && this.many(arm) && this.sym("}"))) return false;
    // Only plain-name labels are checked for duplicates (qualified labels are compared by full text).
    return this.group("arm", labels.slice(0, labels.length));
  }
  matchArm(): boolean {
    return this.casePattern() && this.sym("=>") && this.alt(() => this.block(), () => this.statement());
  }
  casePattern(): boolean {
    return this.qualifiedName() && this.opt(() => this.alt(
      () => this.sym("(") && this.opt(() => this.identifierList()) && this.sym(")"),
      () => this.sym("{") && this.commaListTrailing(() => this.ident() && this.opt(() => this.kw("as") && this.ident())) &&
        this.sym("}"),
    ));
  }
  shiftExpression(): boolean { return this.memo("shiftExpression", () => this._shiftExpression()); }
  _shiftExpression(): boolean {
    return this.additive() && this.many(() => this.alt(() => this.sym("<<"), () => this.sym(">>")) && this.additive());
  }
  additive(): boolean {
    return this.multiplicative() &&
      this.many(() => this.alt(() => this.sym("+"), () => this.sym("-")) && this.multiplicative());
  }
  multiplicative(): boolean {
    return this.unary() &&
      this.many(() => this.alt(() => this.sym("*"), () => this.sym("/"), () => this.sym("%")) && this.unary());
  }
  unary(): boolean {
    if (this.isSym("-")) return this.sym("-") && this.unary();
    return this.postfix();
  }
  postfix(): boolean {
    if (this.tok.kind === "ident") {
      return this.qualifiedName() && this.opt(() => this.alt(
        () => this.staticArguments() && this.opt(() => this.termArguments()) &&
          this.many(() => this.sym(".") && this.ident()),
        () => this.termArguments() && this.many(() => this.sym(".") && this.ident()),
      ));
    }
    return this.primary() && this.many(() => this.sym(".") && this.ident());
  }
  primary(): boolean {
    const t = this.tok;
    if (t.kind === "char" || t.kind === "string" || t.kind === "int" || t.kind === "float") { this.p++; return true; }
    return this.alt(
      () => this.sym("(") && this.expression() && this.sym(",") && this.expression() &&
        this.many(() => this.sym(",") && this.expression()) && this.sym(")"),
      () => this.sym("(") && this.expression() && this.sym(")"),
      () => this.kw("true"),
      () => this.kw("false"),
      () => this.kw("unit"),
    ) || this.fail("expression");
  }

  // ---------------------------------------------------------------- propositions

  proposition(): boolean { return this.memo("proposition", () => this._proposition()); }
  _proposition(): boolean {
    return this.propAnd() && this.many(() => this.kw("or") && this.propAnd());
  }
  propAnd(): boolean {
    return this.propNot() && this.many(() => this.kw("and") && this.propNot());
  }
  propNot(): boolean {
    if (this.isKw("not")) return this.kw("not") && this.propNot();
    return this.propAtom();
  }
  propAtom(): boolean { return this.memo("propAtom", () => this._propAtom()); }
  _propAtom(): boolean {
    return this.alt(
      () => this.shiftExpression() && this.relationOperator() && this.shiftExpression(),
      () => this.sym("(") && this.proposition() && this.sym(")"),
      () => this.kw("true"),
      () => this.kw("false"),
      () => this.staticReference() && this.sym("(") && this.sepBy(() => this.expression(), ",") && this.sym(")"),
    ) || this.fail("proposition");
  }
  relationOperator(): boolean {
    const t = this.tok;
    if (t.kind === "sym" && ["==", "!=", "<=", ">=", "<", ">"].includes(t.text)) { this.p++; return true; }
    if (t.kind === "kw" && (t.text === "in" || t.text === "disjoint")) { this.p++; return true; }
    return this.fail("relation operator");
  }
}

const COMMAND_KEYWORDS = new Set([
  "construct", "borrow", "if", "match", "decide", "closure", "loop", "continue", "break", "receive_frame",
  "receive_exact", "receive", "recognize", "validate", "send_exact", "send", "select", "offer", "commit_receive",
  "reject", "fail", "close", "release", "convert", "transport", "accept", "invoke", "prove",
]);

// ------------------------------------------------------------------ driver

const ORDER = ["`;`", "`}`", "`)`", "`]`", "`,`", "`=`", "`{`", "`(`", "identifier", "type", "expression", "proposition"];

const CONTINUATION = new Set([
  "`.`", "`[`", "`(`", "`*`", "`/`", "`%`", "`+`", "`-`", "`<<`", "`>>`", "`or`", "`and`",
  "`==`", "`!=`", "`<=`", "`>=`", "`<`", "`>`", "`in`", "`disjoint`", "relation operator",
]);
const TYPE_STARTERS = ["`Unit`", "`Bool`", "`Char`", "`String`", "`F32`", "`F64`", "`Bytes`", "`Frame`", "`Proof`", "`Validated`", "`{`", "`(`", "identifier"];
const SESSION_STARTERS = ["`send`", "`receive`", "`select`", "`offer`", "`end`", "`recursive`", "`continue`", "identifier"];
const EXPR_STARTERS = ["`(`", "`-`", "`true`", "`false`", "`unit`", "identifier"];

function endsExpression(t: Token | undefined): boolean {
  if (!t) return false;
  if (["ident", "int", "float", "string", "char", "uint", "sint"].includes(t.kind)) return true;
  if (t.kind === "sym") return t.text === ")" || t.text === "]" || t.text === "}";
  return t.kind === "kw" && ["true", "false", "unit", "Unit", "Bool", "Char", "String", "F32", "F64", "Bytes"].includes(t.text);
}

/** Removes noise from an expected-token set; returns the meaningful labels. */
function simplifyExpected(raw: Set<string>, prev: Token | undefined): string[] {
  let items = [...raw];
  const has = (s: string) => items.includes(s);
  const drop = (xs: string[]) => { items = items.filter((s) => !xs.includes(s)); };
  if (has("proposition")) drop(["expression", "`not`", ...EXPR_STARTERS]);
  if (has("expression")) {
    drop(EXPR_STARTERS);
    items = items.filter((s) => !(s.startsWith("`") && COMMAND_KEYWORDS.has(s.slice(1, -1))));
  }
  if (has("type")) drop(TYPE_STARTERS);
  if (has("session")) drop(SESSION_STARTERS);
  if (endsExpression(prev)) {
    const rest = items.filter((s) => !CONTINUATION.has(s));
    if (rest.length > 0) items = rest;
    else items = ["an operator"];
  }
  const groups: [string, string[]][] = [
    ["a structural mode (`unrestricted`, `affine` or `linear`)", ["`unrestricted`", "`affine`", "`linear`"]],
    ["an outcome kind (`success`, `negative`, `terminal` or `fatal`)", ["`success`", "`negative`", "`terminal`", "`fatal`"]],
    ["a relation operator (`==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `disjoint`)", ["`==`", "`!=`", "`<=`", "`>=`", "`<`", "`>`", "`in`", "`disjoint`", "relation operator"]],
    ["a generic kind (`Type`, `Nat`, `Session`, `Message`, `Effects`, …)", ["`Type`", "`Nat`", "`Session`", "`Message`", "`Effects`"]],
  ];
  for (const [label, members] of groups) {
    if (items.filter((s) => members.includes(s)).length >= 3) { drop(members); items.push(label); }
  }
  const kws = items.filter((s) => /^`[a-z_]+`$/.test(s));
  if (kws.length > 6) { drop(kws); items.push("a keyword such as " + kws.slice(0, 4).join(", ")); }
  items.sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return items;
}

function formatExpected(items: string[]): string {
  let xs = items.map(article);
  if (xs.length > 6) xs = xs.slice(0, 6).concat("…");
  if (xs.length === 1) return xs[0];
  return xs.slice(0, -1).join(", ") + " or " + xs[xs.length - 1];
}

function article(s: string): string {
  switch (s) {
    case "identifier": return "a name";
    case "expression": return "an expression";
    case "type": return "a type";
    case "proposition": return "a proposition";
    case "session": return "a session type";
    case "integer": return "an integer";
    default: return s;
  }
}

function syntaxDiagnostic(parser: Parser, toks: Token[]): ParseDiagnostic {
  const at = toks[parser.furthest];
  const prev = parser.furthest > 0 ? toks[parser.furthest - 1] : undefined;
  const expected = parser.expected;
  const items = simplifyExpected(expected, prev);
  const expText = formatExpected(items);

  // Words from other languages, at the error or just before it.
  const foreign = [at, prev].find((t) => t && t.kind === "ident" && FOREIGN[t.text]);
  if (foreign) {
    return {
      code: "PHIL-P006", severity: "error", start: foreign.start, end: foreign.end,
      message: `\`${foreign.text}\` is not Phil syntax. ${FOREIGN[foreign.text]}`,
    };
  }
  // Assignment to an existing binding.
  if (at.kind === "sym" && at.text === "=" && prev && prev.kind === "ident" && expected.has("`;`")) {
    return {
      code: "PHIL-P008", severity: "error", start: at.start, end: at.end,
      message: "Phil has no assignment. Bindings are immutable: introduce a new name with `let x = ...;`, or thread loop state with `continue (...)`.",
      fix: { title: `Introduce a new binding: \`let ${prev.text} = ...\``, start: prev.start, end: prev.start, newText: "let " },
    };
  }
  // Reserved word where a name was expected.
  if (at.kind === "kw" && expected.has("identifier") && items.length <= 2) {
    return {
      code: "PHIL-P005", severity: "error", start: at.start, end: at.end,
      message: `\`${at.text}\` is a reserved word and cannot be used as a name.`,
    };
  }
  if (at.kind === "eof") {
    return {
      code: "PHIL-P009", severity: "error", start: prev ? prev.end : 0, end: prev ? prev.end : 0,
      message: `Unexpected end of file: expected ${expText}.`,
    };
  }
  // `retrun x;` — a misspelled keyword followed by an operand on the same line.
  if (prev && prev.kind === "ident" && at.line === prev.line && at.kind !== "sym" && expected.has("`;`")) {
    const prevPrev = parser.furthest > 1 ? toks[parser.furthest - 2] : undefined;
    const statementStart = !prevPrev || (prevPrev.kind === "sym" && [";", "{", "}", "=>"].includes(prevPrev.text));
    if (statementStart) {
      let best = "", bestD = 3;
      for (const c of ["let", "return", ...COMMAND_KEYWORDS]) {
        const d = editDistance(prev.text, c);
        if (d < bestD && d <= Math.max(1, Math.floor(c.length / 3))) { best = c; bestD = d; }
      }
      if (best) {
        return {
          code: "PHIL-P001", severity: "error", start: prev.start, end: prev.end,
          message: `Unknown statement word \`${prev.text}\`. Did you mean \`${best}\`?`,
          fix: { title: `Change to \`${best}\``, start: prev.start, end: prev.end, newText: best },
        };
      }
    }
  }
  // Missing semicolon: anchor right after the previous token, where the fix goes.
  if (prev && items.length === 1 && items[0] === "`;`") {
    return {
      code: "PHIL-P007", severity: "error", start: prev.end, end: prev.end,
      message: `Missing \`;\` after ${describe(prev)}.`,
      related: [{ message: `next token is ${describe(at)}`, start: at.start, end: at.end }],
      fix: { title: "Insert `;`", start: prev.end, end: prev.end, newText: ";" },
    };
  }
  let hint = "";
  if (at.kind === "ident" && at.text.length >= 3) {
    const candidates = [...expected].filter((e) => /^`[A-Za-z_]+`$/.test(e)).map((e) => e.slice(1, -1));
    if (expected.has("a declaration (`component`, `fn`, `record`, `data`, `protocol`, `architecture`, `program`, …)")) {
      candidates.push(...DECL_START, "fn", "import", "module");
    }
    let best = "", bestD = 3;
    for (const c of candidates) {
      const d = editDistance(at.text, c);
      if (d < bestD && d <= Math.max(1, Math.floor(c.length / 3))) { best = c; bestD = d; }
    }
    if (best) hint = ` Did you mean \`${best}\`?`;
  }
  const bestWord = hint ? hint.slice(hint.indexOf("`") + 1, hint.lastIndexOf("`")) : "";
  // A lone missing token: offer to insert it.
  const insertable = items.length === 1 && /^`[;:=,)\]}]`$/.test(items[0]) && prev ? items[0].slice(1, -1) : "";
  return {
    code: "PHIL-P001", severity: "error", start: at.start, end: at.end,
    message: `Expected ${expText}, found ${describe(at)}.${hint}`,
    fix: bestWord
      ? { title: `Change to \`${bestWord}\``, start: at.start, end: at.end, newText: bestWord }
      : insertable && prev
        ? { title: `Insert \`${insertable}\``, start: prev.end, end: prev.end, newText: insertable }
        : undefined,
  };
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? dp[i - 2][j - 2] + 1 : Infinity);
  return dp[a.length][b.length];
}

/** Bracket balance check; reports unclosed and unmatched delimiters with both ends. */
function bracketDiagnostics(toks: Token[]): ParseDiagnostic[] {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const closers: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: Token[] = [];
  const out: ParseDiagnostic[] = [];
  for (const t of toks) {
    if (t.kind !== "sym") continue;
    if (pairs[t.text]) stack.push(t);
    else if (closers[t.text]) {
      const top = stack[stack.length - 1];
      if (top && top.text === closers[t.text]) {
        stack.pop();
      } else if (top && stack.some((s) => s.text === closers[t.text])) {
        // Closer matches something further down: the top was never closed.
        out.push({
          code: "PHIL-P002", severity: "error", start: top.start, end: top.end,
          message: `Unclosed \`${top.text}\`: expected \`${pairs[top.text]}\` before \`${t.text}\` on line ${t.line + 1}.`,
          related: [{ message: `\`${t.text}\` found here`, start: t.start, end: t.end }],
        });
        while (stack.length && stack[stack.length - 1].text !== closers[t.text]) stack.pop();
        stack.pop();
      } else {
        out.push({
          code: "PHIL-P003", severity: "error", start: t.start, end: t.end,
          message: `Unmatched \`${t.text}\`${top ? ` (the innermost open delimiter is \`${top.text}\` on line ${top.line + 1})` : ""}.`,
        });
      }
    }
    if (out.length >= 20) return out;
  }
  for (const t of stack.reverse()) {
    out.push({
      code: "PHIL-P002", severity: "error", start: t.start, end: t.end,
      message: `Unclosed \`${t.text}\`: no matching \`${pairs[t.text]}\` before the end of the file.`,
    });
  }
  return out;
}

function buildSymbols(events: Event[], toks: Token[]): { symbols: PhilSymbol[]; groups: { what: string; items: number[] }[] } {
  const root: PhilSymbol[] = [];
  const stack: PhilSymbol[] = [];
  const groups: { what: string; items: number[] }[] = [];
  for (const e of events) {
    if (e.t === "open") {
      const s: PhilSymbol = { name: e.name, kind: e.kind, detail: e.detail, startTok: e.startTok, endTok: e.startTok, nameTok: e.nameTok, children: [] };
      (stack.length ? stack[stack.length - 1].children : root).push(s);
      stack.push(s);
    } else if (e.t === "close") {
      const s = stack.pop();
      if (s) s.endTok = Math.max(e.endTok, s.nameTok);
    } else if (e.t === "group") {
      groups.push(e);
    }
  }
  // Drop anonymous symbols (should not happen) and parameter-symbols' noise is kept.
  const clean = (list: PhilSymbol[]): PhilSymbol[] =>
    list.filter((s) => s.name !== "").map((s) => ({ ...s, children: clean(s.children) }));
  void toks;
  return { symbols: clean(root), groups };
}

const GROUP_LABEL: Record<string, string> = {
  field: "field",
  variant: "variant",
  parameter: "parameter",
  arm: "match arm",
  branch: "protocol branch",
};

function duplicateDiagnostics(groups: { what: string; items: number[] }[], symbols: PhilSymbol[], toks: Token[]): ParseDiagnostic[] {
  const out: ParseDiagnostic[] = [];
  const check = (items: number[], label: string, code: string, severity: ParseDiagnostic["severity"]) => {
    const seen = new Map<string, Token>();
    for (const i of items) {
      // Use the full qualified label for arms (e.g. Outcome.ok).
      let j = i;
      let name = toks[i].text;
      while (toks[j + 1]?.text === "." && toks[j + 2]?.kind === "ident") { name += "." + toks[j + 2].text; j += 2; }
      const first = seen.get(name);
      if (first) {
        out.push({
          code, severity, start: toks[i].start, end: toks[j].end,
          message: `Duplicate ${label} \`${name}\`.`,
          related: [{ message: `first ${label} \`${name}\``, start: first.start, end: first.end }],
        });
      } else {
        seen.set(name, toks[i]);
      }
    }
  };
  for (const g of groups) check(g.items, GROUP_LABEL[g.what] ?? g.what, "PHIL-S002", "error");
  // Top-level declaration names (module excluded).
  check(symbols.filter((s) => s.kind !== "module").map((s) => s.nameTok), "top-level declaration name", "PHIL-S001", "warning");
  return out;
}

function hasStatementSemicolons(toks: Token[]): boolean {
  return toks.some((t) => t.kind === "sym" && t.text === ";");
}

export type SyntaxMode = "auto" | "grammar-v1" | "legacy";

export function parse(src: string, options: { maxErrors?: number; syntax?: SyntaxMode } = {}): ParseResult {
  const lexed = lex(src);
  const toks = lexed.tokens;
  const maxErrors = options.maxErrors ?? 10;
  const diagnostics: ParseDiagnostic[] = lexed.diagnostics.map((d: LexDiagnostic) => ({ ...d, severity: "error" as const }));
  const brackets = bracketDiagnostics(toks);
  const parser = new Parser(toks, lexed.diagnostics);
  const syntax: ParseDiagnostic[] = [];
  const partial: PhilSymbol[] = [];

  // source_file = [ module_decl ], { import_decl }, { top_level_decl } ;
  parser.opt(() => parser.moduleDecl());
  parser.many(() => parser.importDecl());
  while (toks[parser.p].kind !== "eof") {
    const before = parser.p;
    parser.furthest = parser.p;
    parser.expected = new Set();
    if (parser.attempt(() => parser.topLevelDecl())) continue;
    if (parser.furthest === before && !DECL_START.has(toks[before].text) && toks[before].text !== "@") {
      parser.expected = new Set(["a declaration (`component`, `fn`, `record`, `data`, `protocol`, `architecture`, `program`, …)"]);
      if (toks[before].kind === "kw" && (toks[before].text === "import" || toks[before].text === "module")) {
        parser.expected.add(toks[before].text === "import" ? "(imports must come before declarations)" : "(the module declaration must be first)");
      }
    }
    const diag = syntaxDiagnostic(parser, toks);
    // Skip knock-on errors caused by characters the lexer already rejected.
    const atTok = toks[parser.furthest];
    const prevEnd = parser.furthest > 0 ? toks[parser.furthest - 1].end : 0;
    const causedByLexError = lexed.diagnostics.some((l) => l.start >= prevEnd && l.start <= atTok.start);
    if (!causedByLexError) syntax.push(diag);
    if (syntax.length >= maxErrors) break;
    // Resynchronise at the next declaration keyword that starts a line.
    let q = Math.max(parser.furthest, before + 1);
    while (q < toks.length - 1) {
      const t = toks[q];
      const startsLine = q === 0 || toks[q - 1].endLine < t.line;
      if (startsLine && t.col === 0 && (DECL_START.has(t.text) || t.text === "@") && t.kind !== "ident") break;
      q++;
    }
    // Keep a best-effort outline entry for the broken declaration.
    let k = before;
    while (k < q && (toks[k].text === "@" || toks[k].kind !== "kw")) k++;
    const kwTok = toks[k];
    let n = k + 1;
    while (n < q && toks[n].kind === "kw") n++;
    if (kwTok && kwTok.kind === "kw" && n < q && toks[n].kind === "ident") {
      const kindMap: Record<string, SymbolKind> = {
        record: "record", data: "data", type: "type", claim: "claim", callable: "callable", fn: "function",
        recursive: "function", provider: "provider", opaque: "implementation", protocol: "protocol",
        capability: "capability", boundary: "boundary", architecture: "architecture", component: "component", program: "program",
      };
      const kind = kindMap[kwTok.text];
      if (kind) partial.push({ name: toks[n].text, kind, detail: kwTok.text + " (has errors)", startTok: before, endTok: Math.max(q - 1, n), nameTok: n, children: [] });
    }
    parser.p = q;
  }

  for (const e of parser.events) if (e.t === "error") syntax.push(e.diag);
  syntax.sort((a, b) => a.start - b.start);
  if (syntax.length > maxErrors) syntax.length = maxErrors;
  const built = buildSymbols(parser.events, toks);
  const groups = built.groups;
  const symbols = [...built.symbols, ...partial].sort((a, b) => a.startTok - b.startTok);

  // Legacy (Phase 0) detection: not valid Grammar v1 and no semicolons at all.
  const mode = options.syntax ?? "auto";
  const legacy = mode === "legacy" || (mode === "auto" && syntax.length > 0 && !hasStatementSemicolons(toks));
  if (legacy) {
    diagnostics.push(...brackets);
    const first = syntax[0];
    let where = "";
    if (first) {
      const line = src.slice(0, first.start).split("\n").length;
      where = ` If it is meant to be Grammar v1, the first problem is on line ${line}: ${first.message}`;
    }
    diagnostics.push({
      code: "PHIL-I001", severity: "information", start: 0, end: 0,
      message: (mode === "legacy"
        ? "Checked as legacy Phase 0 surface syntax (setting `phil.syntax`). Only lexical and bracket checks are applied."
        : "This file looks like legacy Phase 0 surface syntax (no `;` terminators), not canonical Grammar v1. Only lexical and bracket checks are applied; `philc` still compiles this legacy form. Set `phil.syntax` to `grammar-v1` to force full checking.") + where,
    });
  } else if (brackets.length > 0) {
    diagnostics.push(...brackets);
  } else {
    diagnostics.push(...syntax);
    diagnostics.push(...duplicateDiagnostics(groups, symbols, toks));
  }
  diagnostics.sort((a, b) => a.start - b.start);
  return { lex: lexed, symbols: legacy ? [] : symbols, diagnostics, legacy };
}
