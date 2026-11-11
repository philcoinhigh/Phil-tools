import * as vscode from "vscode";
import { execFile } from "child_process";
import { parse, ParseResult, PhilSymbol, SymbolKind } from "./parser";
import { Token, RESERVED } from "./lexer";
import { formatLines } from "./format";
import { CODE_MAP, codesMarkdown } from "./codes";
import keywordDocs from "./keywords.json";

const KEYWORDS = keywordDocs as Record<string, { category: string; meaning: string; note?: string }>;
const DOCS_SCHEME = "phil-docs";

// ------------------------------------------------------------------ parse cache

const cache = new Map<string, { version: number; result: ParseResult }>();

function parseDoc(doc: vscode.TextDocument): ParseResult {
  const key = doc.uri.toString();
  const hit = cache.get(key);
  if (hit && hit.version === doc.version) return hit.result;
  const maxErrors = vscode.workspace.getConfiguration("phil", doc.uri).get<number>("diagnostics.maxErrors", 10);
  const syntax = vscode.workspace.getConfiguration("phil", doc.uri).get<"auto" | "grammar-v1" | "legacy">("syntax", "auto");
  const result = parse(doc.getText(), { maxErrors, syntax });
  cache.set(key, { version: doc.version, result });
  return result;
}

function tokRange(doc: vscode.TextDocument, a: Token, b: Token = a): vscode.Range {
  return new vscode.Range(doc.positionAt(a.start), doc.positionAt(b.end));
}

function tokenAt(result: ParseResult, offset: number): Token | undefined {
  const toks = result.lex.tokens;
  let lo = 0, hi = toks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = toks[mid];
    if (offset < t.start) hi = mid - 1;
    else if (offset >= t.end) lo = mid + 1;
    else return t;
  }
  // Cursor right after a token (e.g. at end of word).
  const prev = toks[lo - 1];
  return prev && prev.end === offset ? prev : undefined;
}

// ------------------------------------------------------------------ diagnostics

const fixes = new WeakMap<vscode.Diagnostic, { title: string; range: vscode.Range; newText: string }>();

function updateDiagnostics(doc: vscode.TextDocument, collection: vscode.DiagnosticCollection, status: vscode.LanguageStatusItem): void {
  if (doc.languageId !== "phil") return;
  if (!vscode.workspace.getConfiguration("phil", doc.uri).get<boolean>("diagnostics.enable", true)) {
    collection.delete(doc.uri);
    return;
  }
  const result = parseDoc(doc);
  const severities = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    information: vscode.DiagnosticSeverity.Information,
    hint: vscode.DiagnosticSeverity.Hint,
  };
  const diags = result.diagnostics.map((d) => {
    const range = new vscode.Range(doc.positionAt(d.start), doc.positionAt(Math.max(d.end, d.start)));
    const diag = new vscode.Diagnostic(range, d.message, severities[d.severity]);
    diag.code = d.code;
    diag.source = "phil";
    if (d.related) {
      diag.relatedInformation = d.related.map((r) =>
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(doc.uri, new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end))), r.message));
    }
    if (d.fix) {
      fixes.set(diag, {
        title: d.fix.title,
        range: new vscode.Range(doc.positionAt(d.fix.start), doc.positionAt(d.fix.end)),
        newText: d.fix.newText,
      });
    }
    return diag;
  });
  collection.set(doc.uri, diags);
  updateStatus(doc, status);
}

function updateStatus(doc: vscode.TextDocument | undefined, status: vscode.LanguageStatusItem): void {
  if (!doc || doc.languageId !== "phil") return;
  const result = parseDoc(doc);
  const errors = result.diagnostics.filter((d) => d.severity === "error").length;
  if (result.legacy) {
    status.text = "Phil: legacy Phase 0 syntax";
    status.detail = "Only lexical and bracket checks apply";
    status.severity = vscode.LanguageStatusSeverity.Warning;
  } else if (errors > 0) {
    status.text = `Phil Grammar v1: ${errors} syntax error${errors === 1 ? "" : "s"}`;
    status.detail = "Syntax only — semantic checking is done by the Phil checker";
    status.severity = vscode.LanguageStatusSeverity.Error;
  } else {
    status.text = "Phil Grammar v1: syntax OK";
    status.detail = "Syntax only — semantic checking is done by the Phil checker";
    status.severity = vscode.LanguageStatusSeverity.Information;
  }
}

class QuickFixProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];
  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diag of ctx.diagnostics) {
      if (diag.source !== "phil") continue;
      const fix = fixes.get(diag);
      if (fix) {
        const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(doc.uri, fix.range, fix.newText);
        action.diagnostics = [diag];
        action.isPreferred = true;
        actions.push(action);
      }
      const code = typeof diag.code === "string" ? diag.code : undefined;
      if (code && CODE_MAP.has(code)) {
        const explain = new vscode.CodeAction(`Explain ${code}`, vscode.CodeActionKind.QuickFix);
        explain.command = { command: "phil.showErrorCodes", title: `Explain ${code}`, arguments: [code] };
        explain.diagnostics = [diag];
        actions.push(explain);
      }
    }
    return actions;
  }
}

// ------------------------------------------------------------------ symbols

const SYMBOL_KINDS: Record<SymbolKind, vscode.SymbolKind> = {
  module: vscode.SymbolKind.Module,
  record: vscode.SymbolKind.Struct,
  data: vscode.SymbolKind.Enum,
  type: vscode.SymbolKind.TypeParameter,
  claim: vscode.SymbolKind.Boolean,
  callable: vscode.SymbolKind.Interface,
  function: vscode.SymbolKind.Function,
  provider: vscode.SymbolKind.Interface,
  implementation: vscode.SymbolKind.Class,
  protocol: vscode.SymbolKind.Event,
  capability: vscode.SymbolKind.Key,
  boundary: vscode.SymbolKind.Struct,
  architecture: vscode.SymbolKind.Namespace,
  component: vscode.SymbolKind.Function,
  program: vscode.SymbolKind.Package,
  field: vscode.SymbolKind.Field,
  variant: vscode.SymbolKind.EnumMember,
  operation: vscode.SymbolKind.Method,
  law: vscode.SymbolKind.Property,
  lifecycle: vscode.SymbolKind.Property,
  role: vscode.SymbolKind.Interface,
  instance: vscode.SymbolKind.Object,
  process: vscode.SymbolKind.Event,
  ref: vscode.SymbolKind.Variable,
  entry: vscode.SymbolKind.Variable,
  authority: vscode.SymbolKind.Key,
  variable: vscode.SymbolKind.Variable,
  parameter: vscode.SymbolKind.Variable,
};

function toDocSymbols(doc: vscode.TextDocument, result: ParseResult, symbols: PhilSymbol[]): vscode.DocumentSymbol[] {
  const toks = result.lex.tokens;
  return symbols.map((s) => {
    const range = tokRange(doc, toks[s.startTok], toks[Math.max(s.endTok, s.startTok)]);
    const sel = tokRange(doc, toks[s.nameTok]);
    const ds = new vscode.DocumentSymbol(s.name, s.detail, SYMBOL_KINDS[s.kind], range.union(sel), sel);
    ds.children = toDocSymbols(doc, result, s.children);
    return ds;
  });
}

function flatten(symbols: PhilSymbol[], out: PhilSymbol[] = []): PhilSymbol[] {
  for (const s of symbols) { out.push(s); flatten(s.children, out); }
  return out;
}

// ------------------------------------------------------------------ workspace index

interface IndexedSymbol { name: string; kind: SymbolKind; detail: string; uri: vscode.Uri; range: vscode.Range; signature: string; topLevel: boolean }

class WorkspaceIndex {
  private byUri = new Map<string, IndexedSymbol[]>();

