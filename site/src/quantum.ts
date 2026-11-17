// The quantum-safe vault's page: the one rule shown in a sandbox and in Phil, and a real vault on
// Solana opened by a hash-based one-time signature. A wallet only ever pays the deposit and the fee.
import { PublicKey, Transaction } from "@solana/web3.js";
import { PROGRAM, DEMO, LOCKED } from "./qvault-data";
import { esc, landed, store, runPhil, highlightHtml, KIND_TITLE, CONTRACT } from "./shared";
import { wireFooter } from "./foot";
import { hex, unhex, sha256, concat } from "./draw";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { chain, bytesOf, short, when, key, connectWallet, noWalletHtml, signAndSend, simulateOnly, explain, units, coinInfo } from "./wallet";
import { N, CHAINS, keyRoot, sign, rootFromSignature, positions, spendDigest, step, makeSpend, makeCancel, decodeQVault, spendData, NO_NEXT_KEY, QVault, QVAULT_SIZE } from "./wots";
import { openVaultInstructions, spendInstructions, finishInstructions, cancelInstructions, depositTokenInstructions, createTokenAccount, tokenAccountOf, tokenAuthority, programDataAddress, upgradeAuthority, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "./qvault-tx";

const NET = chain(PROGRAM?.network ?? "devnet", PROGRAM?.rpc ?? "https://api.devnet.solana.com");
const $ = (id: string) => document.getElementById(id)!;
const val = (id: string) => ($(id) as HTMLInputElement).value.trim();
const live = !!PROGRAM?.programId;
const randomBytes = (n: number) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; };
const solText = (lamports: bigint) => { const s = (Number(lamports) / 1e9).toFixed(6).replace(/0+$/, "").replace(/\.$/, ""); return s || "0"; };

// ================= the one rule, in a sandbox =================
interface Signed { digest: Uint8Array; positions: number[]; signature: Uint8Array; amount: number }
let sandboxSeed = randomBytes(32), signed: Signed[] = [];
const SANDBOX_VAULT = sha256(new TextEncoder().encode("sandbox vault")), SANDBOX_YOU = sha256(new TextEncoder().encode("you")), SANDBOX_THIEF = sha256(new TextEncoder().encode("thief"));
const lowest = () => Array.from({ length: CHAINS }, (_, c) => Math.min(...signed.map((s) => s.positions[c])));
function sandbox(): void {
  const total = CHAINS * 255, exposed = signed.length ? lowest().reduce((t, c) => t + (255 - c), 0) : 0;
  ($("sb-bar") as HTMLElement).style.width = `${Math.round((exposed / total) * 100)}%`;
  $("sb-sign").textContent = signed.length ? "Sign another with the same key" : "Sign a payment";
  ($("sb-forge") as HTMLButtonElement).disabled = signed.length < 2;
  $("sb-list").innerHTML = signed.map((s, i) => `<li>signature ${i + 1}: pay ${s.amount} · ${hex(s.signature.slice(0, 10))}…</li>`).join("");
  const say = $("sb-say");
  say.className = "say" + (signed.length === 1 ? " good" : signed.length > 1 ? " bad" : "");
  say.innerHTML = signed.length === 0 ? "Nothing signed yet. One signature is safe."
    : signed.length === 1 ? `One signature. A forger can hash forward from it, but the checksum chains would then have to go backward, which nobody can do. <b>Safe.</b>`
    : `<b>${signed.length} signatures from one key.</b> A forger now holds every chain at the lowest point any of them revealed: ${Math.round((exposed / total) * 100)}% of all the steps. Each further signature makes a forgery easier to find.`;
}
$("sb-sign").addEventListener("click", () => {
  const amount = 1 + signed.length;
  const digest = spendDigest({ vault: SANDBOX_VAULT, recipient: SANDBOX_YOU, amount: BigInt(amount), nextRoot: NO_NEXT_KEY, counter: 0n, salt: BigInt(signed.length) });
  signed.push({ digest, positions: positions(digest), signature: sign(sandboxSeed, 0n, digest), amount });
  sandbox();
});
$("sb-reset").addEventListener("click", () => { sandboxSeed = randomBytes(32); signed = []; sandbox(); });
$("sb-forge").addEventListener("click", () => {
  const low = lowest(), root = keyRoot(sandboxSeed, 0n), TRIES = 60000;
  let found: Uint8Array | null = null, tries = 0;
  for (; tries < TRIES && !found; tries++) {
    const d = spendDigest({ vault: SANDBOX_VAULT, recipient: SANDBOX_THIEF, amount: 1_000_000n, nextRoot: NO_NEXT_KEY, counter: 0n, salt: BigInt(tries) });
    if (positions(d).every((c, k) => c >= low[k])) found = d;
  }
  const say = $("sb-say");
  if (!found) { say.className = "say"; say.innerHTML = `No forgery in ${TRIES.toLocaleString("en-GB")} tries, this time. With ${signed.length} signatures it takes luck or more tries; sign again and it gets much easier.`; return; }
  // Built with no secret: start each chain from whichever signature stood lowest, and hash forward.
  const forged = concat(...positions(found).map((c, k) => { const from = signed.find((s) => s.positions[k] === low[k])!; let x = from.signature.slice(k * N, (k + 1) * N); for (let j = low[k]; j < c; j++) x = step(k, j, x); return x; }));
  const works = hex(rootFromSignature(forged, found)) === hex(root);
  say.className = "say bad";
  say.innerHTML = works ? `<b>Forged, after ${tries.toLocaleString("en-GB")} tries.</b> This signature pays 1,000,000 to the thief and checks against your key's fingerprint, and it was made without your secret: ${hex(forged.slice(0, 10))}… That is why a key signs once.` : "The forgery did not check. That should not happen.";
});
sandbox();

