// Minimal stand-in for the `vscode` module, sufficient to activate the
// extension and call its providers outside the editor.
/* eslint-disable @typescript-eslint/no-explicit-any */

export class Position {
  constructor(readonly line: number, readonly character: number) {}
  isBefore(o: Position) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isAfter(o: Position) { return o.isBefore(this); }
}
export class Range {
  readonly start: Position; readonly end: Position;
  constructor(a: any, b: any, c?: number, d?: number) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c!, d!); }
    else { this.start = a; this.end = b; }
  }
  contains(p: Position) { return !p.isBefore(this.start) && !p.isAfter(this.end); }
  union(o: Range) {
    return new Range(this.start.isBefore(o.start) ? this.start : o.start, this.end.isAfter(o.end) ? this.end : o.end);
  }
}
export class Location { constructor(readonly uri: Uri, readonly range: Range) {} }
export class Uri {
  constructor(readonly scheme: string, readonly path: string) {}
  static parse(s: string) { const i = s.indexOf(":"); return new Uri(s.slice(0, i), s.slice(i + 1)); }
  static file(p: string) { return new Uri("file", p); }
  get fsPath() { return this.path; }
  toString() { return `${this.scheme}:${this.path}`; }
}
export enum DiagnosticSeverity { Error, Warning, Information, Hint }
export class Diagnostic {
  code?: string; source?: string; relatedInformation?: any[];
  constructor(readonly range: Range, readonly message: string, readonly severity: DiagnosticSeverity) {}
}
export class DiagnosticRelatedInformation { constructor(readonly location: Location, readonly message: string) {} }
export class MarkdownString {
  value = "";
  constructor(v = "") { this.value = v; }
  appendMarkdown(s: string) { this.value += s; return this; }
  appendCodeblock(s: string, lang = "") { this.value += "\n```" + lang + "\n" + s + "\n```\n"; return this; }
}
export class Hover { constructor(readonly contents: any, readonly range?: Range) {} }
export class CodeAction { edit?: WorkspaceEdit; diagnostics?: any[]; isPreferred?: boolean; command?: any; constructor(readonly title: string, readonly kind: any) {} }
export const CodeActionKind = { QuickFix: "quickfix" };
export class WorkspaceEdit { edits: any[] = []; replace(uri: Uri, range: Range, text: string) { this.edits.push({ uri, range, text }); } }
export class TextEdit { constructor(readonly range: Range, readonly newText: string) {} static replace(r: Range, t: string) { return new TextEdit(r, t); } }
export class DocumentSymbol { children: DocumentSymbol[] = []; constructor(readonly name: string, readonly detail: string, readonly kind: number, readonly range: Range, readonly selectionRange: Range) {} }
export class SymbolInformation { constructor(readonly name: string, readonly kind: number, readonly containerName: string, readonly location: Location) {} }
export class CompletionItem { detail?: string; documentation?: any; constructor(readonly label: string, readonly kind: number) {} }
export class FoldingRange { constructor(readonly start: number, readonly end: number, readonly kind?: number) {} }
export class DocumentHighlight { constructor(readonly range: Range) {} }
export enum FoldingRangeKind { Comment = 1 }
export const SymbolKind = new Proxy({}, { get: (_t, k) => String(k).length });
export const CompletionItemKind = new Proxy({}, { get: (_t, k) => String(k).length });
export enum LanguageStatusSeverity { Information, Warning, Error }
export const ViewColumn = { Beside: -2 };

export class FakeDocument {
  version = 1; isDirty = false; isUntitled = false;
  constructor(readonly uri: Uri, private text: string, readonly languageId = "phil") {}
  getText() { return this.text; }
  setText(t: string) { this.text = t; this.version++; }
  private starts() { const s = [0]; for (let i = 0; i < this.text.length; i++) if (this.text[i] === "\n") s.push(i + 1); return s; }
  positionAt(off: number) { const s = this.starts(); let l = 0; while (l + 1 < s.length && s[l + 1] <= off) l++; return new Position(l, off - s[l]); }
  offsetAt(p: Position) { return this.starts()[p.line] + p.character; }
  lineAt(line: number) { const t = this.text.split("\n")[line] ?? ""; return { text: t, range: new Range(line, 0, line, t.length) }; }
}

export const registered: Record<string, any[]> = {};
const reg = (kind: string) => (...args: any[]) => { (registered[kind] ??= []).push(args); return { dispose() {} }; };
export const diagnosticsStore = new Map<string, Diagnostic[]>();
export const commandRegistry: Record<string, (...a: any[]) => any> = {};
export const openDocs: FakeDocument[] = [];
const config: Record<string, any> = {};

export const languages = {
  createDiagnosticCollection: () => ({
    set: (uri: Uri, d: Diagnostic[]) => diagnosticsStore.set(uri.toString(), d),
    delete: (uri: Uri) => diagnosticsStore.delete(uri.toString()),
    dispose() {},
  }),
  createLanguageStatusItem: () => ({ dispose() {} }),
  getDiagnostics: (uri: Uri) => diagnosticsStore.get(uri.toString()) ?? [],
  registerCodeActionsProvider: reg("codeActions"),
  registerDocumentSymbolProvider: reg("documentSymbols"),
  registerWorkspaceSymbolProvider: reg("workspaceSymbols"),
  registerHoverProvider: reg("hover"),
  registerDefinitionProvider: reg("definition"),
  registerReferenceProvider: reg("references"),
  registerDocumentHighlightProvider: reg("highlight"),
  registerCompletionItemProvider: reg("completion"),
  registerFoldingRangeProvider: reg("folding"),
  registerDocumentFormattingEditProvider: reg("formatting"),
  registerDocumentRangeFormattingEditProvider: reg("rangeFormatting"),
};
const noopEvent = () => ({ dispose() {} });
export const workspace = {
  textDocuments: openDocs,
  getConfiguration: () => ({ get: (k: string, d: any) => (k in config ? config[k] : d) }),
  findFiles: async () => openDocs.map((d) => d.uri),
  openTextDocument: async (u: any) => openDocs.find((d) => d.uri.toString() === u.toString()) ?? new FakeDocument(Uri.parse("untitled:x"), u?.content ?? ""),
  onDidOpenTextDocument: noopEvent, onDidChangeTextDocument: noopEvent, onDidCloseTextDocument: noopEvent,
  onDidChangeConfiguration: noopEvent,
  createFileSystemWatcher: () => ({ onDidCreate: noopEvent, onDidChange: noopEvent, onDidDelete: noopEvent, dispose() {} }),
  registerTextDocumentContentProvider: reg("content"),
  asRelativePath: (u: Uri) => u.path,
};
export const window = { onDidChangeActiveTextEditor: noopEvent, showWarningMessage: async () => undefined, showErrorMessage: async () => undefined, activeTextEditor: undefined };
const commandsNs = { registerCommand: (id: string, fn: any) => { commandRegistry[id] = fn; return { dispose() {} }; }, executeCommand: async () => undefined };
export { commandsNs as commands };
export function setConfig(k: string, v: any) { config[k] = v; }
