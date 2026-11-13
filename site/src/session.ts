// "Phil at both ends": Phil's emitted client runs here, Phil's emitted server runs on Solana.
import { CLIENT_WASM, SESSION } from "./session-data";
import { PROGRAM } from "./giveaway-data";
import { esc, landed } from "./shared";
import { wireFooter } from "./foot";
import { utf8, concat } from "./draw";
import { runClient, hopeful, answersFrom, serverSteps, timeline, Session, Ending, OP_NOTE } from "./phil-client";
import { buildCall, simulate } from "./solana-call";

const RPC = "https://api.devnet.solana.com";
const $ = (id: string) => document.getElementById(id)!;
const explorer = (kind: string, id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
const wasmBytes = Uint8Array.from(atob(CLIENT_WASM), (c) => c.charCodeAt(0));
$("wasm-size").textContent = `${wasmBytes.length.toLocaleString("en-GB")} bytes.`;
let mode = "normal", runs = 0;
let module: Promise<WebAssembly.Module> | null = null;

document.querySelectorAll<HTMLButtonElement>("#modes button").forEach((b) => b.addEventListener("click", () => {
  mode = b.dataset.mode!;
  document.querySelectorAll("#modes button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
}));

const ENDING: Record<Ending, [string, string]> = {
  "accepted": ["good", "Session complete. Phil's server accepted exactly what Phil's client sent."],
  "rejected": ["bad", "Phil's server rejected the upload: the bytes that arrived are not the ones the client declared. Phil's client was told, and stopped."],
  "cancelled": ["", "The client cancelled after the server agreed to proceed. No payload was sent, and the server stopped cleanly."],
  "refused by policy": ["bad", "Phil's server refused the upload by policy before any payload was read."],
  "no common version": ["bad", "The two sides have no protocol version in common. The server said so, and the client released its payload and stopped."],
  "version check failed": ["bad", "The client was offered a version it never asked for, and stopped."],
  "no answer": ["bad", "The server could not make sense of what arrived, so the client was left without an answer."],
};

$("go").addEventListener("click", async () => {
  const b = $("go") as HTMLButtonElement;
  const done = (cls: string, text: string, items: string, note: string) => {
    $("verdict").className = `verdict ${cls}`; $("verdict").textContent = text; $("talk").innerHTML = items; $("out").hidden = false;
    b.classList.remove("busy"); b.textContent = "Run it again";
    landed($("out"), $("go-note"), note);
  };
  b.classList.add("busy"); b.textContent = "Phil's client is running…";
  try {
    module ??= WebAssembly.compile(wasmBytes);
    const m = await module;
    const s: Session = { payload: utf8(($("msg") as HTMLTextAreaElement).value), versions: mode === "version" ? [7] : [1], cancel: mode === "cancel" };
    const first = await runClient(m, s, hopeful(s));
    const wire = first.wire.slice();
    if (mode === "tamper" && wire.length) wire[wire.length - 1] ^= 1;
    b.textContent = "Phil's server is running on Solana…";
    const sim = await simulate(RPC, buildCall(PROGRAM.wallet, PROGRAM.programId, [], concat(Uint8Array.of(OP_NOTE), wire)));
    if (!sim.logs.length) return done("bad", sim.error ?? "Solana did not answer.", "", "No answer from Solana");
    const second = await runClient(m, s, answersFrom(sim.logs, sim.programError));
    const lines = timeline(second.steps, serverSteps(sim.logs));
    const firstServer = lines.findIndex((l) => l.side === "server");
    const items = lines.map((l, i) => (i === firstServer ? `<li class="wire">${wire.length} bytes cross to Solana${mode === "tamper" ? ", with one changed on the way" : ""}</li>` : "")
      + `<li class="${l.side}${l.sends ? " sends" : ""}${/ACCEPTED|is told: accepted|records the upload/.test(l.text) ? " good" : /REJECTED|is told: rejected|refused|no version|not recognized|never answered|no protocol version/.test(l.text) ? " bad" : ""}"><small>${l.side === "client" ? "Phil's client · this page" : "Phil's server · Solana"}</small>${esc(l.text)}</li>`).join("");
    const [cls, text] = ENDING[second.ending];
    done(cls, text, items, `Ran just now: ${sim.units ?? "?"} compute units on Solana, slot ${(sim.slot ?? 0).toLocaleString("en-GB")} (run ${++runs})`);
  } catch (e: any) {
    done("bad", /WebAssembly/.test(String(e)) ? "This browser could not run the client." : String(e?.message ?? e), "", "Stopped");
  }
});

if (SESSION?.signature) {
  $("recorded-wrap").hidden = false;
  $("recorded").innerHTML = ([
    ["Transaction", `<a href="${explorer("tx", SESSION.signature)}" rel="noopener">${esc(SESSION.signature)}</a>`],
    ["What was uploaded", `<code>${esc(SESSION.message)}</code>`],
    ["Size", `${SESSION.bytes} bytes of instruction data, all produced by Phil's client`],
    ["Cost", `${(SESSION.units ?? 0).toLocaleString("en-GB")} compute units of 200,000 allowed`],
    ["Outcome", `accepted at slot ${(SESSION.slot ?? 0).toLocaleString("en-GB")} on ${esc(SESSION.day)}`],
    ["Program", `<a href="${explorer("address", SESSION.program)}" rel="noopener">${esc(SESSION.program)}</a>`],
  ] as [string, string][]).map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join("");
}
wireFooter();
