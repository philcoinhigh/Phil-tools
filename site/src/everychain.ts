// "Same Phil, every chain": one upload, asked of every machine that runs the same Phil program.
// Every question is read-only: a simulation on Solana, an eth_call on the EVM chains, and the
// RISC-V image itself run in this browser. Nothing is signed and nothing is paid.
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { PROGRAM, DEPLOYMENTS, LOCAL, NETWORKS, IMAGE, SELECTORS } from "./chains-data";
import { esc } from "./shared";
import { wireFooter } from "./foot";
import { hex, sha256 } from "./draw";
import { chain, short } from "./wallet";
import { runImage } from "./rv64";
import { noteData, explainCode } from "./chains";

const $ = (id: string) => document.getElementById(id)!;
const SOL = chain("devnet", "https://api.devnet.solana.com");
const image = IMAGE ? Uint8Array.from(atob(IMAGE), (c) => c.charCodeAt(0)) : null;
interface Answer { code: number | null; cost: string; note?: string }
interface Machine { id: string; name: string; how: string; where: string; ask: ((data: Uint8Array) => Promise<Answer>) | null; waiting?: string }

// ---- the EVM side, by hand: one function call in, three values out ----
const word = (n: number) => n.toString(16).padStart(64, "0");
const callData = (data: Uint8Array) => SELECTORS.run + word(32) + word(data.length) + hex(data).padEnd(Math.ceil(data.length / 32) * 64, "0");
async function ethCall(rpcs: string[], to: string, data: string): Promise<string> {
  let last: any = new Error("no node answered");
  for (const url of rpcs) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) });
      if (!res.ok) throw new Error(`the node answered ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(String(j.error.message ?? "the node refused the call"));
      return String(j.result);
    } catch (e) { last = e; }
  }
  throw last;
}
function evmMachine(n: any): Machine {
  const d = DEPLOYMENTS?.[n.id], rpcs: string[] = [...new Set([d?.rpc, ...n.rpc].filter(Boolean))];
  const base = { id: n.id, name: n.name, how: "RISC-V image, run by an interpreter contract" };
  if (!d?.address) return { ...base, where: "", ask: null, waiting: "Not deployed yet: its test key is waiting for test coins." };
  return { ...base, where: `<a href="${esc(n.explorer)}/address/${esc(d.address)}" rel="noopener">${esc(short(d.address))}</a>`, ask: async (data) => {
    const out = (await ethCall(rpcs, d.address, callData(data))).slice(2);
    if (out.length < 192) throw new Error("the contract did not answer");
    const code = Number(BigInt("0x" + out.slice(0, 64))), steps = Number(BigInt("0x" + out.slice(64, 128)));
    // Is it the image this page was built with? Asked of the contract itself.
    let note = "";
    try { const held = (await ethCall(rpcs, d.address, SELECTORS.imageSha256)).slice(2); note = image && held === hex(sha256(image)) ? "the contract holds the same image as this page" : "the contract holds a different build of the image"; } catch { /* the answer stands without it */ }
    return { code, cost: `${steps.toLocaleString("en-GB")} RISC-V instructions on chain`, note };
  } };
}
const machines: Machine[] = [
  { id: "browser", name: "This browser", how: "RISC-V image, run here", where: "", waiting: image ? undefined : "The image has not been built yet.",
    ask: image ? async (data) => { const r = runImage(image, data); $("log").textContent = r.logs.join("\n") || "(nothing was logged)"; return { code: r.code, cost: `${r.steps.toLocaleString("en-GB")} RISC-V instructions` }; } : null },
  { id: "solana", name: "Solana devnet", how: "native Solana program", where: PROGRAM?.programId ? `<a href="${SOL.explorer("address", PROGRAM.programId)}" rel="noopener">${esc(short(PROGRAM.programId))}</a>` : "",
    waiting: PROGRAM?.programId ? undefined : "Not deployed yet.",
    ask: PROGRAM?.programId ? async (data) => {
      const tx = new Transaction().add(new TransactionInstruction({ programId: new PublicKey(PROGRAM.programId), keys: [], data: Buffer.from(data) }));
      tx.feePayer = new PublicKey(PROGRAM.wallet); tx.recentBlockhash = "11111111111111111111111111111111";
      let s = ""; for (const b of tx.serialize({ requireAllSignatures: false, verifySignatures: false })) s += String.fromCharCode(b);
      const r = (await SOL.rpc("simulateTransaction", [btoa(s), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }])).value;
      const custom = r.err?.InstructionError?.[1]?.Custom;
      if (r.err && typeof custom !== "number") throw new Error("the simulation failed before the program ran");
      return { code: r.err ? custom : 0, cost: r.unitsConsumed ? `${Number(r.unitsConsumed).toLocaleString("en-GB")} compute units` : "" };
    } : null },
  ...NETWORKS.map(evmMachine),
];

function draw(): void {
  $("machines").innerHTML = machines.map((m) => `<div class="machine" id="m-${m.id}"><b>${esc(m.name)}</b><span class="verdict" id="v-${m.id}">${m.ask ? "not asked yet" : "not live yet"}</span><small id="s-${m.id}">${esc(m.how)}${m.where ? " · " + m.where : ""}${m.waiting ? " · " + esc(m.waiting) : ""}</small></div>`).join("");
}
draw();
$("ask").addEventListener("click", async () => {
  const b = $("ask") as HTMLButtonElement, text = ($("note") as HTMLInputElement).value, out = $("answer");
  const data = noteData(text);
  if (($("tamper") as HTMLInputElement).checked) data[data.length - 1] ^= 1;
  b.disabled = true; b.classList.add("busy"); out.hidden = true;
  $("ask-note").textContent = `${data.length} bytes, the same for every machine`;
  const live = machines.filter((m) => m.ask);
  for (const m of live) { const v = $("v-" + m.id); v.className = "verdict"; v.textContent = "asking…"; }
  const codes: (number | null)[] = await Promise.all(live.map(async (m) => {
    const v = $("v-" + m.id), s = $("s-" + m.id), about = `${esc(m.how)}${m.where ? " · " + m.where : ""}`;
    try {
      const a = await m.ask!(data);
      v.className = "verdict " + (a.code === 0 ? "yes" : "no"); v.textContent = a.code === 0 ? "ACCEPTED" : `refused · ${a.code}`;
      s.innerHTML = `${about}${a.cost ? " · " + esc(a.cost) : ""}${a.note ? " · " + esc(a.note) : ""}`;
      return a.code;
    } catch (e: any) { v.className = "verdict"; v.textContent = "no answer"; s.innerHTML = `${about} · ${esc(String(e?.message ?? e))}`; return null; }
  }));
  const got = codes.filter((c): c is number => c !== null), agree = got.every((c) => c === got[0]);
  out.hidden = false;
  if (!got.length) { out.className = "say bad"; out.textContent = "No machine answered. Check the connection and ask again."; }
  else if (!agree) { out.className = "say bad"; out.innerHTML = "<b>The machines disagree.</b> That should never happen: they run the same Phil code. Please tell us what you sent."; }
  else {
    out.className = "say " + (got[0] === 0 ? "good" : "");
    out.innerHTML = `<b>${got.length} machine${got.length === 1 ? "" : "s"}, one answer: ${esc(explainCode(got[0]))}.</b>${got.length < live.length ? " One did not answer just now; its node may be busy." : ""}${got[0] === 0 ? " Now tick the box to change one byte, and ask again." : ""}`;
  }
  b.disabled = false; b.classList.remove("busy");
});

// ---- the fingerprints ----
const facts: [string, string][] = [];
if (PROGRAM?.philCommit) facts.push(["Phil", `commit <a href="https://github.com/abiggerhammer/phil/commit/${esc(PROGRAM.philCommit)}" rel="noopener">${esc(String(PROGRAM.philCommit).slice(0, 10))}</a>, its emitted module: <code>${esc(String(PROGRAM.philModuleSha256 ?? "").slice(0, 16))}…</code>`]);
if (PROGRAM?.programId) facts.push(["Solana devnet", `<a href="${SOL.explorer("address", PROGRAM.programId)}" rel="noopener">${esc(PROGRAM.programId)}</a><br>program <code>${esc(String(PROGRAM.deployedSha256).slice(0, 16))}…</code>, ${Number(PROGRAM.programBytes).toLocaleString("en-GB")} bytes`]);
if (image) facts.push(["RISC-V image", `<code>${esc(hex(sha256(image)).slice(0, 16))}…</code>, ${image.length.toLocaleString("en-GB")} bytes. Every interpreter contract reports the hash of the image it holds.`]);
for (const n of NETWORKS) {
  const d = DEPLOYMENTS?.[n.id];
  facts.push([n.name, d?.address ? `<a href="${esc(n.explorer)}/address/${esc(d.address)}" rel="noopener">${esc(d.address)}</a>${d.submitTx ? `<br>last real upload: <a href="${esc(n.explorer)}/tx/${esc(d.submitTx)}" rel="noopener">${esc(short(d.submitTx))}</a>, ${Number(d.submitGas).toLocaleString("en-GB")} gas` : ""}` : "not deployed yet: its test key is waiting for test coins"]);
}
if (LOCAL?.runGas) { facts.push(["Proven before deploying", `the native build, the RISC-V image and the contract on a local Ethereum VM agree on every test upload, instruction count included`]); $("l-gas").textContent = Number(LOCAL.runGas).toLocaleString("en-GB"); }
facts.push(["Source", `<a href="https://github.com/philcoinhigh/Phil-tools/tree/main/chains">chains/</a>: runtime.c, PhilRiscV.sol, and their tests`]);
$("p-facts").innerHTML = facts.map(([k, x]) => `<li><span>${k}</span><span>${x}</span></li>`).join("");
wireFooter();
