// My coin: one page for any coin. Read its locks and burn vaults with no wallet; with one, lock
// tokens, open a vault, burn for the pot, and run a giveaway. Every transaction is built by the
// same code the nightly workflows prove against a real validator.
import { PublicKey, Transaction, Keypair } from "@solana/web3.js";
import { PROGRAM as LOCKER, DEMO as LOCK_DEMO } from "./locker-data";
import { PROGRAM as BURN, DEMO as BURN_DEMO } from "./burn-data";
import { PROGRAM as DRAW } from "./giveaway-data";
import { esc, landed, store } from "./shared";
import { wireFooter } from "./foot";
import { chain, bytesOf, key, short, when, coinInfo, Coin, units, provider, connectWallet, noWalletHtml, signAndSend, explain } from "./wallet";
import { decodeLock, amountText, untilText, Lock, LOCK_SIZE } from "./lock";
import { lockInstructions, tokenAccountOf } from "./lock-tx";
import { decodeVault, potOf, sol, Vault, VAULT_SIZE } from "./burn";
import { openInstructions, burnInstruction } from "./burn-tx";
import { buildRecord, cleanEntries, decodeDraw, DRAW_SIZE, Giveaway, Record as DrawRecord } from "./draw";
import { lockGiveawayInstructions, drawInstruction, MAX_ONE_TX_PAYLOAD, DRAW_WINDOW_SLOTS } from "./draw-tx";
import { winnersOf } from "./draw-chain";

const NET = chain(LOCKER?.network ?? "devnet", LOCKER?.rpc ?? "https://api.devnet.solana.com");
const $ = (id: string) => document.getElementById(id)!;
const val = (id: string) => ($(id) as HTMLInputElement).value.trim();
const b58 = (bytes: Uint8Array) => new PublicKey(bytes).toBase58();
const now = () => Math.floor(Date.now() / 1000);
const n = (v: number) => v.toLocaleString("en-GB");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
$("net").textContent = `Solana ${NET.name}`;

// ---- every action is reviewed in words before the wallet is asked ----
interface Plan { html: string; run(say: (s: string) => void): Promise<string> }
const actions: Record<string, { review(prepare: () => Promise<Plan>): Promise<void> }> = {};
document.querySelectorAll<HTMLElement>("[data-action]").forEach((host) => {
  const id = host.dataset.action!, agree = host.dataset.agree;
  host.innerHTML = `<div class="say" id="${id}-say" hidden></div>
    ${agree ? `<label class="agree" id="${id}-agree-wrap" hidden><input type="checkbox" id="${id}-agree"><span>${esc(agree)}</span></label>` : ""}
    <div class="row">${"noreview" in host.dataset ? "" : `<button class="btn" id="${id}-review" type="button">Review</button>`}<button class="btn" id="${id}-go" type="button" hidden>${esc(host.dataset.go!)}</button><span class="muted" id="${id}-note" role="status"></span></div>
    <div class="say" id="${id}-done" hidden></div>`;
  const say = $(`${id}-say`), go = $(`${id}-go`) as HTMLButtonElement, done = $(`${id}-done`), note = $(`${id}-note`);
  const tick = agree ? ($(`${id}-agree`) as HTMLInputElement) : null, wrap = agree ? $(`${id}-agree-wrap`) : null;
  let plan: Plan | null = null;
  const reset = () => { plan = null; go.hidden = true; if (wrap) wrap.hidden = true; if (tick) tick.checked = false; };
  tick?.addEventListener("change", () => { go.disabled = !tick.checked; });
  go.addEventListener("click", async () => {
    if (!plan) return;
    go.disabled = true; go.classList.add("busy");
    try {
      const html = await plan.run((s) => { note.textContent = s; });
      done.className = "say good"; done.hidden = false; done.innerHTML = html; say.hidden = true; reset();
      landed(done, note, "Confirmed by Solana");
    } catch (e: any) { done.className = "say bad"; done.hidden = false; done.textContent = explain(e); go.disabled = !!tick && !tick.checked; landed(done, note, "Not done"); }
    go.classList.remove("busy");
  });
  actions[id] = { async review(prepare) {
    reset(); done.hidden = true; note.textContent = "";
    try {
      plan = await prepare();
      say.className = "say"; say.hidden = false; say.innerHTML = plan.html;
      go.hidden = false; go.disabled = !!tick; if (wrap) wrap.hidden = false;
    } catch (e: any) { say.className = "say bad"; say.hidden = false; say.textContent = String(e?.message ?? e); }
  } };
});

