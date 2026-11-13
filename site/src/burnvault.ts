// Burn vault: shows the demonstration vault and its burns, and reads the live state from Solana.
import { PROGRAM, DEMO, VAULTS } from "./burn-data";
import { esc, landed } from "./shared";
import { wireFooter } from "./foot";
import { decodeVault, potOf, sol, coins } from "./burn";
import { accountData, tokenSupply } from "./solana-call";

const RPC = "https://api.devnet.solana.com";
const $ = (id: string) => document.getElementById(id)!;
const explorer = (kind: string, id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
const n = (v: number) => v.toLocaleString("en-GB");
let reads = 0;

function stats(o: { burned: bigint; paid: bigint; burns: number; pot: bigint | null; decimals: number }) {
  $("s-burned").textContent = coins(o.burned, o.decimals);
  $("s-paid").textContent = sol(o.paid);
  $("s-burns").textContent = n(o.burns);
  $("s-pot").textContent = o.pot === null ? "–" : sol(o.pot, 6);
}

if (!DEMO) $("none").hidden = false;
else {
  const dec = DEMO.decimals;
  $("card").hidden = false;
  $("v-title").textContent = "The demonstration vault";
  $("v-sub").textContent = "a made-up coin on devnet; its fees are sent by our own run";
  $("v-rule").innerHTML = `The rule: burn <b>${coins(BigInt(DEMO.threshold), dec)}</b> coins, take everything in the vault.`;
  stats({ burned: BigInt(DEMO.totals?.burned ?? 0), paid: BigInt(DEMO.totals?.paid ?? 0), burns: DEMO.totals?.burns ?? 0, pot: null, decimals: dec });
  const rows: [string, string][] = [
    ["Vault", `<a href="${explorer("address", DEMO.vault)}" rel="noopener">${esc(DEMO.vault)}</a>`],
    ["Coin", `<a href="${explorer("address", DEMO.mint)}" rel="noopener">${esc(DEMO.mint)}</a>`],
    ["Opened", `<a href="${explorer("tx", DEMO.opened)}" rel="noopener">rule accepted by Phil's server</a>`],
  ];
  if (DEMO.totals?.supply) rows.push(["Supply left", `<span id="v-supply">${coins(BigInt(DEMO.totals.supply), dec)}</span> of 1,000,000,000`]);
  $("v-facts").innerHTML = rows.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join("");

  const history = [...(DEMO.history ?? [])].reverse();
  if (history.length) {
    $("history-wrap").hidden = false;
    $("history-lead").textContent = `Each run sends a small amount of devnet SOL to the vault as stand-in fees, then does what a trader would: burns the threshold and takes the pot. On a real coin the trader would have bought those coins on the market first.`;
    $("history").innerHTML = history.map((h: any) => `<li><time>${esc(h.day)}</time><span>burned <b>${coins(BigInt(h.burned), dec)}</b> coins for ${sol(BigInt(h.paid), 6)} SOL of fees</span><a href="${explorer("tx", h.burn)}" rel="noopener">transaction</a></li>`).join("");
  }

  $("refresh").addEventListener("click", async () => {
    const b = $("refresh") as HTMLButtonElement;
    b.classList.add("busy"); b.textContent = "Reading Solana…";
    let text: string;
    try {
      const seen = await accountData(RPC, DEMO.vault);
      const v = seen && decodeVault(seen.data);
      if (!seen || !v) text = "The vault is not on devnet right now. Devnet may have been reset.";
      else if (seen.owner !== DEMO.program) text = "That account does not belong to the vault program. Do not trust these numbers.";
      else {
        stats({ burned: v.totalBurned, paid: v.totalPaid, burns: v.burns, pot: potOf(BigInt(seen.lamports), v), decimals: dec });
        try { const s = await tokenSupply(RPC, DEMO.mint); const el = document.getElementById("v-supply"); if (el) el.textContent = coins(s.amount, s.decimals); } catch { /* the supply line keeps its recorded value */ }
        text = `Read from Solana just now, at slot ${n(seen.slot)} (read ${++reads})`;
      }
    } catch (e: any) { text = /answered|rate/.test(String(e?.message)) ? e.message : "Could not reach Solana devnet from this browser. Check the connection and try again."; }
    b.classList.remove("busy"); b.textContent = "Read it again";
    landed($("card"), $("refresh-note"), text);
  });
}

const others = VAULTS.filter((v) => !v.demo);
if (others.length) {
  $("others-wrap").hidden = false;
  $("others").innerHTML = others.map((v) => `<li><b>${esc(v.label || "Unnamed")}</b>: burn ${coins(BigInt(v.threshold), v.decimals)} of <code>${esc(v.mint)}</code> to take the fees.<br>Point fees at <a href="${explorer("address", v.vault)}" rel="noopener">${esc(v.vault)}</a></li>`).join("");
}
const facts: [string, string][] = [];
if (PROGRAM?.programId) facts.push(["Program", `<a href="${explorer("address", PROGRAM.programId)}" rel="noopener">${esc(PROGRAM.programId)}</a>`]);
if (PROGRAM?.programBytes) facts.push(["Size", `${n(PROGRAM.programBytes)} bytes`]);
if (PROGRAM?.selftest?.burnUnits) facts.push(["Cost of a burn", `${n(PROGRAM.selftest.burnUnits)} compute units of 200,000 allowed, including the token program's burn`]);
facts.push(["Instructions", "two: open a vault, and burn. There is no third"]);
facts.push(["Interface", "Phil's own checker accepts the vault's runtime against all 46 signatures Phil's LLVM declares"]);
$("p-facts").innerHTML = facts.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join("");
wireFooter();
