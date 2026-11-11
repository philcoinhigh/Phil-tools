// OTC desk page: runs otc/otc.phil in the simulator with the terms from the form.
import { OTC_SOURCE } from "../../core/src/sim/otc-source";
import { buildAst } from "../../core/src/sim/ast";
import { explore } from "../../core/src/sim/explore";
import { runPhil, highlightHtml, KIND_TITLE, esc } from "./shared";
import { wireFooter } from "./foot";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const field = (id: string) => $<HTMLInputElement>(id).value.trim();
const terms = () => ({ selling: field("t-selling"), price: field("t-price"), wallet: field("t-wallet"), fee_bps: field("t-fee") });
const NAMES: Record<string, string> = { maker: "Maker", desk: "Desk", taker: "Taker" };
const who = (p: string) => NAMES[p] ?? p;

function feeNote(): void {
  const n = Number(field("t-fee"));
  $("fee-pct").textContent = Number.isFinite(n) && field("t-fee") !== "" ? `${(n / 100).toFixed(2)}% · at most 1000` : "";
}

function describe(from: string, to: string, text: string): string {
  const coin = /^(Token|Cash) \{ amount = (\d+) \}$/.exec(text);
  if (coin) return `${who(from)} hands ${who(to)} <span class="coin">${coin[2]} ${coin[1] === "Token" ? "tokens" : "cash"}</span>`;
  const labels = PLAIN[`${from}>${to}`] ?? [];
  const n = (seen[`${from}>${to}`] = (seen[`${from}>${to}`] ?? 0) + 1);
  return `${who(from)} tells ${who(to)} ${labels[n - 1] ?? "a value"}: ${esc(text)}`;
}
const PLAIN: Record<string, string[]> = { "maker>desk": ["the asking price"], "desk>taker": ["how many tokens are on offer", "the asking price"] };
let seen: Record<string, number> = {};
const CHOICE: Record<string, string> = {
  Accept: "Taker accepts the price", Decline: "Taker declines",
  Filled: "Desk tells the maker the order was filled", Refunded: "Desk tells the maker the order was not filled",
};

function trade(): void {
  const t = terms();
  const o = runPhil(OTC_SOURCE, t);
  const box = $("result");
  if (!o.ok) {
    const bad = o.kind === "contract" || o.kind === "runtime" || o.kind === "arithmetic";
    box.innerHTML = `<div class="verdict bad"><b>${bad ? "The desk refuses these terms" : esc(KIND_TITLE[o.kind] ?? o.kind)}</b>${esc(o.message)}<div class="muted">Nothing moved. The program stopped before any coin changed hands${o.messages > 0 ? " for good" : ""}.</div></div>`;
    return;
  }
  const ret = (p: string) => BigInt(o.returns.find((r) => r.proc === p)?.text ?? "0");
  const events = o.result!.trace;
  const filled = events.some((e) => e.kind === "select" && e.label === "Accept");
  const selling = BigInt(t.selling), wallet = BigInt(t.wallet), price = BigInt(t.price);
  const row = (label: string, before: bigint, after: bigint) => `<dt>${label}</dt><dd>${before !== after ? `<span class="was">${before}</span>` : ""}${after}</dd>`;
  const party = (name: string, rows: string) => `<div class="party"><h3>${name}</h3><dl>${rows}</dl></div>`;
  seen = {};
  const steps = events.flatMap((e) => e.kind === "message" ? [describe(e.from, e.to, e.text)] : e.kind === "select" ? [CHOICE[e.label] ?? `${who(e.from)} chooses ${esc(e.label)}`] : []);
  box.innerHTML =
    `<div class="verdict ${filled ? "good" : "mid"}"><b>${filled ? "Filled" : "Not filled · tokens returned"}</b>${filled
      ? `The taker paid ${price} and received ${selling} tokens. The maker received ${ret("maker")} after a desk fee of ${ret("desk")}.`
      : `The taker's wallet (${wallet}) does not cover the price (${price}), so the taker walked away and the desk gave the maker's ${selling} tokens back.`}</div>`
    + `<div class="parties">`
    + party("Maker", row("tokens", selling, filled ? 0n : selling) + row("cash", 0n, ret("maker")))
    + party("Desk", row("tokens", 0n, 0n) + row("cash", 0n, ret("desk")))
    + party("Taker", row("tokens", 0n, ret("taker")) + row("cash", wallet, filled ? wallet - price : wallet))
    + `</div><ol class="steps">${steps.map((s) => `<li><span>${s}</span></li>`).join("")}</ol>`;
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
$("src").innerHTML = highlightHtml(OTC_SOURCE);
feeNote();
trade();
wireFooter();