  async init(): Promise<void> {
    const files = await vscode.workspace.findFiles("**/*.phil", "**/{node_modules,.git,dist-newstyle}/**", 5000);
    for (const uri of files) await this.refreshUri(uri);
  }
  async refreshUri(uri: vscode.Uri): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      this.refresh(doc);
    } catch {
      this.byUri.delete(uri.toString());
    }
  }
  refresh(doc: vscode.TextDocument): void {
    const result = parseDoc(doc);
    const toks = result.lex.tokens;
    const items: IndexedSymbol[] = [];
    const visit = (list: PhilSymbol[], topLevel: boolean) => {
      for (const s of list) {
        if (s.kind === "variable" || s.kind === "parameter") continue;
        const start = toks[s.startTok];
        const line = doc.lineAt(doc.positionAt(start.start).line).text.trim();
        items.push({ name: s.name, kind: s.kind, detail: s.detail, uri: doc.uri, range: tokRange(doc, toks[s.nameTok]), signature: line, topLevel });
        visit(s.children, false);
      }
    };
    visit(result.symbols, true);
    this.byUri.set(doc.uri.toString(), items);
  }
  remove(uri: vscode.Uri): void { this.byUri.delete(uri.toString()); }
  find(name: string): IndexedSymbol[] {
    const out: IndexedSymbol[] = [];
    for (const items of this.byUri.values()) for (const s of items) if (s.name === name) out.push(s);
    return out;
  }
  all(): IndexedSymbol[] { return [...this.byUri.values()].flat(); }
  uris(): string[] { return [...this.byUri.keys()]; }
}

/** Local symbols (let bindings / parameters / members) visible at a position: innermost declaration first. */
function localDefinitions(doc: vscode.TextDocument, result: ParseResult, name: string, offset: number): vscode.Location[] {
  const toks = result.lex.tokens;
  const containing = result.symbols.find((s) => toks[s.startTok].start <= offset && offset <= toks[s.endTok].end);
  if (!containing) return [];
  const candidates = flatten(containing.children).filter((s) => s.name === name && toks[s.nameTok].start <= offset);
  // Nearest preceding binding wins (Phil let-rebinding shadows earlier ones).
  candidates.sort((a, b) => toks[b.nameTok].start - toks[a.nameTok].start);
  return candidates.slice(0, 1).map((s) => new vscode.Location(doc.uri, tokRange(doc, toks[s.nameTok])));
}