// The same rule in Phil.
const BROKEN = `record OneTimeKey mode linear {
  secret : U64
}

callable Sign(message : U64, key : OneTimeKey) -> U64 {
  outcomes { success U64 };
}

// A stand-in for the real signature maths. Signing uses the key up.
fn sign(message : U64, key : OneTimeKey) -> U64 satisfies Sign {
  let OneTimeKey { secret } = key;
  return message + secret;
}

component main provides U64 {
  let key = construct OneTimeKey { secret = 7741 };
  let first = sign(100, key);
  let second = sign(200, key);
  return first + second;
}
`;
const FIXED = BROKEN.replace("  let key = construct OneTimeKey { secret = 7741 };\n  let first = sign(100, key);\n  let second = sign(200, key);", "  let key = construct OneTimeKey { secret = 7741 };\n  let next = construct OneTimeKey { secret = 90210 };\n  let first = sign(100, key);\n  let second = sign(200, next);");
let fixedNow = false;
function philDemo(): void {
  const src = fixedNow ? FIXED : BROKEN, o = runPhil(src, {});
  $("phil-demo").innerHTML = `<pre class="code">${highlightHtml(src, o.ok ? undefined : o.span)}</pre>`
    + `<div class="says${o.ok ? " good" : ""}">${o.ok ? `<b>Ran to completion</b>${esc(o.returns.map((r) => `hands back ${r.text}`).join(" · "))}` : `<b>${esc(KIND_TITLE[o.kind] ?? o.kind)}${o.line ? `, line ${o.line}` : ""}</b>${esc(o.message)}`}</div>`
    + `<div class="row"><button type="button" class="btn ghost small" id="phil-flip">${fixedNow ? "Show the mistake again" : "Show the working version"}</button><span class="muted" style="font-size:13.5px">Run in our own simulator of Phil, in this browser.</span></div>`;
  $("phil-flip").addEventListener("click", () => { fixedNow = !fixedNow; philDemo(); });
}
philDemo();

// ================= is a wallet exposed? =================
const MAIN = chain("mainnet", "https://api.mainnet-beta.solana.com");
$("ex-check").addEventListener("click", async () => {
  const out = $("ex-say"), b = $("ex-check") as HTMLButtonElement;
  out.hidden = false;
  let who: PublicKey;
  try { who = key(val("ex-address"), "Solana address"); } catch (e: any) { out.className = "say bad"; out.textContent = String(e?.message ?? e); return; }
  if (!PublicKey.isOnCurve(who.toBytes())) {
    out.className = "say good";
    out.innerHTML = "<b>No key to break.</b> This address belongs to a program, not to a private key, so there is no key for a quantum computer to work out. What matters here is the program's own rules, and who can change the program.";
    return;
  }
  b.classList.add("busy");
  let behind = "";
  try {
    const lamports = BigInt((await MAIN.rpc("getBalance", [who.toBase58(), { commitment: "confirmed" }])).value);
    let coins = 0, phil = "";
    for (const program of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
      const list = (await MAIN.rpc("getTokenAccountsByOwner", [who.toBase58(), { programId: program.toBase58() }, { encoding: "jsonParsed", commitment: "confirmed" }]))?.value ?? [];
      for (const t of list) { const i = t.account?.data?.parsed?.info; if (!i || i.tokenAmount?.amount === "0") continue; coins++; if (i.mint === CONTRACT) phil = String(i.tokenAmount.uiAmountString); }
    }
    behind = ` Behind this key on mainnet right now: <b>${solText(lamports)} SOL</b>${coins ? ` and <b>${coins}</b> coin${coins === 1 ? "" : "s"}${phil ? `, including <b>${esc(Number(phil).toLocaleString("en-GB"))} Philcoin</b>` : ""}` : ""}.`;
  } catch (e: any) { behind = ` Its balances could not be read just now (${esc(String(e?.message ?? e))}). The answer does not depend on them.`; }
  b.classList.remove("busy");
  out.className = "say";
  out.innerHTML = `<b>Exposed, like every Solana wallet.</b> On Solana an address is the public key itself, so there is nothing still hidden: a quantum computer able to break these keys could sign as this wallet.${behind} No such computer exists today, and nothing here is urgent. Funds moved into a hash-based vault are no longer behind this key.`;
  landed(out, null, "");
});