// ---- the coin ----
interface FoundLock { address: string; lock: Lock }
interface FoundVault { address: string; v: Vault; lamports: bigint }
let coin: Coin | null = null, locks: FoundLock[] = [], vaults: FoundVault[] = [];
let wallet: PublicKey | null = null, have = 0n;
const pct = (part: bigint) => (coin && coin.supply ? Number((part * 10000n) / coin.supply) / 100 : 0);
const need = (): { coin: Coin; wallet: PublicKey } => { if (!coin) throw new Error("Open a coin first."); if (!wallet) throw new Error("Connect a wallet first."); return { coin, wallet }; };

async function programAccounts(program: string, size: number, offset: number, mint: PublicKey): Promise<any[]> {
  return (await NET.rpc("getProgramAccounts", [program, { encoding: "base64", commitment: "confirmed", filters: [{ dataSize: size }, { memcmp: { offset, bytes: mint.toBase58() } }] }])) ?? [];
}
async function read(text: string): Promise<void> {
  const c = await coinInfo(NET, text);
  const l = LOCKER?.programId ? await programAccounts(LOCKER.programId, LOCK_SIZE, 64, c.mint) : [];
  const v = BURN?.programId ? await programAccounts(BURN.programId, VAULT_SIZE, 32, c.mint) : [];
  coin = c;
  locks = l.map((r) => ({ address: r.pubkey as string, lock: decodeLock(bytesOf(r.account.data[0]))! })).filter((f) => f.lock && f.lock.state !== "empty")
    .sort((a, b) => (b.lock.amount > a.lock.amount ? 1 : b.lock.amount < a.lock.amount ? -1 : 0));
  vaults = v.map((r) => ({ address: r.pubkey as string, v: decodeVault(bytesOf(r.account.data[0]))!, lamports: BigInt(r.account.lamports) })).filter((f) => f.v && f.v.open)
    .sort((a, b) => (potOf(b.lamports, b.v) > potOf(a.lamports, a.v) ? 1 : potOf(b.lamports, b.v) < potOf(a.lamports, a.v) ? -1 : b.v.burns - a.v.burns));
}
function render(): void {
  if (!coin) return;
  const c = coin, mint = c.mint.toBase58();
  const held = locks.filter((f) => f.lock.state === "locked"), heldSum = held.reduce((s, f) => s + f.lock.amount, 0n);
  const next = held.map((f) => f.lock.unlockTime).sort((a, b) => a - b)[0];
  $("t-locked").textContent = `${pct(heldSum)}%`;
  $("t-locked-sub").textContent = held.length ? `${amountText(heldSum, c.decimals)} in ${held.length} lock${held.length === 1 ? "" : "s"}; first unlock ${new Date(next * 1000).toLocaleDateString("en-GB", { dateStyle: "medium" })}` : "nothing is locked here";
  const pot = vaults.reduce((s, f) => s + potOf(f.lamports, f.v), 0n), burned = vaults.reduce((s, f) => s + f.v.totalBurned, 0n), burns = vaults.reduce((s, f) => s + f.v.burns, 0), paid = vaults.reduce((s, f) => s + f.v.totalPaid, 0n);
  $("t-pot").textContent = `${sol(pot)} SOL`; $("t-pot-sub").textContent = vaults.length ? `in ${vaults.length} vault${vaults.length === 1 ? "" : "s"}` : "no vault yet";
  $("t-burned").textContent = amountText(burned, c.decimals); $("t-burned-sub").textContent = burns ? `${n(burns)} burn${burns === 1 ? "" : "s"}, paid ${sol(paid)} SOL` : "no burns yet";

  $("locks-sum").className = "say" + (held.length ? " good" : "");
  $("locks-sum").innerHTML = held.length ? `<b>${amountText(heldSum, c.decimals)}</b> of this coin is locked right now, <b>${pct(heldSum)}%</b> of its supply.` : "Nothing is locked for this coin yet.";
  $("locks").hidden = locks.length === 0;
  $("locks").innerHTML = locks.map(({ lock: l }) => {
    const s = l.state === "released" ? "Released" : now() >= l.unlockTime ? "Ready to release" : "Locked";
    return `<li><div class="l1"><b>${amountText(l.amount, l.decimals)}</b><span class="st">${s}</span></div><div class="l2">${pct(l.amount) ? `${pct(l.amount)}% of supply · ` : ""}${esc(l.label || "No name")} · ${l.state === "released" ? `released ${when(l.releasedTime)}` : `unlocks ${when(l.unlockTime)}${now() < l.unlockTime ? ` (${untilText(l.unlockTime - now())})` : ""}`} · goes to ${short(b58(l.beneficiary))}</div></li>`;
  }).join("");
  ($("locks-link") as HTMLAnchorElement).href = `../locker/?coin=${mint}`;

  $("vaults-sum").className = "say" + (vaults.length ? " good" : "");
  $("vaults-sum").innerHTML = vaults.length ? `This coin has <b>${vaults.length}</b> vault${vaults.length === 1 ? "" : "s"}. Send SOL to a vault's address, from a fee setting or by hand, and it waits there for whoever burns.` : "No vault has been opened for this coin yet.";
  $("vaults").hidden = vaults.length === 0;
  $("vaults").innerHTML = vaults.map((f) => `<li data-vault="${f.address}"><div class="l1"><b>${sol(potOf(f.lamports, f.v), 6)} SOL waiting</b><span>${esc(f.v.label || "No name")}</span></div>
    <div class="l2">Rule: burn <b>${amountText(f.v.threshold, c.decimals)}</b> coins${pct(f.v.threshold) ? ` (${pct(f.v.threshold)}% of supply)` : ""}, take everything in it. ${f.v.burns ? `Burned so far: ${amountText(f.v.totalBurned, c.decimals)} in ${n(f.v.burns)} burn${f.v.burns === 1 ? "" : "s"}.` : "Not burned yet."}</div>
    <div class="l2">Fee address: <code>${esc(f.address)}</code></div>
    <div class="acts"><button class="btn ghost small copy" type="button" data-copy="${f.address}">Copy the fee address</button><a class="btn ghost small" href="${NET.explorer("address", f.address)}" rel="noopener">Explorer</a>${wallet ? `<button class="btn small burn" type="button" data-vault="${f.address}">Burn and take the pot</button>` : ""}</div></li>`).join("");

  $("kit").hidden = false; ($("share") as HTMLElement).hidden = false;
  document.querySelectorAll<HTMLElement>("#kit [data-need]").forEach((el) => { el.hidden = !!wallet; });
  document.querySelectorAll<HTMLElement>("#kit [data-form]").forEach((el) => { el.hidden = !wallet; });
  if (wallet && !val("l-to")) ($("l-to") as HTMLInputElement).value = wallet.toBase58();
  $("l-have").textContent = wallet ? `Your wallet holds ${amountText(have, c.decimals)} of this coin.` : "";
}
async function balance(): Promise<void> {
  have = 0n;
  if (!wallet || !coin) return;
  try { have = BigInt((await NET.rpc("getTokenAccountBalance", [tokenAccountOf(wallet, coin.mint, coin.tokenProgram).toBase58(), { commitment: "confirmed" }])).value.amount); } catch { have = 0n; }
}
let reads = 0;
async function open(): Promise<void> {
  const b = $("open") as HTMLButtonElement;
  b.classList.add("busy"); b.textContent = "Reading Solana…";
  let text: string;
  try {
    await read(val("coin")); await balance(); render(); mine();
    text = `Read from Solana just now (${++reads})`;
    try { history.replaceState(null, "", `?coin=${coin!.mint.toBase58()}`); } catch { /* sandboxed */ }
  } catch (e: any) { text = String(e?.message ?? e); }
  b.classList.remove("busy"); b.textContent = "Open";
  landed(coin ? $("tiles") : $("open"), $("open-note"), text);
}
const refresh = async () => { try { await read(coin!.mint.toBase58()); await balance(); render(); } catch { /* the page keeps what it showed */ } };
$("open").addEventListener("click", () => { void open(); });
$("coin").addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") void open(); });
const copy = async (b: HTMLElement, text: string, back: string) => { try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch { b.textContent = "Select it to copy"; } setTimeout(() => { b.textContent = back; }, 1600); };
$("share").addEventListener("click", () => { void copy($("share"), location.href, "Copy this coin's link"); });
$("connect").addEventListener("click", async () => {
  try {
    wallet = await connectWallet();
    $("who").textContent = `Connected: ${short(wallet.toBase58())}`; $("connect").textContent = "Connected"; $("no-wallet").hidden = true;
    await balance(); render();
  } catch (e: any) { $("no-wallet").hidden = false; $("no-wallet").innerHTML = noWalletHtml(NET, e); }
});