// ------------------------------------------------------------------ activation

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = { language: "phil" };
  const collection = vscode.languages.createDiagnosticCollection("phil");
  const philcCollection = vscode.languages.createDiagnosticCollection("philc");
  const status = vscode.languages.createLanguageStatusItem("phil.status", selector);
  status.name = "Phil";
  status.command = { command: "phil.showErrorCodes", title: "Error codes" };
  const index = new WorkspaceIndex();
  void index.init();
  context.subscriptions.push(collection, philcCollection, status);

  // Diagnostics, debounced while typing.
  const timers = new Map<string, NodeJS.Timeout>();
  const schedule = (doc: vscode.TextDocument) => {
    if (doc.languageId !== "phil") return;
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      updateDiagnostics(doc, collection, status);
      index.refresh(doc);
    }, 150));
  };
  vscode.workspace.textDocuments.forEach((d) => updateDiagnostics(d, collection, status));
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => updateDiagnostics(d, collection, status)),
    vscode.workspace.onDidChangeTextDocument((e) => { schedule(e.document); philcCollection.delete(e.document.uri); }),
    vscode.workspace.onDidCloseTextDocument((d) => { cache.delete(d.uri.toString()); }),
    vscode.window.onDidChangeActiveTextEditor((e) => updateStatus(e?.document, status)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("phil")) {
        cache.clear();
        vscode.workspace.textDocuments.forEach((d) => updateDiagnostics(d, collection, status));
      }
    }),
  );
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.phil");
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate((u) => void index.refreshUri(u)),
    watcher.onDidChange((u) => { if (!vscode.workspace.textDocuments.some((d) => d.uri.toString() === u.toString())) void index.refreshUri(u); }),
    watcher.onDidDelete((u) => index.remove(u)),
  );

  // Quick fixes.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(selector, new QuickFixProvider(), { providedCodeActionKinds: QuickFixProvider.kinds }),
  );

  // Outline.
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(selector, {
    provideDocumentSymbols(doc) {
      const result = parseDoc(doc);
      return toDocSymbols(doc, result, result.symbols);
    },
  }, { label: "Phil" }));

  context.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider({
    provideWorkspaceSymbols(query) {
      const q = query.toLowerCase();
      return index.all()
        .filter((s) => s.name.toLowerCase().includes(q))
        .slice(0, 500)
        .map((s) => new vscode.SymbolInformation(s.name, SYMBOL_KINDS[s.kind], s.detail, new vscode.Location(s.uri, s.range)));
    },
  }));

  // Hover: keyword meanings, declaration signatures, and error-code explanations.
  context.subscriptions.push(vscode.languages.registerHoverProvider(selector, {
    provideHover(doc, pos) {
      const result = parseDoc(doc);
      const offset = doc.offsetAt(pos);
      const parts: vscode.MarkdownString[] = [];

      for (const d of vscode.languages.getDiagnostics(doc.uri)) {
        if (d.source !== "phil" || !d.range.contains(pos) || typeof d.code !== "string") continue;
        const info = CODE_MAP.get(d.code);
        if (info) {
          const md = new vscode.MarkdownString(`**${info.code} — ${info.title}**\n\n${info.explanation}`);
          if (info.good) md.appendMarkdown("\n\nFor example:").appendCodeblock(info.good, "phil");
          parts.push(md);
        }
      }

      const tok = tokenAt(result, offset);
      if (tok) {
        const range = tokRange(doc, tok);
        if (tok.kind === "kw" || (tok.kind === "ident" && KEYWORDS[tok.text])) {
          const k = KEYWORDS[tok.text];
          if (k) {
            const md = new vscode.MarkdownString();
            md.appendCodeblock(tok.text, "phil");
            md.appendMarkdown(`${k.meaning}\n\n*${k.category}*${k.note ? `\n\n_${k.note}_` : ""}`);
            parts.push(md);
          }
        } else if (tok.kind === "uint" || tok.kind === "sint") {
          const bits = tok.text.slice(1);
          parts.push(new vscode.MarkdownString(
            `\`${tok.text}\` — fixed-width ${tok.kind === "uint" ? "unsigned" : "signed"} ${bits}-bit integer.\n\n` +
            "Phil arithmetic is language semantics, not host behaviour: overflow is never silently wrapped. Supported widths are checked semantically."));
        } else if (tok.kind === "ident") {
          const local = localDefinitions(doc, result, tok.text, offset);
          if (local.length === 0) {
            const defs = index.find(tok.text).filter((s) => s.topLevel);
            if (defs.length > 0) {
              const md = new vscode.MarkdownString();
              for (const d of defs.slice(0, 3)) md.appendCodeblock(d.signature, "phil");
              if (defs.length > 3) md.appendMarkdown(`…and ${defs.length - 3} more`);
              parts.push(md);
            }
          }
        }
        if (parts.length) return new vscode.Hover(parts, range);
      }
      return parts.length ? new vscode.Hover(parts) : undefined;
    },
  }));

  // Go to definition.
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, {
    provideDefinition(doc, pos) {
      const result = parseDoc(doc);
      const offset = doc.offsetAt(pos);
      const tok = tokenAt(result, offset);
      if (!tok || tok.kind !== "ident") return undefined;
      const local = localDefinitions(doc, result, tok.text, offset);
      if (local.length) return local;
      const defs = index.find(tok.text);
      const sameFile = defs.filter((d) => d.uri.toString() === doc.uri.toString());
      const pick = sameFile.length ? sameFile : defs;
      const top = pick.filter((d) => d.topLevel);
      return (top.length ? top : pick).map((d) => new vscode.Location(d.uri, d.range));
    },
  }));

  // Find references: identifier tokens with the same spelling across the workspace.
  context.subscriptions.push(vscode.languages.registerReferenceProvider(selector, {
    async provideReferences(doc, pos) {
      const tok = tokenAt(parseDoc(doc), doc.offsetAt(pos));
      if (!tok || tok.kind !== "ident") return [];
      const out: vscode.Location[] = [];
      const uris = new Set([doc.uri.toString(), ...index.uris()]);
      for (const u of uris) {
        const d = await vscode.workspace.openTextDocument(vscode.Uri.parse(u));
        for (const t of parseDoc(d).lex.tokens) {
          if (t.kind === "ident" && t.text === tok.text) out.push(new vscode.Location(d.uri, tokRange(d, t)));
        }
      }
      return out;
    },
  }));

  // Highlight other occurrences of the identifier under the cursor.
  context.subscriptions.push(vscode.languages.registerDocumentHighlightProvider(selector, {
    provideDocumentHighlights(doc, pos) {
      const result = parseDoc(doc);
      const tok = tokenAt(result, doc.offsetAt(pos));
      if (!tok || tok.kind !== "ident") return [];
      return result.lex.tokens.filter((t) => t.kind === "ident" && t.text === tok.text)
        .map((t) => new vscode.DocumentHighlight(tokRange(doc, t)));
    },
  }));

  // Completion: keywords (with meanings), declared names.
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
    provideCompletionItems(doc, pos) {
      const result = parseDoc(doc);
      const offset = doc.offsetAt(pos);
      // No completion inside comments or strings.
      if (result.lex.comments.some((c) => c.start <= offset && offset <= c.end)) return [];
      const t = tokenAt(result, offset);
      if (t && (t.kind === "string" || t.kind === "char") && offset > t.start && offset < t.end) return [];
      const items: vscode.CompletionItem[] = [];
      for (const word of RESERVED) {
        const item = new vscode.CompletionItem(word, vscode.CompletionItemKind.Keyword);
        const k = KEYWORDS[word];
        if (k) { item.detail = k.category; item.documentation = new vscode.MarkdownString(k.meaning); }
        items.push(item);
      }
      const seen = new Set<string>();
      for (const s of flatten(result.symbols)) {
        if (seen.has(s.name)) continue;
        seen.add(s.name);
        const item = new vscode.CompletionItem(s.name, completionKind(s.kind));
        item.detail = s.detail;
        items.push(item);
      }
      for (const s of index.all()) {
        if (!s.topLevel || seen.has(s.name)) continue;
        seen.add(s.name);
        const item = new vscode.CompletionItem(s.name, completionKind(s.kind));
        item.detail = `${s.detail} · ${vscode.workspace.asRelativePath(s.uri)}`;
        items.push(item);
      }
      return items;
    },
  }));

  // Folding: multi-line bracket pairs and runs of comment lines.
  context.subscriptions.push(vscode.languages.registerFoldingRangeProvider(selector, {
    provideFoldingRanges(doc) {
      const result = parseDoc(doc);
      const ranges: vscode.FoldingRange[] = [];
      const stack: Token[] = [];
      for (const t of result.lex.tokens) {
        if (t.kind !== "sym") continue;
        if (t.text === "{" || t.text === "(" || t.text === "[") stack.push(t);
        else if (t.text === "}" || t.text === ")" || t.text === "]") {
          const open = stack.pop();
          if (open && t.line > open.line) ranges.push(new vscode.FoldingRange(open.line, t.line - 1));
        }
      }
      const commentLines = result.lex.comments.map((c) => c.line);
      let start = -1;
      for (let i = 0; i < commentLines.length; i++) {
        if (start < 0) start = commentLines[i];
        const next = commentLines[i + 1];
        if (next !== commentLines[i] + 1) {
          if (commentLines[i] > start) ranges.push(new vscode.FoldingRange(start, commentLines[i], vscode.FoldingRangeKind.Comment));
          start = -1;
        }
      }
      return ranges;
    },
  }));

  // Formatting (indentation only).
  const formatter: vscode.DocumentFormattingEditProvider & vscode.DocumentRangeFormattingEditProvider = {
    provideDocumentFormattingEdits(doc, options) {
      return formatEdits(doc, options);
    },
    provideDocumentRangeFormattingEdits(doc, range, options) {
      return formatEdits(doc, options).filter((e) => e.range.start.line >= range.start.line && e.range.start.line <= range.end.line);
    },
  };
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(selector, formatter),
    vscode.languages.registerDocumentRangeFormattingEditProvider(selector, formatter),
  );

  // Error code reference (virtual markdown document).
  const docsProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string { return codesMarkdown(); }
  })();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DOCS_SCHEME, docsProvider));
  context.subscriptions.push(vscode.commands.registerCommand("phil.showErrorCodes", async (code?: string) => {
    const uri = vscode.Uri.parse(`${DOCS_SCHEME}:Phil Error Codes.md${code ? "#" + code.toLowerCase() : ""}`);
    try {
      await vscode.commands.executeCommand("markdown.showPreview", uri);
    } catch {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true });
    }
  }));

  // philc integration.
  context.subscriptions.push(vscode.commands.registerCommand("phil.emitLlvm", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "phil") {
      void vscode.window.showWarningMessage("Open a .phil file first.");
      return;
    }
    const doc = editor.document;
    if (doc.isUntitled) {
      void vscode.window.showWarningMessage("Save the file before running philc.");
      return;
    }
    if (doc.isDirty) await doc.save();
    const cfg = vscode.workspace.getConfiguration("phil", doc.uri);
    const philc = cfg.get<string>("philc.path", "philc");
    const target = cfg.get<string>("philc.target", "x86_64-unknown-linux-gnu");
    philcCollection.delete(doc.uri);
    execFile(philc, ["emit-llvm", "--target", target, doc.uri.fsPath], { maxBuffer: 16 * 1024 * 1024 }, async (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        const choice = await vscode.window.showErrorMessage(
          `philc was not found at "${philc}". Build it from the Phil repository with \`cabal build exe:philc\` (then \`cabal list-bin exe:philc\` prints its path), or install a Phil release package.`,
          "Open Settings");
        if (choice) void vscode.commands.executeCommand("workbench.action.openSettings", "phil.philc.path");
        return;
      }
      if (err) {
        const message = (stderr || err.message).trim();
        const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, doc.lineAt(0).text.length), `philc: ${message}`, vscode.DiagnosticSeverity.Error);
        diag.code = "PHIL-C001";
        diag.source = "philc";
        philcCollection.set(doc.uri, [diag]);
        void vscode.window.showErrorMessage(`philc rejected ${vscode.workspace.asRelativePath(doc.uri)}: ${message}`);
        return;
      }
      const out = await vscode.workspace.openTextDocument({ content: stdout, language: "llvm" });
      await vscode.window.showTextDocument(out, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    });
  }));
}

