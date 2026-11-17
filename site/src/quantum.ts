// The quantum-safe vault's page: the one rule shown in a sandbox and in Phil, and a real vault on
// Solana opened by a hash-based one-time signature. A wallet only ever pays the deposit and the fee.
import { PublicKey, Transaction } from "@solana/web3.js";
import { PROGRAM, DEMO } from "./qvault-data";
import { esc, landed, store, runPhil, highlightHtml, KIND_TITLE } from "./shared";
import { wireFooter } from "./foot";
import { hex, unhex, sha256, concat } from "./draw";
import { chain, bytesOf, short, when, key, connectWallet, noWalletHtml, signAndSend, simulateOnly, explain, units } from "./wallet";
import { N, CHAINS, keyRoot, sign, rootFromSignature, positions, spendDigest, step, makeSpend, decodeQVault, spendData, NO_NEXT_KEY, QVault, QVAULT_SIZE } from "./wots";
import { openVaultInstructions, spendInstructions } from "./qvault-tx";

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

// ================= the vault on Solana =================
interface Pending { counter: string; recipient: string; amount: string; closing: boolean; record: string }
let wallet: PublicKey | null = null, address: PublicKey | null = null, vault: QVault | null = null, lamports = 0n, seed: Uint8Array | null = null, pending: Pending | null = null, newSeed: Uint8Array | null = null;
const seedKey = (a: string) => `philcoin.qvault.seed.${a}`, pendingKey = (a: string) => `philcoin.qvault.pending.${a}`;
const programId = () => new PublicKey(PROGRAM.programId);
const balanceOf = () => (vault ? lamports - vault.reserve : 0n);

