// Token locker: check a coin's locks without a wallet; lock and release with one.
import { PublicKey, Transaction, Keypair } from "@solana/web3.js";
import { PROGRAM, DEMO } from "./locker-data";
import { esc, landed } from "./shared";
import { wireFooter } from "./foot";
import { chain, bytesOf, key, short, when, coinInfo as coinOf, Coin, units, provider, connectWallet, noWalletHtml, signAndSend as send, explain } from "./wallet";
import { decodeLock, amountText, untilText, Lock, LOCK_SIZE } from "./lock";
import { lockInstructions, releaseInstructions, tokenAccountOf } from "./lock-tx";

const NET = chain(PROGRAM?.network ?? "devnet", PROGRAM?.rpc ?? "https://api.devnet.solana.com");
const rpc = NET.rpc, explorer = NET.explorer;
const coinInfo = (text: string) => coinOf(NET, text);
const $ = (id: string) => document.getElementById(id)!;
const val = (id: string) => ($(id) as HTMLInputElement).value.trim();
const b58 = (bytes: Uint8Array) => new PublicKey(bytes).toBase58();
$("net").textContent = `Solana ${NET.name}`; $("net-name").textContent = NET.name;

// ---- check a coin's locks ----
interface Found { address: string; lock: Lock }
let shown: { coin: Coin; locks: Found[] } | null = null;
const now = () => Math.floor(Date.now() / 1000);
const status = (l: Lock) => (l.state === "released" ? "released" : now() >= l.unlockTime ? "ready" : "locked");
function card(f: Found, coin: Coin): string {
  const l = f.lock, s = status(l), pct = coin.supply ? Number((l.amount * 10000n) / coin.supply) / 100 : 0;
  const span = Math.max(1, l.unlockTime - l.lockedTime), done = Math.min(100, Math.max(0, ((now() - l.lockedTime) / span) * 100));
  return `<article class="lock" data-lock="${f.address}">
    <div class="hd"><b>${amountText(l.amount, l.decimals)}</b><span>${pct ? `${pct}% of supply · ` : ""}${esc(l.label || "No name")}</span><span class="st ${s}">${s === "ready" ? "Ready to release" : s === "locked" ? "Locked" : "Released"}</span></div>
    <dl>
      <dt>${s === "released" ? "Released" : "Unlocks"}</dt><dd>${s === "released" ? when(l.releasedTime) : `${when(l.unlockTime)} <span class="count" data-unlock="${l.unlockTime}">${s === "locked" ? `· ${untilText(l.unlockTime - now())}` : ""}</span>${s === "locked" ? `<div class="bar"><i style="width:${done.toFixed(1)}%"></i></div>` : ""}`}</dd>
      <dt>Locked on</dt><dd>${when(l.lockedTime)} by <a href="${explorer("address", b58(l.depositor))}" rel="noopener">${short(b58(l.depositor))}</a></dd>
      <dt>Goes to</dt><dd><a href="${explorer("address", b58(l.beneficiary))}" rel="noopener">${short(b58(l.beneficiary))}</a>${b58(l.beneficiary) === b58(l.depositor) ? " (the wallet that locked it)" : ""}</dd>
      <dt>Lock account</dt><dd><a href="${explorer("address", f.address)}" rel="noopener">${esc(f.address)}</a></dd>
    </dl>
    ${s === "ready" ? `<div class="act"><button class="btn release" type="button" data-lock="${f.address}">Release it to ${short(b58(l.beneficiary))}</button> <span class="muted rel-note" role="status"></span></div>` : ""}
  </article>`;
}
function render() {
  if (!shown) return;
  const { coin, locks } = shown;
  const held = locks.filter((f) => f.lock.state === "locked").reduce((n, f) => n + f.lock.amount, 0n);
  const pct = coin.supply ? Number((held * 10000n) / coin.supply) / 100 : 0;
  $("summary").className = "say" + (locks.length ? " good" : "");
  $("summary").innerHTML = locks.length
    ? `<b>${amountText(held, coin.decimals)}</b> of this coin ${held === 0n ? "is" : "is"} locked right now${pct ? `, <b>${pct}%</b> of its supply` : ""}, in ${locks.filter((f) => f.lock.state === "locked").length} of ${locks.length} lock${locks.length === 1 ? "" : "s"} made here.`
    : "No locks have been made for this coin with this locker.";
  $("locks").innerHTML = locks.map((f) => card(f, coin)).join("");
  $("found").hidden = false; ($("share") as HTMLElement).hidden = false;
}
async function find(text: string): Promise<void> {
  const coin = await coinInfo(text);
  const rows = await rpc("getProgramAccounts", [PROGRAM.programId, { encoding: "base64", commitment: "confirmed", filters: [{ dataSize: LOCK_SIZE }, { memcmp: { offset: 64, bytes: coin.mint.toBase58() } }] }]);
  const locks: Found[] = (rows ?? []).map((r: any) => ({ address: r.pubkey, lock: decodeLock(bytesOf(r.account.data[0])) })).filter((f: any) => f.lock && f.lock.state !== "empty");
  locks.sort((a, b) => b.lock.amount > a.lock.amount ? 1 : b.lock.amount < a.lock.amount ? -1 : b.lock.lockedTime - a.lock.lockedTime);
  shown = { coin, locks };
  render();
}
let finds = 0;
async function doFind() {
  const b = $("find") as HTMLButtonElement;
  if (!PROGRAM?.programId) return landed($("found"), $("find-note"), "The locker is not deployed yet.");
  b.classList.add("busy"); b.textContent = "Reading Solana…";
  let text: string;
  try { await find(val("coin")); text = `Read from Solana just now (${++finds})`; try { history.replaceState(null, "", `?coin=${shown!.coin.mint.toBase58()}`); } catch { /* sandboxed */ } }
  catch (e: any) { text = String(e?.message ?? e); $("found").hidden = true; }
  b.classList.remove("busy"); b.textContent = "Show its locks";
  landed($("found"), $("find-note"), text);
}
$("find").addEventListener("click", () => { void doFind(); });
$("coin").addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") void doFind(); });
$("share").addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.href); $("share").textContent = "Link copied"; } catch { $("share").textContent = "Copy the address bar"; } setTimeout(() => { $("share").textContent = "Copy a link to this"; }, 1600); });
setInterval(() => document.querySelectorAll<HTMLElement>(".count[data-unlock]").forEach((el) => { const left = Number(el.dataset.unlock) - now(); if (el.textContent) el.textContent = left > 0 ? `· ${untilText(left)}` : "· ready, refresh to release"; }), 1000);

