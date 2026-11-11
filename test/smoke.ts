// Activates the bundled extension against test/fake-vscode.ts and calls every provider.
import * as vscode from "vscode";
import * as fake from "./fake-vscode";
import { activate } from "../vscode/src/extension";

let fails = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => { if (!ok) { fails++; console.log("FAIL", name, detail); } else console.log("ok  ", name); };

(async () => {
  const src = [
    "module demo.ping;",
    "// A ping protocol",
    "protocol Ping {",
    "  role Client = send (x : U8) then end Done;",
    "  role Server = receive (x : U8) then end Done;",
    "}",
    "component ClientWorker(endpoint : Client[Ping], payload : U8) {",
    "  let done = send payload on endpoint;",
    "  close done",
    "}",
    "architecture LocalPing {",
    "  instance client = ClientWorker;",
    "}",
  ].join("\n");
  const doc = new fake.FakeDocument(fake.Uri.file("/w/ping.phil"), src);
  fake.openDocs.push(doc);
  activate({ subscriptions: [] } as any);
  await new Promise((r) => setTimeout(r, 20));

  const diags = fake.diagnosticsStore.get(doc.uri.toString()) ?? [];
  check("diagnostic for missing ;", diags.length === 1 && diags[0].code === "PHIL-P007" && diags[0].range.start.line === 8, diags.map((d) => [d.code, d.message, d.range.start]));

  const [codeActionArgs] = fake.registered.codeActions;
  const actions = codeActionArgs[1].provideCodeActions(doc, diags[0].range, { diagnostics: diags });
  check("quick fix offered", actions[0]?.title === "Insert `;`" && actions[0].edit.edits[0].text === ";", actions.map((a: any) => a.title));
  check("explain action offered", actions.some((a: any) => a.title === "Explain PHIL-P007"));

  const symbols = fake.registered.documentSymbols[0][1].provideDocumentSymbols(doc);
  check("outline top level", JSON.stringify(symbols.map((s: any) => s.name)) === JSON.stringify(["demo.ping", "Ping", "ClientWorker", "LocalPing"]), symbols.map((s: any) => s.name));
  const worker = symbols.find((s: any) => s.name === "ClientWorker");
  check("outline children", worker && worker.children.map((c: any) => c.name).join(",") === "endpoint,payload,done", worker?.children.map((c: any) => c.name));

  const hover = fake.registered.hover[0][1];
  const h1 = hover.provideHover(doc, new fake.Position(2, 2)); // "protocol"
  check("keyword hover", h1 && h1.contents.some((m: any) => m.value.includes("two-role protocol")), h1?.contents.map((m: any) => m.value));
  const h2 = hover.provideHover(doc, new fake.Position(3, 26)); // U8
  check("integer type hover", h2 && h2.contents[0].value.includes("unsigned 8-bit"), h2?.contents);
  const h3 = hover.provideHover(doc, new fake.Position(11, 22)); // ClientWorker reference
  check("declaration hover", h3 && h3.contents[0].value.includes("component ClientWorker"), h3?.contents.map((m: any) => m.value));
  const h4 = hover.provideHover(doc, new fake.Position(8, 12)); // on the diagnostic
  check("error code hover", h4 && h4.contents.some((m: any) => m.value.includes("PHIL-P007 — Missing semicolon")), h4?.contents.map((m: any) => m.value));

  const def = fake.registered.definition[0][1];
  const d1 = await def.provideDefinition(doc, new fake.Position(11, 22));
  check("go to definition (top-level)", d1?.[0]?.range.start.line === 6, d1);
  const d2 = await def.provideDefinition(doc, new fake.Position(8, 9)); // `done`
  check("go to definition (let binding)", d2?.[0]?.range.start.line === 7, d2);
  const d3 = await def.provideDefinition(doc, new fake.Position(7, 19)); // `payload` param
  check("go to definition (parameter)", d3?.[0]?.range.start.line === 6, d3);

  const refs = await fake.registered.references[0][1].provideReferences(doc, new fake.Position(7, 6));
  check("find references", refs.length === 2, refs.length);
  const hl = fake.registered.highlight[0][1].provideDocumentHighlights(doc, new fake.Position(7, 30));
  check("document highlight", hl.length === 2, hl.length);

  const comp = fake.registered.completion[0][1].provideCompletionItems(doc, new fake.Position(8, 2));
  check("completion has keywords and names", comp.some((c: any) => c.label === "receive_exact") && comp.some((c: any) => c.label === "ClientWorker"), comp.length);
  const inComment = fake.registered.completion[0][1].provideCompletionItems(doc, new fake.Position(1, 8));
  check("no completion in comments", inComment.length === 0, inComment.length);

  const folds = fake.registered.folding[0][1].provideFoldingRanges(doc);
  check("folding ranges", folds.some((f: any) => f.start === 2 && f.end === 4) && folds.some((f: any) => f.start === 6), folds);

  doc.setText("component A {\nlet x = 1;\n   return x;\n}\n");
  const edits = fake.registered.formatting[0][1].provideDocumentFormattingEdits(doc, { tabSize: 4, insertSpaces: true });
  check("formatting edits", edits.length === 2 && edits[0].newText === "    let x = 1;" && edits[1].newText === "    return x;", edits.map((e: any) => e.newText));

  const ws = fake.registered.workspaceSymbols[0][0].provideWorkspaceSymbols("ping");
  check("workspace symbols", ws.some((s: any) => s.name === "Ping"), ws.map((s: any) => s.name));

  check("commands registered", "phil.emitLlvm" in fake.commandRegistry && "phil.showErrorCodes" in fake.commandRegistry);
  const md = fake.registered.content[0][1].provideTextDocumentContent();
  check("error code reference renders", md.includes("## PHIL-P007") && md.includes("## PHIL-L006"));
  void vscode;
  console.log(fails ? `${fails} smoke failures` : "smoke OK");
  process.exit(fails ? 1 : 0);
})();