// ================= the vault on Solana =================
interface Held { mint: string; tokenProgram: string; decimals: number; amount: bigint }
interface Pending { counter: string; recipient: string; toWallet: string; amount: string; closing: boolean; record: string; mint: string | null; tokenProgram: string | null; decimals: number; delayed: boolean }
interface PreparedCancel { guardCounter: string; record: string; newSeed: string }
let wallet: PublicKey | null = null, address: PublicKey | null = null, program: PublicKey | null = null, vault: QVault | null = null, lamports = 0n, held: Held[] = [];
let seed: Uint8Array | null = null, keyIndex: bigint | null = null, pending: Pending | null = null, prepared: PreparedCancel | null = null;
let newSeed: Uint8Array | null = null, newGuard: Uint8Array | null = null, newVault: Keypair | null = null;
const seedKey = (a: string) => `philcoin.qvault.seed.${a}`, pendingKey = (a: string) => `philcoin.qvault.pending.${a}`, cancelKey = (a: string) => `philcoin.qvault.cancel.${a}`;
const KNOWN: string[] = [PROGRAM?.programId, ...((LOCKED ?? []) as any[]).map((l) => l.programId)].filter(Boolean);
const NEWEST: string | null = (LOCKED as any[] | null)?.[0]?.programId ?? PROGRAM?.programId ?? null;
const balanceOf = () => (vault ? lamports - vault.reserve : 0n);
const coinName = (mint: string | null) => (mint === null ? "SOL" : mint === CONTRACT ? "Philcoin" : `coin ${short(mint)}`);
const text = (amount: bigint, decimals: number) => { const s = amount.toString().padStart(decimals + 1, "0"), whole = s.slice(0, s.length - decimals), part = decimals ? s.slice(-decimals).replace(/0+$/, "") : ""; return Number(whole).toLocaleString("en-GB") + (part ? "." + part : ""); };
const phrase = (b: Uint8Array) => hex(b).replace(/(.{8})/g, "$1 ").trim();
const isPhrase = (t: string) => /^[0-9a-fA-F]{64}$/.test(t.replace(/\s/g, ""));
const fromPhrase = (t: string) => unhex(t.replace(/\s/g, "").toLowerCase());
const howLong = (s: number) => (s % 86400 === 0 ? `${s / 86400} day${s === 86400 ? "" : "s"}` : s % 3600 === 0 ? `${s / 3600} hour${s === 3600 ? "" : "s"}` : s % 60 === 0 ? `${s / 60} minute${s === 60 ? "" : "s"}` : `${s} second${s === 1 ? "" : "s"}`);

// Who can still change a program: read from Solana, never assumed.
const authorities = new Map<string, string>();
async function whoCanChange(id: string): Promise<string> {
  if (authorities.has(id)) return authorities.get(id)!;
  let say = "could not be read just now";
  try {
    const info = (await NET.rpc("getAccountInfo", [programDataAddress(new PublicKey(id)).toBase58(), { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 45 } }])).value;
    const a = info ? upgradeAuthority(bytesOf(info.data[0])) : undefined;
    if (a !== undefined) { say = a === null ? "locked: nobody can change it" : `can still be replaced by ${short(a.toBase58())}`; authorities.set(id, say); }
  } catch { /* said below */ }
  return say;
}