// ---- lock tokens ----
const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
($("l-until") as HTMLInputElement).value = toLocal(new Date(Date.now() + 30 * 86400000));
document.querySelectorAll<HTMLButtonElement>("#l-quick button").forEach((b) => b.addEventListener("click", () => { ($("l-until") as HTMLInputElement).value = toLocal(new Date(Date.now() + Number(b.dataset.d) * 86400000)); }));
$("lock-review").addEventListener("click", () => actions.lock.review(async () => {
  const { coin: c, wallet: w } = need();
  const amount = units(val("l-amount"), c.decimals);
  if (amount <= 0n) throw new Error("The amount must be more than zero.");
  if (amount > have) throw new Error(`Your wallet holds ${amountText(have, c.decimals)} of this coin, which is less than that.`);
  const unlock = Math.floor(new Date(val("l-until")).getTime() / 1000);
  if (!Number.isFinite(unlock)) throw new Error("Choose the date and time it unlocks.");
  if (unlock < now() + 120) throw new Error("The unlock time must be at least a few minutes from now.");
  const to = key(val("l-to"), "wallet address"), label = val("l-label");
  if (new TextEncoder().encode(label).length > 32) throw new Error("The name is too long.");
  return {
    html: `You are about to lock <b>${amountText(amount, c.decimals)}</b> coins${pct(amount) ? ` (${pct(amount)}% of supply)` : ""} until <b>${when(unlock)}</b> (${untilText(unlock - now())}). After that they can go only to <b>${short(to.toBase58())}</b>${to.equals(w) ? ", your own wallet" : ", which is <b>not</b> your wallet"}. Making the lock costs about 0.005 SOL in account rent and fees.`,
    async run(say) {
      const rent: number = await NET.rpc("getMinimumBalanceForRentExemption", [LOCK_SIZE]);
      const made = lockInstructions({ program: new PublicKey(LOCKER.programId), depositor: w, mint: c.mint, tokenProgram: c.tokenProgram, amount, unlockTime: unlock, beneficiary: to, label, rentLamports: rent });
      const signature = await signAndSend(NET, w, new Transaction().add(...made.instructions), [made.lock], say);
      await refresh();
      return `Locked. <b>${amountText(amount, c.decimals)}</b> cannot move until ${when(unlock)}. <a href="${NET.explorer("tx", signature)}" rel="noopener">See the transaction</a>. Proof page to share: <a href="../locker/?coin=${c.mint.toBase58()}">the coin's locks</a>.`;
    },
  };
}));