async function read(): Promise<void> {
  const info = (await NET.rpc("getAccountInfo", [address!.toBase58(), { encoding: "base64", commitment: "confirmed" }])).value;
  const v = info && info.owner === PROGRAM.programId ? decodeQVault(bytesOf(info.data[0])) : null;
  if (!v) throw new Error(`There is no vault at that address on ${NET.name}.`);
  vault = v; lamports = BigInt(info.lamports);
}
function show(): void {
  const v = vault!, a = address!.toBase58(), mine = !!seed && hex(keyRoot(seed, v.counter)) === hex(v.root);
  const rows: [string, string][] = [
    ["Balance", `<b>${solText(balanceOf())}</b> SOL`],
    ["Vault", `<a href="${NET.explorer("address", a)}" rel="noopener">${esc(short(a))}</a>`],
    ["Status", v.state === "closed" ? "closed: emptied, and it has no further key" : `open, on key number ${v.counter + 1n}`],
    ["Current key's fingerprint", v.state === "closed" ? "none" : `${hex(v.root).slice(0, 16)}…`],
    ["Keys used so far", String(v.counter)],
  ];
  if (v.totalSpent > 0n) rows.push(["Paid out", `${solText(v.totalSpent)} SOL, last to ${esc(short(new PublicKey(v.lastRecipient).toBase58()))} on ${when(v.lastTime)}`]);
  rows.push(["This browser", !seed ? "does not have this vault's phrase: it can watch, not spend" : mine ? "holds the phrase for the current key" : "holds a phrase that does not match this vault"]);
  $("kv").innerHTML = rows.map(([k, x]) => `<li><span>${k}</span><span>${x}</span></li>`).join("");
  $("vault-none").hidden = true; $("vault-view").hidden = false;
  // A spend signed with the current key is the only thing that key may ever send.
  try { pending = JSON.parse(store(pendingKey(a)) ?? "null"); } catch { pending = null; }
  if (pending && pending.counter !== String(v.counter)) { pending = null; store(pendingKey(a), ""); }
  const canSpend = v.state === "open" && mine;
  $("spend-wrap").hidden = v.state === "closed";
  $("spend-form").hidden = !canSpend || !!pending;
  $("spend-need").textContent = v.state === "closed" ? "" : !canSpend ? "Spending needs this vault's recovery phrase. Open it again with the phrase to spend." : pending ? "" : "The wallet you connect only pays the network fee. The one-time key is what moves the money.";
  $("pending").hidden = !pending || !canSpend;
  if (pending && canSpend) $("pending-say").innerHTML = `<b>Signed with key number ${v.counter + 1n}:</b> pay <b>${solText(BigInt(pending.amount))} SOL</b> to <b>${esc(short(pending.recipient))}</b>${pending.closing ? ", and close the vault" : ""}. This key can only ever send this. It is saved in this browser until Solana confirms it.`;
  if (wallet && !val("to")) ($("to") as HTMLInputElement).value = wallet.toBase58();
  try { history.replaceState(null, "", `?vault=${a}`); } catch { /* sandboxed */ }
}
async function openVault(text: string, phrase: string): Promise<void> {
  const b = $("open") as HTMLButtonElement; let note = "";
  b.classList.add("busy");
  try {
    if (!live) throw new Error("The vault program is not on Solana yet.");
    address = key(text, "vault address");
    if (phrase) { if (!/^[0-9a-fA-F]{64}$/.test(phrase)) throw new Error("A recovery phrase is 64 characters, 0-9 and a-f."); store(seedKey(address.toBase58()), phrase.toLowerCase()); }
    const kept = store(seedKey(address.toBase58()));
    seed = kept ? unhex(kept) : null;
    await read(); show(); note = "Read from Solana just now";
  } catch (e: any) { note = String(e?.message ?? e); address = null; }
  b.classList.remove("busy");
  landed(address ? $("kv") : $("open"), $("open-note"), note);
}
$("open").addEventListener("click", () => { void openVault(val("open-address"), val("open-seed")); });
$("refresh").addEventListener("click", async () => { try { await read(); show(); $("view-note").textContent = "Read from Solana just now"; } catch (e: any) { $("view-note").textContent = String(e?.message ?? e); } });
$("leave").addEventListener("click", () => { address = null; vault = null; seed = null; pending = null; $("vault-view").hidden = true; $("vault-none").hidden = false; ($("spend-done") as HTMLElement).hidden = true; try { history.replaceState(null, "", location.pathname); } catch { /* sandboxed */ } });
async function needWallet(): Promise<PublicKey> {
  if (wallet) return wallet;
  try { wallet = await connectWallet(); $("who").textContent = `Connected: ${short(wallet.toBase58())}. It pays fees only.`; $("connect").textContent = "Connected"; $("no-wallet").hidden = true; return wallet; }
  catch (e: any) { $("no-wallet").hidden = false; $("no-wallet").innerHTML = noWalletHtml(NET, e); throw new Error("Connect a wallet to pay the network fee."); }
}
$("connect").addEventListener("click", () => { void needWallet().then(() => { if (vault) show(); }).catch(() => {}); });

// ---- make a vault ----
$("make-seed").addEventListener("click", () => {
  newSeed = randomBytes(32);
  $("seed").textContent = hex(newSeed).replace(/(.{8})/g, "$1 ").trim();
  $("seed-wrap").hidden = false; ($("seed-ok") as HTMLInputElement).checked = false; ($("create") as HTMLButtonElement).disabled = true;
});
$("seed-ok").addEventListener("change", () => { ($("create") as HTMLButtonElement).disabled = !($("seed-ok") as HTMLInputElement).checked; });
$("create").addEventListener("click", async () => {
  const b = $("create") as HTMLButtonElement, say = (t: string) => { $("create-note").textContent = t; };
  b.disabled = true; b.classList.add("busy");
  try {
    if (!live) throw new Error("The vault program is not on Solana yet.");
    if (!newSeed) throw new Error("Make the key first.");
    const deposit = units(val("deposit"), 9);
    if (deposit < 1_000_000n) throw new Error("Deposit at least 0.001 SOL.");
    const w = await needWallet();
    const rent: number = await NET.rpc("getMinimumBalanceForRentExemption", [QVAULT_SIZE]);
    const made = openVaultInstructions({ program: programId(), payer: w, root: keyRoot(newSeed, 0n), rentLamports: rent, depositLamports: deposit });
    store(seedKey(made.vault.publicKey.toBase58()), hex(newSeed));                 // kept before it is sent, so a vault can never exist without its phrase
    await signAndSend(NET, w, new Transaction().add(...made.instructions), [made.vault], say);
    say(""); newSeed = null; $("seed-wrap").hidden = true; ($("make") as HTMLDetailsElement).open = false;
    await openVault(made.vault.publicKey.toBase58(), "");
  } catch (e: any) { say(explain(e)); b.disabled = false; }
  b.classList.remove("busy");
});

