// Home page: the landing page. A live double-spend demo, live figures, and forwarding of old playground links.
import { highlightHtml, runPhil, KIND_TITLE, esc } from "./shared";
import { wireFooter } from "./foot";
import { CONTRACTS } from "../../core/src/sim/contracts";
import { HACKS } from "../../core/src/sim/hacks";
import { LESSONS } from "./lessons";
import conformance from "../../conformance/data.json";
import changes from "../../changelog/data.json";
import fuzz from "../../fuzz/data.json";
import fuzzHistory from "../../fuzz/history.json";
import philc from "../../philc/build.json";
import onchain from "../../onchain/deployment.json";
import { DRAWS } from "./giveaway-data";
import { DEMO } from "./burn-data";
import { CLIENT_WASM } from "./session-data";
import { MUTATION } from "./mutation-data";
import { STOPS } from "./tour-data";
import { CONTRACT } from "./shared";

// Links shared before the site had a home page pointed at the root with a hash.
// The home page's own sections are not playground links.
const SECTIONS = ["start", "chain", "build", "lab", "coin"];
if (location.hash.length > 1 && !SECTIONS.includes(location.hash.slice(1))) location.replace("playground/" + location.hash);

const BROKEN = `record Coin mode linear {
  amount : U64
}

callable Spend(coin : Coin) -> U64 {
  outcomes { success U64 };
}

fn spend(coin : Coin) -> U64 satisfies Spend {
  let Coin { amount } = coin;
  return amount;
}

component main provides U64 {
  let coin = construct Coin { amount = 10 };
  let first = spend(coin);
  let second = spend(coin);
  return first + second;
}
`;
const FIXED = BROKEN.replace("  let second = spend(coin);\n", "").replace("first + second", "first");
let fixed = false;
function show(): void {
  const src = fixed ? FIXED : BROKEN;
  const o = runPhil(src);
  document.getElementById("demo-code")!.innerHTML = highlightHtml(src, o.span);
  const says = document.getElementById("demo-says")!;
  says.className = "says" + (o.ok ? " good" : "");
  says.innerHTML = o.ok
    ? `<b>Ran to completion</b>The coin was spent once. The program hands back ${esc(o.returns[0]?.text ?? "")}.`
    : `<b>${esc(KIND_TITLE[o.kind] ?? o.kind)}${o.line ? `, line ${o.line}` : ""}</b>${esc(o.message)}`;
  document.getElementById("demo-flip")!.textContent = fixed ? "Spend it twice again" : "Remove the double spend";
}
document.getElementById("demo-flip")!.addEventListener("click", () => { fixed = !fixed; show(); });
show();

// Everything written in Phil, straight from the lists the pages themselves use.
const SHORT: Record<string, string> = {
  locker: "Lock tokens with a cliff, a release every period, claiming on demand and an optional cancel.",
  hooks: "A limit hook and a fee hook that run on every transfer.",
  launchhooks: "Sniper flags, the four-way fee split, holder rewards and graduation, after higher.fun's published rules.",
  stockrewards: "Buys tokenized stock with the holders' share of fees and hands it out by tokens held.",
  vesting: "A grant released in equal parts, which the grantor can revoke.",
  multisig: "Three signers vote; cash leaves only with two approvals and enough funds.",
  auction: "The higher of two locked bids wins if it meets the reserve. The loser is refunded.",
  launch: "A rising price curve that seeds a pool if it sells out and refunds in full if it does not.",
};
const made: [string, string, string, string][] = [
  ["otc/", "OTC desk", "A listing filled in parts, with expiry and cancel. The desk keeps only its fee.", "escrow"],
  ["otc/#book", "OTC order book", "Two listings, two takers and a book that offers the cheaper listing first.", "7 programs"],
  ...CONTRACTS.map((c): [string, string, string, string] => [`library/#${c.id}`, c.title, SHORT[c.id] ?? c.summary, `${c.scenarios.length} scenarios`]),
];
document.getElementById("made")!.innerHTML = made.map(([href, name, what, tag]) => `<a href="${href}"><b>${esc(name)}</b><i>${esc(tag)}</i><span>${esc(what)}</span></a>`).join("");
const set = (id: string, text: string) => { const el = document.getElementById(id); if (el) el.textContent = text; };
set("n-lessons", String(LESSONS.length));
set("n-hacks", String(HACKS.length));