async function read(): Promise<void> {
  const info = (await NET.rpc("getAccountInfo", [address!.toBase58(), { encoding: "base64", commitment: "confirmed" }])).value;
  const v = info && KNOWN.includes(info.owner) ? decodeQVault(bytesOf(info.data[0])) : null;
  if (!v) throw new Error(`There is no vault at that address on ${NET.name}.`);
  vault = v; lamports = BigInt(info.lamports); program = new PublicKey(info.owner);
  const authority = tokenAuthority(program, address!).address.toBase58(), found: Held[] = [];
  for (const tp of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    try {
      const list = (await NET.rpc("getTokenAccountsByOwner", [authority, { programId: tp.toBase58() }, { encoding: "jsonParsed", commitment: "confirmed" }]))?.value ?? [];
      for (const t of list) { const i = t.account?.data?.parsed?.info; if (i && BigInt(i.tokenAmount.amount) > 0n) found.push({ mint: i.mint, tokenProgram: tp.toBase58(), decimals: i.tokenAmount.decimals, amount: BigInt(i.tokenAmount.amount) }); }
    } catch { /* a node that will not list them: the vault's SOL is still shown */ }
  }
  held = found;
  // Which of the phrase's keys is the vault's current one. It is the counter, unless the vault was re-keyed while its counter moved.
  keyIndex = null;
  if (seed && v.state === "open") for (let back = 0n; back <= 4n && back <= v.counter && keyIndex === null; back++) if (hex(keyRoot(seed, v.counter - back)) === hex(v.root)) keyIndex = v.counter - back;
}
function show(): void {
  const v = vault!, a = address!.toBase58(), mine = keyIndex !== null;
  const rows: [string, string][] = [["SOL", `<b>${solText(balanceOf())}</b>`], ...held.map((h) => [esc(coinName(h.mint)), `<b>${text(h.amount, h.decimals)}</b>`] as [string, string])];
  rows.push(["Vault", `<a href="${NET.explorer("address", a)}" rel="noopener">${esc(short(a))}</a>`],
    ["Status", v.state === "closed" ? "closed: emptied, and it has no further key" : `open, on key number ${v.counter + 1n}`],
    ["Withdrawals", v.delay ? `wait ${howLong(v.delay)}, and the guard key can cancel` : v.guardRoot ? "paid at once; a guard key can re-key" : "paid at once"],
    ["Program", `<span id="kv-program">${esc(authorities.get(program!.toBase58()) ?? "checking who can change it…")}</span>`]);
  if (v.cancels > 0n) rows.push(["Re-keyed by the guard", `${v.cancels} time${v.cancels === 1n ? "" : "s"}`]);
  if (v.lastTime > 0) rows.push(["Last payment", `to ${esc(short(new PublicKey(v.lastRecipient).toBase58()))} on ${when(v.lastTime)}`]);
  rows.push(["This browser", !seed ? "does not have this vault's phrase: it can watch, not spend" : mine ? "holds the phrase for the current key" : "holds a phrase that does not match this vault"]);
  $("kv").innerHTML = rows.map(([k, x]) => `<li><span>${k}</span><span>${x}</span></li>`).join("");
  void whoCanChange(program!.toBase58()).then((say) => { const el = document.getElementById("kv-program"); if (el) el.textContent = say; });
  $("vault-none").hidden = true; $("vault-view").hidden = false;

  // A withdrawal that is waiting out the vault's delay.
  const w = v.pending, wMint = w && w.mint.some((x) => x) ? new PublicKey(w.mint).toBase58() : null;
  $("waiting").hidden = !w; $("waiting-row").hidden = !w;
  if (w) {
    const h = held.find((x) => x.mint === wMint), amount = wMint === null ? `${solText(w.amount)} SOL` : h ? `${text(w.amount, h.decimals)} ${esc(coinName(wMint))}` : `${w.amount} units of ${esc(coinName(wMint))}`;
    const ready = Date.now() / 1000 >= w.ready;
    $("waiting").className = "say";
    $("waiting").innerHTML = `<b>A withdrawal is waiting:</b> ${amount} to ${esc(short(new PublicKey(w.recipient).toBase58()))}${wMint ? " (a token account)" : ""}. ${ready ? "Its waiting time has passed, and anyone can complete it." : `It can be completed after <b>${when(w.ready)}</b>.`}${v.guardRoot ? " If you did not sign it, cancel it below with the guard phrase." : ""}`;
    ($("finish") as HTMLButtonElement).disabled = !ready;
  }
  $("add-address").innerHTML = `SOL can also be sent straight to the vault's address, <code>${esc(a)}</code>. Coins go to the vault's own token account, so use this form for those.`;
  ($("add") as HTMLElement).hidden = v.state === "closed";

  // A spend signed with the current key is the only thing that key may ever send.
  try { pending = JSON.parse(store(pendingKey(a)) ?? "null"); } catch { pending = null; }
  if (pending && pending.counter !== String(v.counter)) { pending = null; store(pendingKey(a), ""); }
  const canSpend = v.state === "open" && mine && !w;
  const coin = $("coin") as HTMLSelectElement, was = coin.value;
  coin.innerHTML = `<option value="">SOL (${solText(balanceOf())})</option>` + held.map((h) => `<option value="${esc(h.mint)}">${esc(coinName(h.mint))} (${text(h.amount, h.decimals)})</option>`).join("");
  if ([...coin.options].some((o) => o.value === was)) coin.value = was;
  $("all-wrap").hidden = !!v.delay || held.length > 0 || coin.value !== "";
  $("spend-wrap").hidden = v.state === "closed";
  $("spend-form").hidden = !canSpend || !!pending;
  $("spend-need").textContent = v.state === "closed" ? "" : w ? "One withdrawal at a time: this vault has one waiting." : !mine ? "Spending needs this vault's recovery phrase. Open it again with the phrase to spend." : pending ? "" : v.delay ? `The wallet you connect only pays the network fee. A signed withdrawal is paid after ${howLong(v.delay)}.` : "The wallet you connect only pays the network fee. The one-time key is what moves the money.";
  $("pending").hidden = !pending || !canSpend;
  if (pending && canSpend) $("pending-say").innerHTML = `<b>Signed with key number ${v.counter + 1n}:</b> pay <b>${pending.mint ? text(BigInt(pending.amount), pending.decimals) : solText(BigInt(pending.amount))} ${esc(coinName(pending.mint))}</b> to <b>${esc(short(pending.toWallet))}</b>${pending.closing ? ", and close the vault" : ""}${pending.delayed ? `, after ${howLong(v.delay)}` : ""}. This key can only ever send this. It is saved in this browser until Solana confirms it.`;
  if (wallet && !val("to")) ($("to") as HTMLInputElement).value = wallet.toBase58();

  // The guard key.
  try { prepared = JSON.parse(store(cancelKey(a)) ?? "null"); } catch { prepared = null; }
  if (prepared && prepared.guardCounter !== String(v.guardCounter)) { prepared = null; store(cancelKey(a), ""); }
  ($("rekey") as HTMLElement).hidden = !v.guardRoot || v.state === "closed";
  $("rekey-form").hidden = !!prepared; $("rekey-ready").hidden = !prepared;
  if (prepared) { $("rekey-seed").textContent = phrase(unhex(prepared.newSeed)); ($("rekey") as HTMLDetailsElement).open = true; }
  ($("print-view") as HTMLElement).hidden = !seed || !mine;
  try { history.replaceState(null, "", `?vault=${a}`); } catch { /* sandboxed */ }
}
$("coin").addEventListener("change", () => { $("all-wrap").hidden = !!vault?.delay || held.length > 0 || val("coin") !== ""; });
async function openVault(textIn: string, phraseIn: string): Promise<void> {
  const b = $("open") as HTMLButtonElement; let note = "";
  b.classList.add("busy");
  try {
    if (!live) throw new Error("The vault program is not on Solana yet.");
    address = key(textIn, "vault address");
    if (phraseIn) { if (!isPhrase(phraseIn)) throw new Error("A recovery phrase is 64 characters, 0-9 and a-f."); store(seedKey(address.toBase58()), hex(fromPhrase(phraseIn))); }
    const kept = store(seedKey(address.toBase58()));
    seed = kept ? unhex(kept) : null;
    await read(); show(); note = "Read from Solana just now";
  } catch (e: any) { note = String(e?.message ?? e); address = null; }
  b.classList.remove("busy");
  landed(address ? $("kv") : $("open"), $("open-note"), note);
}
const again = async (noteId: string) => { try { await read(); show(); $(noteId).textContent = "Read from Solana just now"; } catch (e: any) { $(noteId).textContent = String(e?.message ?? e); } };
$("open").addEventListener("click", () => { void openVault(val("open-address"), val("open-seed")); });
$("refresh").addEventListener("click", () => { void again("view-note"); });
$("leave").addEventListener("click", () => { address = null; vault = null; seed = null; pending = null; prepared = null; $("vault-view").hidden = true; $("vault-none").hidden = false; ($("spend-done") as HTMLElement).hidden = true; try { history.replaceState(null, "", location.pathname); } catch { /* sandboxed */ } });
async function needWallet(): Promise<PublicKey> {
  if (wallet) return wallet;
  try { wallet = await connectWallet(); $("who").textContent = `Connected: ${short(wallet.toBase58())}. It pays fees only.`; $("connect").textContent = "Connected"; $("no-wallet").hidden = true; return wallet; }
  catch (e: any) { $("no-wallet").hidden = false; $("no-wallet").innerHTML = noWalletHtml(NET, e); throw new Error("Connect a wallet to pay the network fee."); }
}
$("connect").addEventListener("click", () => { void needWallet().then(() => { if (vault) show(); }).catch(() => {}); });

