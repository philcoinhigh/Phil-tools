// "Phil on Solana": renders onchain/deployment.json.
import d from "../../onchain/deployment.json";
import { PHIL, LLVM, ENTRY } from "./onchain-source";
import history from "../../onchain/history.json";
import { highlightHtml, esc, landed } from "./shared";
import { callProgram } from "./solana-call";
import { wireFooter } from "./foot";

const $ = (id: string) => document.getElementById(id)!;
const run = d.devnet.run ?? d.local.run;
const live = d.devnet.ok;
const deployed = !!d.devnet.run && !!d.devnet.programId;
const cluster = "?cluster=devnet";
const explorer = (kind: string, id: string) => `https://explorer.solana.com/${kind}/${id}${cluster}`;
$("net").textContent = live ? "Solana devnet · live" : d.devnet.run ? `Solana devnet · last seen ${d.devnet.runDay}` : "Proven on a local Solana validator · devnet deployment pending";
$("facts").innerHTML = [
  [String(run?.returned ?? "–"), "what the Phil program returned"],
  [String(run?.unitsConsumed ?? "–"), "compute units used, of 200,000 allowed"],
  [`${d.programBytes.toLocaleString("en-GB")}`, "bytes: the size of the whole program"],
].map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
const rows: [string, string][] = [];
if (deployed) rows.push(["Program", `<a href="${explorer("address", d.devnet.programId)}" rel="noopener">${esc(d.devnet.programId)}</a>`]);
if (deployed && run?.signature) rows.push(["Transaction", `<a href="${explorer("tx", run.signature)}" rel="noopener">${esc(run.signature)}</a>`]);
if (run?.slot) rows.push(["Slot", `<code>${run.slot.toLocaleString("en-GB")}</code>`]);
rows.push(["Phil commit", `<a href="https://github.com/abiggerhammer/phil/commit/${esc(d.philCommit)}" rel="noopener">${esc(d.philCommit.slice(0, 10))}</a>`]);
rows.push(["Recorded", `<code>${esc(d.devnet.runDay ?? d.day)} · ${esc(d.solana.split(" (")[0])}</code>`]);
$("addr").innerHTML = rows.map(([k, v]) => `<li><span>${k}</span>${v}</li>`).join("");
$("log").innerHTML = (run?.logs ?? []).map((l) => (/Phil main returned|0x2a|success/.test(l) ? `<b>${esc(l)}</b>` : esc(l))).join("\n");
$("src-phil").innerHTML = highlightHtml(PHIL);
$("src-ll").textContent = LLVM.trim();
$("src-c").textContent = ENTRY.trim();
$("bytes").textContent = d.programBytes.toLocaleString("en-GB");

// The nightly record.
const nights = [...(history as { day: string; phil: string; ok: boolean; returned: number | null; units: number | null; signature: string | null; redeployed: boolean }[])].reverse();
const passed = nights.filter((n) => n.ok).length;
$("night-lead").textContent = `Each night the program is rebuilt with the newest build of Phil's compiler, run on a local Solana validator, deployed again if the result changed or devnet was reset, and called. ${passed} of ${nights.length} recorded ${nights.length === 1 ? "night" : "nights"} passed.`;
$("nights").innerHTML = nights.map((n) => `<li><time>${esc(n.day)}</time><span>${n.ok ? `returned <b>${n.returned}</b> in ${n.units} units` : "devnet could not be reached or the call failed"} · Phil <code>${esc(n.phil)}</code>${n.redeployed ? " · deployed" : ""}</span>${n.ok && n.signature ? `<a href="${explorer("tx", n.signature)}" rel="noopener">transaction</a>` : `<span class="st bad">failed</span>`}</li>`).join("");

// Run it yourself.
const RPC = "https://api.devnet.solana.com";
let calls = 0;
const button = $("call") as HTMLButtonElement;
button.disabled = !d.devnet.programId || !d.devnet.wallet;
button.addEventListener("click", async () => {
  button.classList.add("busy"); button.textContent = "Asking Solana…"; $("call-note").textContent = "";
  const r = await callProgram(RPC, d.devnet.wallet, d.devnet.programId);
  button.classList.remove("busy"); button.textContent = "Call it again";
  const verdict = $("call-verdict");
  verdict.className = r.ok ? "verdict" : "verdict bad";
  verdict.innerHTML = r.ok
    ? `Solana ran Phil just now. It returned <b>${r.returned}</b> using ${r.units ?? "?"} compute units${r.slot ? `, at slot ${r.slot.toLocaleString("en-GB")}` : ""}.`
    : esc(r.error ?? "The call failed.");
  $("call-log").hidden = r.logs.length === 0;
  $("call-log").innerHTML = r.logs.map((l) => (/Phil main returned|0x2a|success/.test(l) ? `<b>${esc(l)}</b>` : esc(l))).join("\n");
  $("call-out").hidden = false;
  landed($("call-out"), $("call-note"), r.ok ? `Answered in ${r.ms} ms (call ${++calls})` : "No answer");
});
wireFooter();