// ---- the wallet ----
let wallet: PublicKey | null = null;
async function connect(): Promise<PublicKey> {
  wallet = await connectWallet();
  $("who").textContent = `Connected: ${short(wallet.toBase58())}`; $("connect").textContent = "Connected"; ($("form") as HTMLElement).hidden = false;
  if (!val("m-to")) ($("m-to") as HTMLInputElement).value = wallet.toBase58();
  if (!val("m-coin") && val("coin")) ($("m-coin") as HTMLInputElement).value = val("coin");
  void balance();
  return wallet;
}
$("connect").addEventListener("click", async () => {
  try { await connect(); }
  catch (e: any) { $("no-wallet").hidden = false; $("no-wallet").innerHTML = noWalletHtml(NET, e); }
});
const signAndSend = (tx: Transaction, extra: Keypair[], say: (s: string) => void) => send(NET, wallet!, tx, extra, say);

// ---- lock tokens ----
let coinForLock: Coin | null = null, have = 0n;
async function balance() {
  $("m-have").textContent = ""; coinForLock = null;
  if (!wallet || !val("m-coin")) return;
  try {
    coinForLock = await coinInfo(val("m-coin"));
    try { have = BigInt((await rpc("getTokenAccountBalance", [tokenAccountOf(wallet, coinForLock.mint, coinForLock.tokenProgram).toBase58(), { commitment: "confirmed" }])).value.amount); } catch { have = 0n; }
    $("m-have").textContent = `Your wallet holds ${amountText(have, coinForLock.decimals)} of this coin.`;
  } catch (e: any) { $("m-have").textContent = String(e?.message ?? e); }
}
$("m-coin").addEventListener("change", () => { void balance(); });
const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
document.querySelectorAll<HTMLButtonElement>("#quick button").forEach((b) => b.addEventListener("click", () => { ($("m-until") as HTMLInputElement).value = toLocal(new Date(Date.now() + Number(b.dataset.d) * 86400000)); }));
let pending: { coin: Coin; amount: bigint; unlock: number; to: PublicKey; label: string } | null = null;
$("review-go").addEventListener("click", async () => {
  const review = $("review");
  pending = null; ($("lock-go") as HTMLElement).hidden = true; ($("agree-wrap") as HTMLElement).hidden = true; ($("agree") as HTMLInputElement).checked = false; ($("lock-go") as HTMLButtonElement).disabled = true;
  try {
    if (!wallet) throw new Error("Connect a wallet first.");
    if (!coinForLock || coinForLock.mint.toBase58() !== val("m-coin")) await balance();
    if (!coinForLock) throw new Error($("m-have").textContent || "Enter a coin address.");
    const amount = units(val("m-amount"), coinForLock.decimals);
    if (amount <= 0n) throw new Error("The amount must be more than zero.");
    if (amount > have) throw new Error(`Your wallet holds ${amountText(have, coinForLock.decimals)} of this coin, which is less than that.`);
    const unlock = Math.floor(new Date(val("m-until")).getTime() / 1000);
    if (!Number.isFinite(unlock)) throw new Error("Choose the date and time it unlocks.");
    if (unlock < now() + 120) throw new Error("The unlock time must be at least a few minutes from now.");
    const to = key(val("m-to"), "wallet address");
    const label = val("m-label");
    if (new TextEncoder().encode(label).length > 32) throw new Error("The name is too long.");
    pending = { coin: coinForLock, amount, unlock, to, label };
    review.className = "say"; review.hidden = false;
    review.innerHTML = `You are about to lock <b>${amountText(amount, coinForLock.decimals)}</b> of <b>${short(coinForLock.mint.toBase58())}</b> until <b>${when(unlock)}</b> (${untilText(unlock - now())}). After that it can go only to <b>${short(to.toBase58())}</b>${to.equals(wallet) ? ", your own wallet" : ", which is <b>not</b> your wallet"}. Making the lock costs about 0.005 SOL in account rent and fees.`;
    ($("lock-go") as HTMLElement).hidden = false; ($("agree-wrap") as HTMLElement).hidden = false;
  } catch (e: any) { review.className = "say bad"; review.hidden = false; review.textContent = String(e?.message ?? e); }
});
$("agree").addEventListener("change", () => { ($("lock-go") as HTMLButtonElement).disabled = !($("agree") as HTMLInputElement).checked; });
$("lock-go").addEventListener("click", async () => {
  if (!pending || !wallet) return;
  const b = $("lock-go") as HTMLButtonElement, done = $("done"), p = pending;
  b.disabled = true; b.classList.add("busy");
  const say = (s: string) => { $("lock-note").textContent = s; };
  try {
    const rent: number = await rpc("getMinimumBalanceForRentExemption", [LOCK_SIZE]);
    const made = lockInstructions({ program: new PublicKey(PROGRAM.programId), depositor: wallet, mint: p.coin.mint, tokenProgram: p.coin.tokenProgram, amount: p.amount, unlockTime: p.unlock, beneficiary: p.to, label: p.label, rentLamports: rent });
    const signature = await signAndSend(new Transaction().add(...made.instructions), [made.lock], say);
    const link = `${location.origin}${location.pathname}?coin=${p.coin.mint.toBase58()}`;
    done.className = "say good"; done.hidden = false;
    done.innerHTML = `Locked. <b>${amountText(p.amount, p.coin.decimals)}</b> cannot move until ${when(p.unlock)}. <a href="${explorer("tx", signature)}" rel="noopener">See the transaction</a>. Proof page to share: <a href="${esc(link)}">${esc(link)}</a>`;
    pending = null; b.hidden = true; ($("agree-wrap") as HTMLElement).hidden = true; $("review").hidden = true;
    ($("coin") as HTMLInputElement).value = p.coin.mint.toBase58(); void doFind(); void balance();
    landed(done, $("lock-note"), "Confirmed by Solana");
  } catch (e: any) {
    done.className = "say bad"; done.hidden = false; done.textContent = explain(e);
    b.disabled = false; landed(done, $("lock-note"), "Not locked");
  }
  b.classList.remove("busy");
});