// ---- burn vaults ----
$("v-threshold").addEventListener("input", () => {
  try { const t = units(val("v-threshold"), coin!.decimals); $("v-pct").textContent = t > 0n ? `That is ${pct(t)}% of the supply. It can never be changed.` : "It can never be changed."; } catch { $("v-pct").textContent = "Set it high enough that burning it matters. It can never be changed."; }
});
$("vault-review").addEventListener("click", () => actions.vault.review(async () => {
  const { coin: c, wallet: w } = need();
  const threshold = units(val("v-threshold"), c.decimals), label = val("v-label");
  if (threshold <= 0n) throw new Error("The amount to burn must be more than zero.");
  if (threshold > c.supply) throw new Error("That is more than the coin's whole supply, so nobody could ever take the pot.");
  if (new TextEncoder().encode(label).length > 32) throw new Error("The name is too long.");
  return {
    html: `You are about to open a vault for this coin with one rule: whoever burns <b>${amountText(threshold, c.decimals)}</b> coins (${pct(threshold)}% of supply) takes all the SOL in it. Nobody, including you, can change the rule or withdraw. Opening it costs about 0.003 SOL in account rent and fees, which is not returned.`,
    async run(say) {
      const rent: number = await NET.rpc("getMinimumBalanceForRentExemption", [VAULT_SIZE]);
      const made = openInstructions({ program: new PublicKey(BURN.programId), payer: w, mint: c.mint, threshold, label, rentLamports: rent });
      const signature = await signAndSend(NET, w, new Transaction().add(...made.instructions), [made.vault], say);
      await refresh();
      return `The vault is open. Its fee address is <b>${esc(made.vault.publicKey.toBase58())}</b>. Point the coin's fees at that address, or send SOL to it by hand. <a href="${NET.explorer("tx", signature)}" rel="noopener">See the transaction</a>.`;
    },
  };
}));
$("vaults").addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement;
  const c = t.closest<HTMLElement>("button.copy");
  if (c) return void copy(c, c.dataset.copy!, "Copy the fee address");
  const b = t.closest<HTMLElement>("button.burn");
  if (!b) return;
  void actions.burn.review(async () => {
    const { coin: k, wallet: w } = need();
    await refresh();
    const f = vaults.find((x) => x.address === b.dataset.vault);
    if (!f) throw new Error("That vault is no longer there.");
    const pot = potOf(f.lamports, f.v);
    if (pot <= 0n) throw new Error("That vault is empty right now, so there is nothing to take.");
    if (have < f.v.threshold) throw new Error(`Taking the pot means burning ${amountText(f.v.threshold, k.decimals)} coins. Your wallet holds ${amountText(have, k.decimals)}.`);
    return {
      html: `You are about to <b>burn ${amountText(f.v.threshold, k.decimals)}</b> of your coins for good, and receive the vault's <b>${sol(pot, 6)} SOL</b>. If someone else takes the pot first, nothing is burned and nothing is paid.`,
      async run(say) {
        const ix = burnInstruction({ program: new PublicKey(BURN.programId), vault: new PublicKey(f.address), mint: k.mint, tokens: tokenAccountOf(w, k.mint, k.tokenProgram), sender: w, tokenProgram: k.tokenProgram, leastLamports: pot });
        const signature = await signAndSend(NET, w, new Transaction().add(ix), [], say);
        await refresh();
        return `Burned. <b>${amountText(f.v.threshold, k.decimals)}</b> coins are gone from the supply and ${sol(pot, 6)} SOL was paid to your wallet. <a href="${NET.explorer("tx", signature)}" rel="noopener">See the transaction</a>.`;
      },
    };
  }).then(() => landed($("burn-say"), null, ""));
});