// ---- spend ----
$("all").addEventListener("change", () => { const all = ($("all") as HTMLInputElement).checked; ($("amount") as HTMLInputElement).disabled = all; if (all) ($("amount") as HTMLInputElement).value = solText(balanceOf()); });
$("sign").addEventListener("click", () => {
  const note = $("sign-note");
  try {
    const v = vault!, a = address!, closing = ($("all") as HTMLInputElement).checked;
    if (pending) throw new Error("This key has already signed a spend. Send that one.");
    const amount = closing ? balanceOf() : units(val("amount"), 9), to = key(val("to"), "wallet address");
    if (amount <= 0n) throw new Error("The amount must be more than zero.");
    if (amount > balanceOf()) throw new Error(`The vault holds ${solText(balanceOf())} SOL.`);
    if (to.equals(a)) throw new Error("The vault cannot pay itself.");
    const s = makeSpend(seed!, a.toBytes(), to.toBytes(), amount, v.counter, closing || amount === balanceOf());
    pending = { counter: String(v.counter), recipient: to.toBase58(), amount: amount.toString(), closing: closing || amount === balanceOf(), record: hex(s.record) };
    store(pendingKey(a.toBase58()), JSON.stringify(pending));                       // the key is now spent on this message, whether or not it ever lands
    note.textContent = ""; ($("steal-say") as HTMLElement).hidden = true; ($("spend-done") as HTMLElement).hidden = true;
    show(); landed($("pending-say"), null, "");
  } catch (e: any) { note.textContent = String(e?.message ?? e); }
});
$("send").addEventListener("click", async () => {
  const b = $("send") as HTMLButtonElement, say = (t: string) => { $("send-note").textContent = t; };
  if (!pending || !address) return;
  b.disabled = true; b.classList.add("busy");
  try {
    const w = await needWallet(), p = pending;
    const signature = await signAndSend(NET, w, new Transaction().add(...spendInstructions(programId(), address, new PublicKey(p.recipient), unhex(p.record))), [], say);
    store(pendingKey(address.toBase58()), ""); pending = null; say("");
    await read(); show();
    const done = $("spend-done");
    done.className = "say good"; done.hidden = false;
    done.innerHTML = `Paid <b>${solText(BigInt(p.amount))} SOL</b> to ${esc(short(p.recipient))}. The key that signed it is finished${vault!.state === "closed" ? " and the vault is closed" : `, and the vault is on key number ${vault!.counter + 1n}`}. The only wallet signature in that transaction paid the fee. <a href="${NET.explorer("tx", signature)}" rel="noopener">See the transaction</a>.`;
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
  if (!pending || !address || !vault) return;
  b.classList.add("busy");
  try {
    const payer = await needWallet();                                             // a dry run needs a funded fee payer, or it fails for the wrong reason
    const p = pending, record = unhex(p.record), thief = new PublicKey(randomBytes(32));
    const amount = BigInt(p.amount), salt = new DataView(record.buffer, record.byteOffset).getBigUint64(13, true), next = record.slice(21, 53), sig = record.slice(53);
    const tries: [string, ReturnType<typeof spendInstructions>][] = [
      ["Send it to a thief's address instead", spendInstructions(programId(), address, thief, record)],
      ["Take the whole balance instead", spendInstructions(programId(), address, new PublicKey(p.recipient), record, spendData(balanceOf() === amount ? amount + 1n : balanceOf(), salt, next, sig))],
      ["Swap the next key for the thief's", spendInstructions(programId(), address, new PublicKey(p.recipient), record, spendData(amount, salt, keyRoot(thief.toBytes(), 1n), sig))],
    ];
    const lines: string[] = [];
    for (const [what, ixs] of tries) {
      const r = await simulateOnly(NET, payer, ixs), said = r.logs.filter((l) => l.startsWith("Program log: ")).map((l) => l.slice(13));
      if (r.failed && !said.length) throw new Error("The dry run did not reach the vault program. Check the connected wallet holds a little SOL on " + NET.name + ".");
      lines.push(`<li><b>${esc(what)}:</b> ${r.failed ? "refused" : "NOT refused, which should never happen"}. <span class="muted">${esc(said[said.length - 1] ?? "")}</span></li>`);
    }
    out.className = "say good"; out.hidden = false;
    out.innerHTML = `Three ways to misuse your signature now that it exists, run against the real program without sending anything:<ul style="margin:8px 0 0;padding-left:18px">${lines.join("")}</ul>The signature covers the recipient, the amount and the next key, so changing any of them leaves a signature that no longer checks.`;
  } catch (e: any) { out.className = "say bad"; out.hidden = false; out.textContent = String(e?.message ?? e); }
  b.classList.remove("busy"); landed(out, null, "");
});

// ---- the page ----
const facts: [string, string][] = [];
if (live) {
  facts.push(["Vault program", `<a href="${NET.explorer("address", PROGRAM.programId)}" rel="noopener">${esc(PROGRAM.programId)}</a>`]);
  if (PROGRAM.checkedOn) facts.push(["Last proven", `${esc(PROGRAM.checkedOn)}, on a local validator and on ${NET.name}`]);
  if (PROGRAM.selftest?.spendUnits) facts.push(["Cost of a spend", `${Number(PROGRAM.selftest.spendUnits).toLocaleString("en-GB")} compute units, for about ${Number(PROGRAM.selftest.hashSteps).toLocaleString("en-GB")} hash steps`]);
} else facts.push(["Vault program", "not deployed yet: the sandbox above works now"]);
facts.push(["Signature", "Winternitz one-time, 26 chains of 255 steps, SHA-256 kept to 192 bits: 624 bytes"]);
facts.push(["Source", `<a href="https://github.com/philcoinhigh/Phil-tools/tree/main/qvault">qvault/runtime.c</a> and <a href="https://github.com/philcoinhigh/Phil-tools/blob/main/site/src/wots.ts">wots.ts</a>, with their tests`]);
$("p-facts").innerHTML = facts.map(([k, x]) => `<li><span>${k}</span><span>${x}</span></li>`).join("");
const demoVaults: any[] = DEMO?.vaults ?? [];
$("demos").innerHTML = demoVaults.slice(0, 1).map((d) => `<button type="button" data-vault="${esc(d.vault)}">Last night's demonstration vault (${esc(d.day)})</button>`).join("");
document.querySelectorAll<HTMLButtonElement>("#demos button").forEach((b) => b.addEventListener("click", () => { ($("open-address") as HTMLInputElement).value = b.dataset.vault!; void openVault(b.dataset.vault!, ""); }));
if (!live) { ($("open") as HTMLButtonElement).disabled = true; ($("make-seed") as HTMLButtonElement).disabled = true; $("net").textContent = "Vault coming to Solana devnet · unaudited"; }
const asked = new URLSearchParams(location.search).get("vault");
if (asked) { ($("open-address") as HTMLInputElement).value = asked; void openVault(asked, ""); }
wireFooter();