// ---- a backup on paper ----
function printSheet(vaultAddress: string, programId: string, main: Uint8Array | null, guard: Uint8Array | null): void {
  const page = location.origin + location.pathname, made = new Date().toLocaleDateString("en-GB", { dateStyle: "long" });
  const common = `<dt>Vault address</dt><dd>${esc(vaultAddress)}</dd><dt>Network</dt><dd>Solana ${esc(NET.name)}</dd><dt>Program</dt><dd>${esc(programId)}</dd><dt>Printed</dt><dd>${esc(made)}</dd>`;
  $("sheet").innerHTML = (main ? `<section><h1>Quantum-safe vault: recovery phrase</h1><p>Whoever holds this phrase can spend from the vault. Without it the funds cannot be moved by anyone.</p><dl>${common}<dt>Recovery phrase</dt><dd class="big">${esc(phrase(main))}</dd><dt>To use it</dt><dd>${esc(page)}<br>Open a vault by its address, and enter this phrase.</dd></dl></section>` : "")
    + (guard ? `<section><h1>Quantum-safe vault: guard phrase</h1><p>Keep this page apart from the recovery phrase. This phrase cannot spend. It cancels a waiting withdrawal and gives the vault a new recovery phrase.</p><dl>${common}<dt>Guard phrase</dt><dd class="big">${esc(phrase(guard))}</dd><dt>To use it</dt><dd>${esc(page)}<br>Open the vault, then "Phrase stolen? Cancel and re-key".</dd></dl></section>` : "");
  try { window.print(); } catch { /* no printer here */ }
}
$("print-new").addEventListener("click", () => { if (newSeed && newVault && NEWEST) printSheet(newVault.publicKey.toBase58(), NEWEST, newSeed, newGuard); });
$("print-view").addEventListener("click", () => { if (seed && address && program) printSheet(address.toBase58(), program.toBase58(), seed, null); });

// ---- make a vault ----
const guarded = () => ($("guarded") as HTMLInputElement).checked;
$("guarded").addEventListener("change", () => { $("delay-wrap").hidden = !guarded(); $("seed-wrap").hidden = true; newSeed = null; });
$("make-seed").addEventListener("click", () => {
  newSeed = randomBytes(32); newGuard = guarded() ? randomBytes(32) : null; newVault = Keypair.generate();
  $("seed").textContent = phrase(newSeed);
  $("guard-wrap").hidden = !newGuard; if (newGuard) $("guard-seed").textContent = phrase(newGuard);
  $("seed-ok-say").textContent = newGuard ? "I have saved both phrases, apart from each other, somewhere that is not this browser." : "I have saved this phrase somewhere that is not this browser.";
  $("seed-wrap").hidden = false; ($("seed-ok") as HTMLInputElement).checked = false; ($("create") as HTMLButtonElement).disabled = true;
});
$("seed-ok").addEventListener("change", () => { ($("create") as HTMLButtonElement).disabled = !($("seed-ok") as HTMLInputElement).checked; });
$("create").addEventListener("click", async () => {
  const b = $("create") as HTMLButtonElement, say = (t: string) => { $("create-note").textContent = t; };
  b.disabled = true; b.classList.add("busy");
  try {
    if (!live || !NEWEST) throw new Error("The vault program is not on Solana yet.");
    if (!newSeed || !newVault) throw new Error("Make the key first.");
    const deposit = units(val("deposit"), 9);
    if (deposit < 1_000_000n) throw new Error("Deposit at least 0.001 SOL.");
    const w = await needWallet();
    const rent: number = await NET.rpc("getMinimumBalanceForRentExemption", [QVAULT_SIZE]);
    const made = openVaultInstructions({ program: new PublicKey(NEWEST), payer: w, root: keyRoot(newSeed, 0n), rentLamports: rent, depositLamports: deposit,
      delaySeconds: newGuard ? Number(val("delay")) : 0, guardRoot: newGuard ? keyRoot(newGuard, 0n) : undefined }, newVault);
    store(seedKey(made.vault.publicKey.toBase58()), hex(newSeed));                 // kept before it is sent, so a vault can never exist without its phrase
    await signAndSend(NET, w, new Transaction().add(...made.instructions), [made.vault], say);
    say(""); newSeed = null; newGuard = null; newVault = null; $("seed-wrap").hidden = true; $("guard-seed").textContent = ""; ($("make") as HTMLDetailsElement).open = false;
    await openVault(made.vault.publicKey.toBase58(), "");
  } catch (e: any) { say(explain(e)); b.disabled = false; }
  b.classList.remove("busy");
});