// ---- release ----
$("locks").addEventListener("click", async (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button.release");
  if (!b || !shown) return;
  const f = shown.locks.find((x) => x.address === b.dataset.lock)!, note = b.parentElement!.querySelector<HTMLElement>(".rel-note")!;
  b.disabled = true; b.classList.add("busy");
  try {
    if (!wallet) await connect();
    const ixs = releaseInstructions({ program: new PublicKey(PROGRAM.programId), payer: wallet!, lock: new PublicKey(f.address), mint: shown.coin.mint, tokenProgram: shown.coin.tokenProgram, escrow: new PublicKey(f.lock.escrow), beneficiary: new PublicKey(f.lock.beneficiary) });
    await signAndSend(new Transaction().add(...ixs), [], (s) => { note.textContent = s; });
    note.textContent = "Released."; await doFind();
  } catch (e: any) { note.textContent = provider() ? explain(e) : "Releasing needs a wallet to pay the small network fee. Open this page in a wallet's browser."; b.disabled = false; }
  b.classList.remove("busy");
});

// ---- the page ----
const facts: [string, string][] = [];
if (PROGRAM?.programId) facts.push(["Program", `<a href="${explorer("address", PROGRAM.programId)}" rel="noopener">${esc(PROGRAM.programId)}</a>`]);
if (PROGRAM?.programBytes) facts.push(["Size", `${PROGRAM.programBytes.toLocaleString("en-GB")} bytes`]);
if (PROGRAM?.selftest?.lockUnits) facts.push(["Cost", `${PROGRAM.selftest.lockUnits.toLocaleString("en-GB")} compute units to lock, ${PROGRAM.selftest.releaseUnits.toLocaleString("en-GB")} to release, of 200,000 allowed`]);
facts.push(["Instructions", "two: lock, and release after the date. There is no third"]);
facts.push(["Interface", "Phil's own checker accepts the locker's runtime against all 46 signatures Phil's LLVM declares"]);
$("p-facts").innerHTML = facts.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join("");
($("m-until") as HTMLInputElement).value = toLocal(new Date(Date.now() + 30 * 86400000));
const asked = new URLSearchParams(location.search).get("coin");
if (asked || DEMO?.mint) { ($("coin") as HTMLInputElement).value = asked ?? DEMO.mint; if (PROGRAM?.programId) void doFind(); }
wireFooter();