// ---- giveaways ----
interface Mine { account: string; title: string; coin: string; time: number }
const mineAll = (): Mine[] => { try { return JSON.parse(store("philcoin.giveaways") ?? "[]"); } catch { return []; } };
const drawLink = (account: string) => new URL(`../giveaway/?draw=${account}`, location.href).href;
function mine(): void {
  const list = mineAll().filter((m) => !coin || m.coin === coin.mint.toBase58());
  $("mine-wrap").hidden = list.length === 0;
  $("mine").innerHTML = list.map((m) => `<li><div class="l1"><b>${esc(m.title)}</b><span>${when(m.time)}</span></div><div class="l2"><a href="${esc(drawLink(m.account))}">Its page</a></div></li>`).join("");
}
let running: { account: PublicKey; target: number; entries: string[]; record: DrawRecord } | null = null, drawing = false;
$("give-review").addEventListener("click", () => actions.give.review(async () => {
  const { coin: c, wallet: w } = need();
  if (running) throw new Error("A giveaway from this page is still waiting for its draw. Finish that one first.");
  const cleaned = cleanEntries(($("g-entries") as HTMLTextAreaElement).value);
  const minutes = Number(val("g-delay")) || 1;
  const g: Giveaway = { title: val("g-title"), winners: Math.floor(Number(val("g-winners"))), delay: Math.round(minutes * 150), entries: cleaned.entries };
  if (!g.title) throw new Error("Give the giveaway a title.");
  if (!Number.isFinite(g.winners)) throw new Error("Enter how many winners there are.");
  let record = buildRecord(g);
  if (record.payload.length > MAX_ONE_TX_PAYLOAD) record = buildRecord(g, 2);
  const whole = record.kind === 1;
  return {
    html: `<b>${n(g.entries.length)}</b> entries${cleaned.repeats ? ` (${n(cleaned.repeats)} repeat${cleaned.repeats === 1 ? "" : "s"} removed)` : ""}, <b>${g.winners}</b> winner${g.winners === 1 ? "" : "s"}, drawn about ${minutes === 1 ? "a minute" : minutes === 60 ? "an hour" : `${minutes} minutes`} after the list is locked. ${whole ? "The whole list goes on Solana." : "The list is too long to put on Solana whole, so its fingerprint is locked instead. <b>Publish the exact list yourself</b> so people can check it against the fingerprint."} Once locked, the list cannot be changed. ${minutes > 1 ? "<b>Come back to this page at draw time:</b> the draw must be sent within about three minutes of its block, or the giveaway ends with no winner. " : "Keep this page open until the draw. "}It costs about 0.003 SOL.`,
    async run(say) {
      const rent: number = await NET.rpc("getMinimumBalanceForRentExemption", [DRAW_SIZE]);
      const made = lockGiveawayInstructions({ program: new PublicKey(DRAW.programId), payer: w, payload: record.payload, rentLamports: rent });
      const signature = await signAndSend(NET, w, new Transaction().add(...made.instructions), [made.account], say);
      const account = made.account.publicKey;
      store("philcoin.giveaways", JSON.stringify([{ account: account.toBase58(), title: g.title, coin: c.mint.toBase58(), time: now() }, ...mineAll()].slice(0, 50)));
      store(`philcoin.list.${Array.from(record.listDigest, (x) => x.toString(16).padStart(2, "0")).join("")}`, g.entries.join("\n"));
      mine();
      const d = await readDraw(account);
      running = { account, target: d?.targetSlot ?? 0, entries: g.entries, record };
      $("g-run").hidden = false; $("g-won").innerHTML = "";
      void wait();
      return `The list is locked. <a href="${NET.explorer("tx", signature)}" rel="noopener">See the transaction</a>. Share the giveaway's page now, before the draw: <a href="${esc(drawLink(account.toBase58()))}">${esc(drawLink(account.toBase58()))}</a>`;
    },
  };
}));
async function readDraw(account: PublicKey) {
  for (let i = 0; i < 6; i++) {
    const info = (await NET.rpc("getAccountInfo", [account.toBase58(), { encoding: "base64", commitment: "confirmed" }])).value;
    const d = info ? decodeDraw(bytesOf(info.data[0])) : null;
    if (d && d.state !== "empty") return d;
    await sleep(1200);
  }
  return null;
}
/** Counts down to the winning block, then asks the wallet for the draw. */
async function wait(): Promise<void> {
  const r = running;
  const go = $("g-draw") as HTMLButtonElement;
  go.disabled = true;
  while (r && running === r) {
    let slot: number;
    try { slot = await NET.rpc("getSlot", [{ commitment: "confirmed" }]); } catch { await sleep(5000); continue; }
    const left = r.target + 2 - slot;
    if (left <= 0) {
      $("g-status").innerHTML = slot > r.target + DRAW_WINDOW_SLOTS ? "The window for this draw has passed. Sending the draw now will mark the giveaway as expired, with no winner." : "The winning block has been produced. Send the draw now: your wallet will ask you to sign.";
      go.disabled = false;
      if (slot <= r.target + DRAW_WINDOW_SLOTS) void draw();
      return;
    }
    $("g-status").innerHTML = `Locked. The block at slot <b>${n(r.target)}</b> picks the winner, in about <b>${untilText(Math.ceil(left * 0.4)).replace(/^in /, "")}</b>. Nobody knows that block yet.`;
    await sleep(Math.min(30000, Math.max(2500, left * 200)));
  }
}
async function draw(): Promise<void> {
  const r = running;
  if (!r || !wallet || drawing) return;
  const go = $("g-draw") as HTMLButtonElement, say = (s: string) => { $("g-note").textContent = s; };
  drawing = true; go.classList.add("busy");
  try {
    await signAndSend(NET, wallet, new Transaction().add(drawInstruction(new PublicKey(DRAW.programId), r.account)), [], say);
    const d = await readDraw(r.account);
    if (d?.state === "drawn") {
      const won = winnersOf(d, r.entries);
      $("g-status").className = "say good"; $("g-status").innerHTML = `Drawn by the block at slot <b>${n(d.hashSlot)}</b>. Anyone can check it on <a href="${esc(drawLink(r.account.toBase58()))}">the giveaway's page</a>.`;
      $("g-won").innerHTML = won.map((x, i) => `<div><b>${esc(x.entry)}</b><span class="muted">${won.length > 1 ? `winner ${i + 1} · ` : ""}entry ${n(x.index + 1)} of ${n(d.count)}</span></div>`).join("");
      say("Confirmed by Solana"); running = null; go.disabled = true;
      landed($("g-won"), null, "");
    } else if (d?.state === "expired") { $("g-status").className = "say bad"; $("g-status").textContent = "The draw came too late. This giveaway expired with no winner and can never produce one. Run a new one."; running = null; go.disabled = true; say(""); }
    else say("Solana has not shown the result yet. Press Draw now again in a moment.");
  } catch (e: any) { say(/too early/i.test((e?.logs ?? []).join(" ")) ? "A moment too early. Press Draw now again." : explain(e)); }
  drawing = false; go.classList.remove("busy");
}
$("g-draw").addEventListener("click", () => { void draw(); });
$("g-copy").addEventListener("click", () => { if (running) void copy($("g-copy"), drawLink(running.account.toBase58()), "Copy the giveaway's link"); });

