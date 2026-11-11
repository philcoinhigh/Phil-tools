import * as fs from "fs";
import * as path from "path";
import * as vsctm from "vscode-textmate";
import * as oniguruma from "vscode-oniguruma";

export async function loadGrammar(): Promise<vsctm.IGrammar> {
  const wasm = fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer;
  await oniguruma.loadWASM(wasm);
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({ createOnigScanner: (p: string[]) => new oniguruma.OnigScanner(p), createOnigString: (s: string) => new oniguruma.OnigString(s) }),
    loadGrammar: async () => vsctm.parseRawGrammar(fs.readFileSync(path.join(__dirname, "../vscode/syntaxes/phil.tmLanguage.json"), "utf8"), "phil.tmLanguage.json"),
  });
  return (await registry.loadGrammar("source.phil"))!;
}

export function tokenize(grammar: vsctm.IGrammar, src: string) {
  let state = vsctm.INITIAL;
  const out: { line: number; text: string; scopes: string[] }[] = [];
  src.split(/\r?\n/).forEach((line, i) => {
    const r = grammar.tokenizeLine(line, state);
    for (const t of r.tokens) out.push({ line: i + 1, text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes });
    state = r.ruleStack;
  });
  return out;
}

if (process.argv[1]?.endsWith("tm.js")) (async () => {
  const g = await loadGrammar();
  const src = fs.readFileSync(process.argv[2], "utf8");
  for (const t of tokenize(g, src)) if (t.text.trim()) console.log(t.line, JSON.stringify(t.text), t.scopes.slice(1).join(" "));
})();
