// OTC desk page: runs otc/otc.phil in the simulator with the terms from the form.
import { OTC_SOURCE } from "../../core/src/sim/otc-source";
import { buildAst } from "../../core/src/sim/ast";
import { explore } from "../../core/src/sim/explore";
import { runPhil, highlightHtml, KIND_TITLE, esc } from "./shared";
import { wireFooter } from "./foot";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const IDS: Record<string, string> = { selling: "t-selling", unit_price: "t-price", want: "t-want", wallet: "t-wallet", fee_bps: "t-fee", expires_after: "t-expires", cancel_after: "t-cancel" };
const field = (id: string) => $<HTMLInputElement>(id).value.trim();
const terms = () => Object.fromEntries(Object.entries(IDS).map(([k, id]) => [k, field(id)])) as Record<string, string>;
const NAMES: Record<string, string> = { maker: "Maker", desk: "Desk", taker: "Taker" };
const who = (p: string) => NAMES[p] ?? p;
const PRESETS: Record<string, Record<string, string>> = {
  sold: { selling: "1000", unit_price: "2", want: "400", wallet: "5000", fee_bps: "100", expires_after: "10", cancel_after: "0" },
  dry: { selling: "1000", unit_price: "2", want: "400", wallet: "1000", fee_bps: "100", expires_after: "5", cancel_after: "0" },
  cancel: { selling: "1000", unit_price: "2", want: "400", wallet: "5000", fee_bps: "100", expires_after: "10", cancel_after: "1" },
  expire: { selling: "1000", unit_price: "2", want: "400", wallet: "5000", fee_bps: "100", expires_after: "2", cancel_after: "0" },
};

function feeNote(): void {
  const n = Number(field("t-fee"));
  $("fee-pct").textContent = Number.isFinite(n) && field("t-fee") !== "" ? `${(n / 100).toFixed(2)}% · at most 1000` : "";
}

const CHOICE: Record<string, string> = {
  Pass: "Taker passes this round",
  Filled: "Desk reports the fill to the maker",
  Keep: "Maker keeps the listing open",
  Cancel: "Maker cancels the rest of the listing",
  Expired: "Desk tells the maker the listing has expired",
  SoldOut: "Desk tells the maker the listing is sold out",
  Closed: "Desk closes the deal with the taker",
};
const coinOf = (text: string) => { const m = /^(Token|Cash) \{ amount = (\d+) \}$/.exec(text); return m ? { kind: m[1] === "Token" ? "tokens" : "cash", amount: BigInt(m[2]) } : undefined; };
const MAX_STEPS = 80;