function completionKind(kind: SymbolKind): vscode.CompletionItemKind {
  switch (kind) {
    case "function": case "component": case "operation": return vscode.CompletionItemKind.Function;
    case "record": case "boundary": return vscode.CompletionItemKind.Struct;
    case "data": return vscode.CompletionItemKind.Enum;
    case "variant": return vscode.CompletionItemKind.EnumMember;
    case "field": return vscode.CompletionItemKind.Field;
    case "callable": case "provider": case "role": return vscode.CompletionItemKind.Interface;
    case "module": case "architecture": return vscode.CompletionItemKind.Module;
    case "variable": case "parameter": case "instance": case "entry": case "ref": return vscode.CompletionItemKind.Variable;
    default: return vscode.CompletionItemKind.Reference;
  }
}

function formatEdits(doc: vscode.TextDocument, options: vscode.FormattingOptions): vscode.TextEdit[] {
  if (!vscode.workspace.getConfiguration("phil", doc.uri).get<boolean>("format.enable", true)) return [];
  return formatLines(doc.getText(), { tabSize: options.tabSize, insertSpaces: options.insertSpaces })
    .map((e) => vscode.TextEdit.replace(doc.lineAt(e.line).range, e.newText.replace(/\r$/, "")));
}

export function deactivate(): void {}