// Live figures from the daily jobs.
const num = (n: number) => n.toLocaleString("en-GB");
const week = changes.days.slice(0, 7);
set("s-changes", num(week.reduce((t, d) => t + d.commits + d.merges, 0)));
set("s-changes-l", `changes landed in Phil's last ${week.length} active days, up to ${changes.phil.date}`);
const g = conformance.grammar;
document.getElementById("s-grammar")!.innerHTML = `${g.accept.agree + g.reject.agree}<small> of ${g.accept.files + g.reject.files}</small>`;
const tried = fuzzHistory.reduce((t, h) => t + h.total, 0);
set("s-fuzz", num(tried));
set("s-fuzz2", num(tried));
set("s-fuzz-l", `programs thrown at Phil's compiler so far. Wrong answers in the latest run: ${fuzz.findings.disagreement}`);
set("s-philc-l", `Phil's real compiler, ${(philc.bytes / 1048576).toFixed(1)} MB, built from commit ${String(philc.commit).slice(0, 10)} of ${philc.date}`);
const oc = onchain.devnet.run ?? onchain.local.run;
set("oc-net", onchain.devnet.ok ? "Solana devnet · live" : onchain.devnet.run ? "Solana devnet" : "Proven locally · devnet pending");
set("oc-val", String(oc?.returned ?? "–"));
set("oc-l", `from a ${onchain.programBytes.toLocaleString("en-GB")}-byte program, using ${oc?.unitsConsumed ?? "–"} compute units`);
const latest = DRAWS.find((g) => g.winners.length > 0);
if (latest) {
  set("gv-k", `Latest draw · ${latest.title}`);
  set("gv-val", latest.winners.map((w: { entry: string }) => w.entry).join(", "));
  set("gv-l", `picked from ${latest.entries.length} entries by the block at slot ${latest.draw.hashSlot.toLocaleString("en-GB")}`);
}
if (DEMO?.totals?.burns) {
  set("bv-val", (Number(BigInt(DEMO.totals.burned) / 10n ** BigInt(DEMO.decimals))).toLocaleString("en-GB"));
  set("bv-l", `coins burned in ${DEMO.totals.burns} ${DEMO.totals.burns === 1 ? "burn" : "burns"}, paid for with ${(Number(DEMO.totals.paid) / 1e9).toLocaleString("en-GB", { maximumFractionDigits: 4 })} SOL of fees`);
}
if (CLIENT_WASM) set("ss-val", Math.floor((CLIENT_WASM.length * 3) / 4 - (CLIENT_WASM.endsWith("==") ? 2 : CLIENT_WASM.endsWith("=") ? 1 : 0)).toLocaleString("en-GB"));
set("n-tour", String(STOPS.reduce((n, x) => n + x.parts.length, 0)));
if (MUTATION) {
  set("mu-val", `${MUTATION.server.oursKills}/${MUTATION.server.mutants}`);
  set("mu-all", String(MUTATION.total.mutants));
}

// The address, in the hero.
set("ca-hero", CONTRACT);
document.getElementById("copy-hero")?.addEventListener("click", async (e) => {
  const b = e.currentTarget as HTMLElement;
  try { await navigator.clipboard.writeText(CONTRACT); b.textContent = "Copied"; } catch { b.textContent = "Select the address to copy"; }
  setTimeout(() => { b.textContent = "Copy address"; }, 1600);
});

// Sections ease in as they come into view.
const hidden = [...document.querySelectorAll(".rv")];
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
  hidden.forEach((el, i) => { (el as HTMLElement).style.transitionDelay = `${(i % 4) * 60}ms`; io.observe(el); });
} else hidden.forEach((el) => el.classList.add("in"));
wireFooter();