function trade(): void {
  const t = terms();
  const o = runPhil(OTC_SOURCE, t);
  const box = $("result");
  if (!o.ok) {
    const refused = o.kind === "contract" || o.kind === "runtime" || o.kind === "arithmetic" || o.kind === "wiring";
    box.innerHTML = `<div class="verdict bad"><b>${refused ? "The desk refuses these terms" : esc(KIND_TITLE[o.kind] ?? o.kind)}</b>${esc(o.message)}<div class="muted">The program stopped. In Phil a broken promise halts everything rather than leaving a trade half done.</div></div>`;
    return;
  }
  // Follow every coin through the trace to get each party's final holdings.
  const hold: Record<string, { tokens: bigint; cash: bigint }> = { maker: { tokens: BigInt(t.selling), cash: 0n }, desk: { tokens: 0n, cash: 0n }, taker: { tokens: 0n, cash: BigInt(t.wallet) } };
  const start = { maker: { ...hold.maker }, desk: { ...hold.desk }, taker: { ...hold.taker } } as typeof hold;
  const steps: string[] = [];
  let fills = 0, round = 0, ending = "", pendingQty: string | undefined;
  for (const e of o.result!.trace) {
    if (e.kind === "select") {
      if (e.label === "Open") { round++; steps.push(`<li class="round">Round ${round}</li>`); continue; }
      if (e.label === "Buy") continue;
      if (e.label === "Filled") fills++;
      if (e.label === "SoldOut" || e.label === "Expired" || e.label === "Cancel") ending = e.label;
      steps.push(`<li><span>${CHOICE[e.label] ?? `${who(e.from)} chooses ${esc(e.label)}`}</span></li>`);
    } else if (e.kind === "message") {
      const c = coinOf(e.text);
      if (c) {
        const k = c.kind as "tokens" | "cash";
        if (hold[e.from] && hold[e.to]) { hold[e.from][k] -= c.amount; hold[e.to][k] += c.amount; }
        steps.push(`<li><span>${who(e.from)} hands ${who(e.to)} <span class="coin">${c.amount} ${c.kind}</span></span></li>`);
      } else if (e.from === "maker") steps.push(`<li><span>Maker sets the price: ${esc(e.text)} per token</span></li>`);
      else if (e.from === "desk" && pendingQty === undefined) pendingQty = e.text;
      else if (e.from === "desk") { steps.push(`<li><span>Desk quotes ${esc(pendingQty!)} tokens at ${esc(e.text)} each</span></li>`); pendingQty = undefined; }
      else steps.push(`<li><span>Taker asks for ${esc(e.text)} tokens</span></li>`);
    }
  }
  // The desk turns its fee coins into a number it hands back; count that as its cash.
  const fee = BigInt(o.returns.find((r) => r.proc === "desk")?.text ?? "0");
  const sold = start.maker.tokens - hold.maker.tokens - hold.desk.tokens;
  const title = ending === "SoldOut" ? (sold > 0n ? "Sold out" : "Nothing was listed")
    : ending === "Cancel" ? "Cancelled by the maker"
    : fills > 0 ? "Expired part-filled" : "Expired with no fills";
  const tone = ending === "SoldOut" && sold > 0n ? "good" : "mid";
  const back = hold.maker.tokens;
  const summary = `${fills} fill${fills === 1 ? "" : "s"} over ${round} round${round === 1 ? "" : "s"}. The taker bought ${hold.taker.tokens} tokens for ${start.taker.cash - hold.taker.cash}. The maker received ${hold.maker.cash} after ${fee} in desk fees${back > 0n ? `, and got ${back} unsold tokens back` : ""}.`;
  const row = (label: string, before: bigint, after: bigint) => `<dt>${label}</dt><dd>${before !== after ? `<span class="was">${before}</span>` : ""}${after}</dd>`;
  const party = (name: string, id: string, cash: bigint) => `<div class="party"><h3>${name}</h3><dl>${row("tokens", start[id].tokens, hold[id].tokens)}${row("cash", start[id].cash, cash)}</dl></div>`;
  const shown = steps.slice(0, MAX_STEPS);
  box.innerHTML = `<div class="verdict ${tone}"><b>${title}</b>${summary}</div>`
    + `<div class="parties">${party("Maker", "maker", hold.maker.cash)}${party("Desk", "desk", fee)}${party("Taker", "taker", hold.taker.cash)}</div>`
    + `<ol class="steps">${shown.join("")}${steps.length > MAX_STEPS ? `<li class="round">${steps.length - MAX_STEPS} more steps not shown. Open the program in the playground to replay all of them.</li>` : ""}</ol>`;
}

function hunt(): void {
  const out = $("hunt-out");
  out.textContent = "Trying boundary amounts, different schedules and both taker choices…";
  setTimeout(() => {
    try {
      const h = explore(buildAst(OTC_SOURCE), terms(), { budgetMs: 2500 });
      out.innerHTML = h.findings.length
        ? `<b>Found ${h.findings.length} failure${h.findings.length === 1 ? "" : "s"} in ${h.runs} runs.</b> ${esc(h.findings[0].message)} (${esc(h.findings[0].inputs.map((i) => `${i.name} = ${i.text}`).join(", "))})`
        : `<b>${h.runs} runs, no failure found.</b> No run lost a coin, copied one, broke a promise or got stuck. This is a bounded search, not a proof.`;
    } catch (e) { out.textContent = "The search could not run: " + String((e as Error).message ?? e); }
  }, 30);
}

$("trade").addEventListener("click", trade);
$("hunt").addEventListener("click", hunt);
$("t-fee").addEventListener("input", feeNote);
document.querySelectorAll<HTMLElement>("[data-preset]").forEach((b) => b.addEventListener("click", () => {
  for (const [k, v] of Object.entries(PRESETS[b.dataset.preset!])) $<HTMLInputElement>(IDS[k]).value = v;
  feeNote();
  trade();
}));
$("src").innerHTML = highlightHtml(OTC_SOURCE);
feeNote();
trade();
wireFooter();