// ---- add funds ----
$("add-send").addEventListener("click", async () => {
  const b = $("add-send") as HTMLButtonElement, say = (t: string) => { $("add-note").textContent = t; };
  b.classList.add("busy");
  try {
    const a = address!, w = await needWallet(), coinText = val("add-coin");
    if (!coinText || coinText.toUpperCase() === "SOL") {
      const amount = units(val("add-amount"), 9);
      if (amount <= 0n) throw new Error("The amount must be more than zero.");
      await signAndSend(NET, w, new Transaction().add(SystemProgram.transfer({ fromPubkey: w, toPubkey: a, lamports: amount })), [], say);
    } else {
      const c = await coinInfo(NET, coinText), amount = units(val("add-amount"), c.decimals);
      if (amount <= 0n) throw new Error("The amount must be more than zero.");
      await signAndSend(NET, w, new Transaction().add(...depositTokenInstructions(program!, a, w, c.mint, c.tokenProgram, amount, c.decimals)), [], say);
    }
    ($("add-amount") as HTMLInputElement).value = "";
    await read(); show(); say("Deposited. The vault's balances above were read from Solana just now.");
  } catch (e: any) { say(explain(e)); }
  b.classList.remove("busy");
});

// ---- spend ----
$("all").addEventListener("change", () => { const all = ($("all") as HTMLInputElement).checked; ($("amount") as HTMLInputElement).disabled = all; if (all) ($("amount") as HTMLInputElement).value = solText(balanceOf()); });
$("sign").addEventListener("click", () => {
  const note = $("sign-note");
  try {
    const v = vault!, a = address!, h = held.find((x) => x.mint === val("coin")) ?? null;
    if (pending) throw new Error("This key has already signed a spend. Send that one.");
    if (keyIndex === null || !seed) throw new Error("This browser does not hold the vault's phrase.");
    const everything = !h && !v.delay && held.length === 0 && ($("all") as HTMLInputElement).checked;
    const have = h ? h.amount : balanceOf(), decimals = h ? h.decimals : 9;
    const amount = everything ? have : units(val("amount"), decimals), to = key(val("to"), "wallet address");
    if (amount <= 0n) throw new Error("The amount must be more than zero.");
    if (amount > have) throw new Error(`The vault holds ${text(have, decimals)} ${coinName(h?.mint ?? null)}.`);
    if (to.equals(a)) throw new Error("The vault cannot pay itself.");
    // A vault with nothing else in it and no waiting time ends when its last SOL leaves; otherwise it always keeps a next key.
    const closing = !h && !v.delay && held.length === 0 && amount === have;
    const recipient = h ? tokenAccountOf(to, new PublicKey(h.mint), new PublicKey(h.tokenProgram)) : to;
    const s = makeSpend(seed, a.toBytes(), recipient.toBytes(), amount, v.counter, closing, h ? new PublicKey(h.mint).toBytes() : undefined, keyIndex);
    pending = { counter: String(v.counter), recipient: recipient.toBase58(), toWallet: to.toBase58(), amount: amount.toString(), closing, record: hex(s.record), mint: h?.mint ?? null, tokenProgram: h?.tokenProgram ?? null, decimals, delayed: v.delay > 0 };
    store(pendingKey(a.toBase58()), JSON.stringify(pending));                       // the key is now spent on this message, whether or not it ever lands
    note.textContent = ""; ($("steal-say") as HTMLElement).hidden = true; ($("spend-done") as HTMLElement).hidden = true;
    show(); landed($("pending-say"), null, "");
  } catch (e: any) { note.textContent = String(e?.message ?? e); }
});
const sideOf = (p: { mint: string | null; tokenProgram: string | null }) => (p.mint && p.tokenProgram ? { mint: new PublicKey(p.mint), tokenProgram: new PublicKey(p.tokenProgram) } : undefined);
$("send").addEventListener("click", async () => {
  const b = $("send") as HTMLButtonElement, say = (t: string) => { $("send-note").textContent = t; };
  if (!pending || !address || !program) return;
  b.disabled = true; b.classList.add("busy");
  try {
    const w = await needWallet(), p = pending, side = sideOf(p);
    if (side) {                                                                     // a coin is paid into the recipient's token account, which has to exist
      const there = (await NET.rpc("getAccountInfo", [p.recipient, { encoding: "base64", commitment: "confirmed" }])).value;
      if (!there) { say("First, the recipient's token account…"); await signAndSend(NET, w, new Transaction().add(createTokenAccount(w, new PublicKey(p.toWallet), side.mint, side.tokenProgram)), [], say); }
    }
    const signature = await signAndSend(NET, w, new Transaction().add(...spendInstructions(program, address, new PublicKey(p.recipient), unhex(p.record), undefined, side, p.delayed)), [], say);
    store(pendingKey(address.toBase58()), ""); pending = null; say("");
    await read(); show();
    const done = $("spend-done"), what = `${p.mint ? text(BigInt(p.amount), p.decimals) : solText(BigInt(p.amount))} ${esc(coinName(p.mint))}`;
    done.className = "say good"; done.hidden = false;
    done.innerHTML = (p.delayed ? `Signed and recorded: <b>${what}</b> to ${esc(short(p.toWallet))}. It can be completed after <b>${when(vault!.pending?.ready ?? 0)}</b>, and until then the guard phrase can cancel it.`
      : `Paid <b>${what}</b> to ${esc(short(p.toWallet))}.`) + ` The key that signed it is finished${vault!.state === "closed" ? " and the vault is closed" : `, and the vault is on key number ${vault!.counter + 1n}`}. The only wallet signature in that transaction paid the fee. <a href="${NET.explorer("tx", signature)}" rel="noopener">See the transaction</a>.`;
    landed(done, null, "");
  } catch (e: any) {
    // If the vault has already moved on, the spend landed: the same signed bytes can only ever land once.
    try { await read(); if (vault && String(vault.counter) !== pending?.counter) { store(pendingKey(address.toBase58()), ""); pending = null; show(); say("That spend had already landed."); b.disabled = false; b.classList.remove("busy"); return; } } catch { /* keep the error below */ }
    say(explain(e));
  }
  b.disabled = false; b.classList.remove("busy");
});
$("steal").addEventListener("click", async () => {
  const out = $("steal-say"), b = $("steal") as HTMLButtonElement;
  if (!pending || !address || !vault || !program) return;
  b.classList.add("busy");
  try {
    const payer = await needWallet();                                             // a dry run needs a funded fee payer, or it fails for the wrong reason
    const p = pending, record = unhex(p.record), thief = new PublicKey(sha256(randomBytes(32))), side = sideOf(p), to = new PublicKey(p.recipient);
    const amount = BigInt(p.amount), salt = new DataView(record.buffer, record.byteOffset).getBigUint64(13, true), next = record.slice(21, 53), sig = record.slice(53);
    const tries: [string, ReturnType<typeof spendInstructions>][] = [
      ["Send it to a thief's address instead", spendInstructions(program, address, thief, record, undefined, side, p.delayed)],
      ["Take a larger amount instead", spendInstructions(program, address, to, record, spendData(amount + 1n, salt, next, sig), side, p.delayed)],
      ["Swap the next key for the thief's", spendInstructions(program, address, to, record, spendData(amount, salt, keyRoot(thief.toBytes(), 1n), sig), side, p.delayed)],
    ];
    const lines: string[] = [];
    for (const [what, ixs] of tries) {
      const r = await simulateOnly(NET, payer, ixs), said = r.logs.filter((l) => l.startsWith("Program log: ")).map((l) => l.slice(13));
      if (r.failed && !said.length) throw new Error("The dry run did not reach the vault program. Check the connected wallet holds a little SOL on " + NET.name + ".");
      lines.push(`<li><b>${esc(what)}:</b> ${r.failed ? "refused" : "NOT refused, which should never happen"}. <span class="muted">${esc(said[said.length - 1] ?? "")}</span></li>`);
    }
    out.className = "say good"; out.hidden = false;
    out.innerHTML = `Three ways to misuse your signature now that it exists, run against the real program without sending anything:<ul style="margin:8px 0 0;padding-left:18px">${lines.join("")}</ul>The signature covers the recipient, the coin, the amount and the next key, so changing any of them leaves a signature that no longer checks.`;
  } catch (e: any) { out.className = "say bad"; out.hidden = false; out.textContent = String(e?.message ?? e); }
  b.classList.remove("busy"); landed(out, null, "");
});