// ---- the page ----
const demos: [string, string][] = [];
if (LOCK_DEMO?.mint) demos.push(["Demo coin with locks", LOCK_DEMO.mint]);
if (BURN_DEMO?.mint) demos.push(["Demo coin with a burn vault", BURN_DEMO.mint]);
$("demos").innerHTML = demos.map(([label, mint]) => `<button type="button" data-mint="${esc(mint)}">${esc(label)}</button>`).join("");
document.querySelectorAll<HTMLButtonElement>("#demos button").forEach((b) => b.addEventListener("click", () => { ($("coin") as HTMLInputElement).value = b.dataset.mint!; void open(); }));
const facts: [string, string][] = [];
for (const [name, p, dir] of [["Locker", LOCKER, "locker"], ["Burn vault", BURN, "burn"], ["Giveaways", DRAW, "giveaway"]] as [string, any, string][])
  if (p?.programId) facts.push([name, `<a href="${NET.explorer("address", p.programId)}" rel="noopener">${esc(p.programId)}</a>${p.checkedOn ? ` · last proven on ${NET.name} ${esc(p.checkedOn)}` : ""} · <a href="https://github.com/philcoinhigh/Phil-tools/tree/main/${dir}">source</a>`]);
facts.push(["Same code", "the transactions this page builds are the ones the nightly runs send to a real validator"]);
$("p-facts").innerHTML = facts.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join("");
if (!provider()) $("who").textContent = "Reading needs no wallet. To lock, open a vault or run a giveaway, open this page in a wallet's browser.";
const asked = new URLSearchParams(location.search).get("coin");
if (asked) { ($("coin") as HTMLInputElement).value = asked; void open(); }
wireFooter();
