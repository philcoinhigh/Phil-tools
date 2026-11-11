// OTC page: runs otc/otc.phil (one listing) or otc/book.phil (order book) in the simulator.
import { OTC_SOURCE, BOOK_SOURCE } from "../../core/src/sim/otc-source";
import { buildAst } from "../../core/src/sim/ast";
import { explore } from "../../core/src/sim/explore";
import { runPhil, highlightHtml, KIND_TITLE, esc } from "./shared";
import { wireFooter } from "./foot";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Mode {
  source: string; form: string; example: string; note: string;
  ids: Record<string, string>;                       // program entry -> input id
  parties: { id: string; name: string; tokens?: string; cash?: string }[];  // shown, with the entry that funds them
  listings: { maker: string; name: string }[];
  feeNote: [string, string];
  presets: Record<string, Record<string, string>>;
}
const SINGLE: Mode = {
  source: OTC_SOURCE, form: "terms-single", example: "otc", note: "One maker, one desk, one taker.",
  ids: { selling: "t-selling", unit_price: "t-price", want: "t-want", wallet: "t-wallet", fee_bps: "t-fee", expires_after: "t-expires", cancel_after: "t-cancel" },
  parties: [{ id: "maker", name: "Maker", tokens: "selling" }, { id: "desk", name: "Desk" }, { id: "taker", name: "Taker", cash: "wallet" }],
  listings: [{ maker: "maker", name: "The listing" }],
  feeNote: ["t-fee", "fee-pct"],
  presets: {
    sold: { selling: "1000", unit_price: "2", want: "400", wallet: "5000", fee_bps: "100", expires_after: "10", cancel_after: "0" },
    dry: { selling: "1000", unit_price: "2", want: "400", wallet: "1000", fee_bps: "100", expires_after: "5", cancel_after: "0" },
    cancel: { selling: "1000", unit_price: "2", want: "400", wallet: "5000", fee_bps: "100", expires_after: "10", cancel_after: "1" },
    expire: { selling: "1000", unit_price: "2", want: "400", wallet: "5000", fee_bps: "100", expires_after: "2", cancel_after: "0" },
  },
};
const BOOK_BASE = { a_selling: "600", a_price: "3", b_selling: "500", b_price: "2", x_want: "300", x_wallet: "2000", y_want: "400", y_wallet: "900", fee_bps: "100", expires_after: "10", cancel_after: "0" };
const BOOK: Mode = {
  source: BOOK_SOURCE, form: "terms-book", example: "otc-book", note: "Two makers, two desks, a book and two takers: seven programs.",
  ids: { a_selling: "b-a-selling", a_price: "b-a-price", b_selling: "b-b-selling", b_price: "b-b-price", x_want: "b-x-want", x_wallet: "b-x-wallet", y_want: "b-y-want", y_wallet: "b-y-wallet", fee_bps: "b-fee", expires_after: "b-expires", cancel_after: "b-cancel" },
  parties: [
    { id: "maker_a", name: "Maker A", tokens: "a_selling" }, { id: "maker_b", name: "Maker B", tokens: "b_selling" }, { id: "desk_a", name: "Desk A" },
    { id: "desk_b", name: "Desk B" }, { id: "taker_x", name: "Taker X", cash: "x_wallet" }, { id: "taker_y", name: "Taker Y", cash: "y_wallet" },
  ],
  listings: [{ maker: "maker_a", name: "Listing A" }, { maker: "maker_b", name: "Listing B" }],
  feeNote: ["b-fee", "fee-pct-b"],
  presets: {
    "b-best": BOOK_BASE,
    "b-deep": { ...BOOK_BASE, x_wallet: "100000", y_wallet: "100000" },
    "b-cancel": { ...BOOK_BASE, cancel_after: "1" },
    "b-tie": { ...BOOK_BASE, a_price: "2" },
  },
};
let mode = SINGLE;

const NAMES: Record<string, string> = { maker: "Maker", desk: "Desk", taker: "Taker", maker_a: "Maker A", maker_b: "Maker B", desk_a: "Desk A", desk_b: "Desk B", book: "Book", taker_x: "Taker X", taker_y: "Taker Y" };
const who = (p: string) => NAMES[p] ?? p;
const listingOf = (proc: string) => (/_a$/.test(proc) ? "Listing A" : /_b$/.test(proc) ? "Listing B" : "The listing");
const listingIn = (proc: string) => (/_a$/.test(proc) ? "listing A" : /_b$/.test(proc) ? "listing B" : "the listing");
const isTaker = (p: string) => p.startsWith("taker"), isMaker = (p: string) => p.startsWith("maker"), isDesk = (p: string) => p.startsWith("desk");
const terms = () => Object.fromEntries(Object.entries(mode.ids).map(([k, id]) => [k, $<HTMLInputElement>(id).value.trim()])) as Record<string, string>;
const coinOf = (text: string) => { const m = /^(Token|Cash) \{ amount = (\d+) \}$/.exec(text); return m ? { kind: (m[1] === "Token" ? "tokens" : "cash") as "tokens" | "cash", amount: BigInt(m[2]) } : undefined; };
const MAX_STEPS = 80;