// ---- a waiting withdrawal: complete it, or cancel it with the guard key ----
$("finish").addEventListener("click", async () => {
  const b = $("finish") as HTMLButtonElement, say = (t: string) => { $("finish-note").textContent = t; };
  if (!vault?.pending || !address || !program) return;
  b.classList.add("busy");
  try {
    const w = await needWallet(), p = vault.pending, token = p.mint.some((x) => x) ? await coinInfo(NET, new PublicKey(p.mint).toBase58()) : null;
    await signAndSend(NET, w, new Transaction().add(...finishInstructions(program, address, new PublicKey(p.recipient), token ? { mint: token.mint, tokenProgram: token.tokenProgram } : undefined)), [], say);
    await read(); show(); say(""); $("view-note").textContent = "Paid. Read from Solana just now.";
  } catch (e: any) { say(/custom program error: 0x70f|1807/i.test(String(e?.message ?? e) + (e?.logs ?? []).join(" ")) ? "Solana's clock says it is not time yet. Try again in a minute." : explain(e)); }
  b.classList.remove("busy");
});
$("rekey-make").addEventListener("click", () => {
  const note = $("rekey-note");
  try {
    const v = vault!, a = address!.toBase58();
    if (!isPhrase(val("guard-in"))) throw new Error("A guard phrase is 64 characters, 0-9 and a-f.");
    const guard = fromPhrase(val("guard-in"));
    if (hex(keyRoot(guard, v.guardCounter)) !== hex(v.guardRoot!)) throw new Error("That is not this vault's guard phrase.");
    const fresh = randomBytes(32);
    // The guard key signs once, like any other: what it signed is kept, and only that is ever sent.
    prepared = { guardCounter: String(v.guardCounter), record: hex(makeCancel(guard, address!.toBytes(), fresh, v.counter, v.guardCounter).record), newSeed: hex(fresh) };
    store(cancelKey(a), JSON.stringify(prepared));
    ($("guard-in") as HTMLInputElement).value = ""; note.textContent = "";
    ($("rekey-ok") as HTMLInputElement).checked = false; ($("rekey-send") as HTMLButtonElement).disabled = true;
    show();
  } catch (e: any) { note.textContent = String(e?.message ?? e); }
});
$("rekey-ok").addEventListener("change", () => { ($("rekey-send") as HTMLButtonElement).disabled = !($("rekey-ok") as HTMLInputElement).checked; });
$("rekey-send").addEventListener("click", async () => {
  const b = $("rekey-send") as HTMLButtonElement, say = (t: string) => { $("rekey-send-note").textContent = t; };
  if (!prepared || !address || !program) return;
  b.classList.add("busy");
  const a = address.toBase58(), p = prepared;
  const landedNow = () => { store(seedKey(a), p.newSeed); store(cancelKey(a), ""); store(pendingKey(a), ""); seed = unhex(p.newSeed); prepared = null; };
  try {
    const w = await needWallet();
    await signAndSend(NET, w, new Transaction().add(...cancelInstructions(program, address, unhex(p.record))), [], say);
    landedNow(); await read(); show();
    $("view-note").textContent = "Re-keyed. Nothing is waiting, the old phrase no longer works, and this browser holds the new one.";
    landed($("kv"), null, "");
  } catch (e: any) {
    try { await read(); if (vault && String(vault.guardCounter) !== p.guardCounter) { landedNow(); await read(); show(); say("That had already landed."); b.classList.remove("busy"); return; } } catch { /* keep the error below */ }
    say(explain(e));
  }
  b.classList.remove("busy");
});

