// "Phil on Solana": renders onchain/deployment.json.
import d from "../../onchain/deployment.json";
import { PHIL, LLVM, ENTRY } from "./onchain-source";
import { highlightHtml, esc } from "./shared";
import { wireFooter } from "./foot";

const $ = (id: string) => document.getElementById(id)!;
const run = d.devnet.ok ? d.devnet.run : d.local.run;
const live = d.devnet.ok;
const cluster = "?cluster=devnet";
const explorer = (kind: string, id: string) => `https://explorer.solana.com/${kind}/${id}${cluster}`;
$("net").textContent = live ? "Solana devnet · live" : "Proven on a local Solana validator · devnet deployment pending";
$("facts").innerHTML = [
  [String(run?.returned ?? "–"), "what the Phil program returned"],
  [String(run?.unitsConsumed ?? "–"), "compute units used, of 200,000 allowed"],
  [`${d.programBytes.toLocaleString("en-GB")}`, "bytes: the size of the whole program"],
].map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
const rows: [string, string][] = [];
if (live && d.devnet.programId) rows.push(["Program", `<a href="${explorer("address", d.devnet.programId)}" rel="noopener">${esc(d.devnet.programId)}</a>`]);
if (live && run?.signature) rows.push(["Transaction", `<a href="${explorer("tx", run.signature)}" rel="noopener">${esc(run.signature)}</a>`]);
if (run?.slot) rows.push(["Slot", `<code>${run.slot.toLocaleString("en-GB")}</code>`]);
rows.push(["Phil commit", `<a href="https://github.com/abiggerhammer/phil/commit/${esc(d.philCommit)}" rel="noopener">${esc(d.philCommit.slice(0, 10))}</a>`]);
rows.push(["Recorded", `<code>${esc(d.day)} · ${esc(d.solana.split(" (")[0])}</code>`]);
$("addr").innerHTML = rows.map(([k, v]) => `<li><span>${k}</span>${v}</li>`).join("");
$("log").innerHTML = (run?.logs ?? []).map((l) => (/Phil main returned|0x2a|success/.test(l) ? `<b>${esc(l)}</b>` : esc(l))).join("\n");
$("src-phil").innerHTML = highlightHtml(PHIL);
$("src-ll").textContent = LLVM.trim();
$("src-c").textContent = ENTRY.trim();
$("bytes").textContent = d.programBytes.toLocaleString("en-GB");
wireFooter();