function feeNote(): void {
  const raw = $<HTMLInputElement>(mode.feeNote[0]).value.trim(), n = Number(raw);
  $(mode.feeNote[1]).textContent = Number.isFinite(n) && raw !== "" ? `${(n / 100).toFixed(2)}% · at most 1000` : "";
}

function trade(): void {
  const t = terms();
  const o = runPhil(mode.source, t);
  const box = $("result");
  if (!o.ok) {
    const refused = ["contract", "runtime", "arithmetic", "wiring"].includes(o.kind);
    box.innerHTML = `<div class="verdict bad"><b>${refused ? "These terms are refused" : esc(KIND_TITLE[o.kind] ?? o.kind)}</b>${esc(o.message)}<div class="muted">The program stopped. In Phil a broken promise halts everything rather than leaving a trade half done.</div></div>`;
    return;
  }
  // Follow every coin through the trace to get each party's final holdings.
  type Hold = { tokens: bigint; cash: bigint };
  const hold: Record<string, Hold> = {}, start: Record<string, Hold> = {};
  const at = (p: string) => (hold[p] ??= { tokens: 0n, cash: 0n });
  for (const p of mode.parties) { hold[p.id] = { tokens: p.tokens ? BigInt(t[p.tokens]) : 0n, cash: p.cash ? BigInt(t[p.cash]) : 0n }; start[p.id] = { ...hold[p.id] }; }
  const steps: string[] = [];
  const ending: Record<string, string> = {}, fills: Record<string, number> = {};
  const li = (html: string) => steps.push(`<li><span>${html}</span></li>`);
  const coin = (n: bigint, kind: string) => `<span class="coin">${n} ${kind}</span>`;
  let round = 0, pendingQty: string | undefined;
  for (const e of o.result!.trace) {
    if (e.kind === "select") {
      if (e.label === "Open" && isTaker(e.to)) { round++; steps.push(`<li class="round">Round ${round}${mode === BOOK ? ` · ${who(e.to)}'s turn` : ""}</li>`); }
      else if (e.label === "Pass" && isTaker(e.from)) li(`${who(e.from)} passes`);
      else if (e.label === "Filled") { const m = isMaker(e.to) ? e.to : e.from; fills[m] = (fills[m] ?? 0) + 1; }
      else if (e.label === "Cancel" || e.label === "Expired" || e.label === "SoldOut") {
        const m = isMaker(e.from) ? e.from : e.to;
        ending[m] = e.label;
        li(e.label === "Cancel" ? `${who(m)} cancels the rest of ${listingIn(m)}` : `${listingOf(m)} ${e.label === "Expired" ? "has expired" : "is sold out"}`);
      } else if (e.label === "Closed" && isTaker(e.to)) li(`Trading is closed for ${who(e.to)}`);
    } else if (e.kind === "message") {
      const c = coinOf(e.text);
      if (c) {
        at(e.from)[c.kind] -= c.amount; at(e.to)[c.kind] += c.amount;
        if (isMaker(e.from)) li(`${who(e.from)} lists ${coin(c.amount, "tokens")} with ${who(e.to)}`);
        else if (isTaker(e.from)) li(`${who(e.from)} pays ${coin(c.amount, "cash")}`);
        else if (isTaker(e.to)) li(`${who(e.to)} receives ${coin(c.amount, "tokens")}`);
        else if (isMaker(e.to)) li(c.kind === "cash" ? `${who(e.to)} receives ${coin(c.amount, "cash")} for ${listingIn(e.to)}` : `${who(e.to)} gets ${coin(c.amount, "tokens")} back, unsold`);
      } else if (isMaker(e.from)) li(`${who(e.from)} sets the price: ${esc(e.text)} per token`);
      else if (isTaker(e.to)) {
        if (pendingQty === undefined) pendingQty = e.text;
        else { li(`${who(e.from)} quotes ${esc(pendingQty)} tokens at ${esc(e.text)} each`); pendingQty = undefined; }
      } else if (isTaker(e.from)) li(`${who(e.from)} asks for ${esc(e.text)} tokens`);
    }
  }
  const takers = mode.parties.filter((p) => isTaker(p.id));
  const sold = takers.reduce((n, p) => n + hold[p.id].tokens, 0n);
  const paid = takers.reduce((n, p) => n + (start[p.id].cash - hold[p.id].cash), 0n);
  const fees = mode.parties.filter((p) => isDesk(p.id)).reduce((n, p) => n + hold[p.id].cash, 0n);
  const state = (m: string) => {
    const listed = start[m].tokens, back = hold[m].tokens, f = fills[m] ?? 0;
    if (listed === 0n) return "nothing was listed";
    const how = ending[m] === "SoldOut" ? "sold out" : ending[m] === "Cancel" ? "cancelled by the maker" : f > 0 ? "expired part-filled" : "expired with no fills";
    return `${how} · ${f} fill${f === 1 ? "" : "s"}, maker received ${hold[m].cash}${back > 0n ? ` and got ${back} tokens back` : ""}`;
  };
  const allSold = mode.listings.every((l) => ending[l.maker] === "SoldOut" && start[l.maker].tokens > 0n);
  const one = mode.listings.length === 1;
  const title = one ? state(mode.listings[0].maker).split(" · ")[0].replace(/^./, (c) => c.toUpperCase()) : allSold ? "Both listings sold out" : sold > 0n ? "Trading finished" : "No trades";
  const summary = `${sold} tokens changed hands for ${paid} over ${round} round${round === 1 ? "" : "s"}. Desk fees came to ${fees}.`;
  const lines = `<ul class="listings">${mode.listings.map((l) => `<li><strong>${l.name}:</strong> ${state(l.maker)}</li>`).join("")}</ul>`;
  const row = (label: string, before: bigint, after: bigint) => `<dt>${label}</dt><dd>${before !== after ? `<span class="was">${before}</span>` : ""}${after}</dd>`;
  const shown = steps.slice(0, MAX_STEPS);
  box.innerHTML = `<div class="verdict ${allSold ? "good" : "mid"}"><b>${esc(title)}</b>${summary}${lines}</div>`
    + `<div class="parties${one ? "" : " wide"}">${mode.parties.map((p) => `<div class="party"><h3>${p.name}</h3><dl>${row("tokens", start[p.id].tokens, hold[p.id].tokens)}${row("cash", start[p.id].cash, hold[p.id].cash)}</dl></div>`).join("")}</div>`
    + `<ol class="steps">${shown.join("")}${steps.length > MAX_STEPS ? `<li class="round">${steps.length - MAX_STEPS} more steps not shown. Open the program in the playground to replay all of them.</li>` : ""}</ol>`;
}

function hunt(): void {
  const out = $("hunt-out");
  out.textContent = "Trying boundary amounts and different schedules…";
  setTimeout(() => {
    try {
      const h = explore(buildAst(mode.source), terms(), { budgetMs: 3000 });
      out.innerHTML = h.findings.length
        ? `<b>Found ${h.findings.length} failure${h.findings.length === 1 ? "" : "s"} in ${h.runs} runs.</b> ${esc(h.findings[0].message)} (${esc(h.findings[0].inputs.map((i) => `${i.name} = ${i.text}`).join(", "))})`
        : `<b>${h.runs} runs, no failure found.</b> No run lost a coin, copied one, broke a promise or got stuck. This is a bounded search, not a proof.`;
    } catch (e) { out.textContent = "The search could not run: " + String((e as Error).message ?? e); }
  }, 30);
}

function setMode(m: Mode): void {
  mode = m;
  for (const x of [SINGLE, BOOK]) $(x.form).hidden = x !== m;
  $("mode-single").setAttribute("aria-pressed", String(m === SINGLE));
  $("mode-book").setAttribute("aria-pressed", String(m === BOOK));
  $("mode-note").textContent = m.note;
  $("src").innerHTML = highlightHtml(m.source);
  $<HTMLAnchorElement>("pg-link").href = "../playground/#" + m.example;
  $("hunt-out").textContent = "";
  feeNote();
  trade();
}

$("trade").addEventListener("click", trade);
$("hunt").addEventListener("click", hunt);
$("mode-single").addEventListener("click", () => setMode(SINGLE));
$("mode-book").addEventListener("click", () => setMode(BOOK));
for (const m of [SINGLE, BOOK]) $(m.feeNote[0]).addEventListener("input", feeNote);
document.querySelectorAll<HTMLElement>("[data-preset]").forEach((b) => b.addEventListener("click", () => {
  for (const [k, v] of Object.entries(mode.presets[b.dataset.preset!])) $<HTMLInputElement>(mode.ids[k]).value = v;
  feeNote();
  trade();
}));
setMode(location.hash === "#book" ? BOOK : SINGLE);
wireFooter();