// ---- the page ----
const locked: any = (LOCKED as any[] | null)?.[0] ?? null;
const facts: [string, string][] = [];
if (locked) facts.push(["Locked program", `<a href="${NET.explorer("address", locked.programId)}" rel="noopener">${esc(locked.programId)}</a><br><span id="f-locked">checking who can change it…</span>`]);
if (live) {
  facts.push([locked ? "First copy" : "Vault program", `<a href="${NET.explorer("address", PROGRAM.programId)}" rel="noopener">${esc(PROGRAM.programId)}</a>${locked ? "<br>can still be replaced by our deploy key" : ""}`]);
  if (PROGRAM.checkedOn) facts.push(["Last proven", `${esc(PROGRAM.checkedOn)}, on a local validator and on ${NET.name}`]);
  if (PROGRAM.selftest?.spendUnits) facts.push(["Cost of a spend", `${Number(PROGRAM.selftest.spendUnits).toLocaleString("en-GB")} compute units, for about ${Number(PROGRAM.selftest.hashSteps).toLocaleString("en-GB")} hash steps`]);
} else facts.push(["Vault program", "not deployed yet: the sandbox above works now"]);
facts.push(["Signature", "Winternitz one-time, 26 chains of 255 steps, SHA-256 kept to 192 bits: 624 bytes"]);
facts.push(["Source", `<a href="https://github.com/philcoinhigh/Phil-tools/tree/main/qvault">qvault/runtime.c</a> and <a href="https://github.com/philcoinhigh/Phil-tools/blob/main/site/src/wots.ts">wots.ts</a>, with their tests`]);
$("p-facts").innerHTML = facts.map(([k, x]) => `<li><span>${k}</span><span>${x}</span></li>`).join("");
if (locked) void whoCanChange(locked.programId).then((say) => { $("f-locked").textContent = say + " (read from Solana just now)"; });
$("which-program").textContent = locked ? `New vaults are made on the locked copy of the program (${short(locked.programId)}), which nobody can change.` : "The locked copy of the program is not deployed yet, so a new vault uses the first copy, which our deploy key can still replace.";
if (!locked) $("limit-lock").innerHTML = "<b>The program can still be replaced by our deploy key.</b> A locked copy that nobody can change, us included, is being deployed.";
const demoVaults: any[] = DEMO?.vaults ?? [];
$("demos").innerHTML = demoVaults.slice(0, 1).map((d) => `<button type="button" data-vault="${esc(d.vault)}">Last night's demonstration vault (${esc(d.day)})</button>`).join("");
document.querySelectorAll<HTMLButtonElement>("#demos button").forEach((b) => b.addEventListener("click", () => { ($("open-address") as HTMLInputElement).value = b.dataset.vault!; void openVault(b.dataset.vault!, ""); }));
if (!live) { ($("open") as HTMLButtonElement).disabled = true; ($("make-seed") as HTMLButtonElement).disabled = true; $("net").textContent = "Vault coming to Solana devnet · unaudited"; }
const asked = new URLSearchParams(location.search).get("vault");
if (asked) { ($("open-address") as HTMLInputElement).value = asked; void openVault(asked, ""); }
wireFooter();
