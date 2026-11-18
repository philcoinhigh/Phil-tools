// Clip Bounties' page: the board, one challenge with its entries, and every way a prize can move.
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { PROGRAM, DEMO } from "./bounty-data";
import { esc, landed, runPhil, highlightHtml, KIND_TITLE, CONTRACT } from "./shared";
import { wireFooter } from "./foot";
import { chain, bytesOf, short, when, key, connectWallet, noWalletHtml, signAndSend, explain, units, coinInfo } from "./wallet";
import { decodeBounty, decodeEntry, safeLink, Bounty, Entry, BOUNTY_SIZE, ENTRY_SIZE, MAX_TEXT, MAX_LINK } from "./bounty";
import { postInstructions, enterInstructions, awardInstructions, armInstruction, drawInstruction, claimInstructions, refundInstruction, Coin } from "./bounty-tx";

const NET = chain(PROGRAM?.network ?? "devnet", PROGRAM?.rpc ?? "https://api.devnet.solana.com");
const $ = (id: string) => document.getElementById(id)!;
const val = (id: string) => ($(id) as HTMLInputElement).value.trim();
const live = !!PROGRAM?.programId, program = live ? new PublicKey(PROGRAM.programId) : null;
const b58 = (b: Uint8Array) => new PublicKey(b).toBase58();
const amountText = (amount: bigint, decimals: number) => { const s = amount.toString().padStart(decimals + 1, "0"), whole = s.slice(0, s.length - decimals), part = decimals ? s.slice(-decimals).replace(/0+$/, "") : ""; return Number(whole).toLocaleString("en-GB") + (part ? "." + part : ""); };
const byteLength = (s: string) => new TextEncoder().encode(s).length;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const practice = new Set<string>(((DEMO?.bounties ?? []) as any[]).map((x) => x.bounty));

// What the program's refusals mean, in words.
const WHY: Record<number, string> = { 302: "This prize has already been decided.", 303: "Only the sponsor can pick the winner.", 304: "Too late to pick: the draw has started.", 305: "That is not an entry of this challenge.", 306: "That is not where the winner receives the prize.",
  310: "Nobody entered, so there is nothing to draw.", 311: "Too early: the sponsor can still pick.", 312: "A draw is already waiting for its block.", 321: "The draw's block has not passed yet. Try again in a few seconds.", 322: "That block's hash is no longer kept. Start the draw again.",
  340: "There are entries, so the prize cannot go back to the sponsor.", 341: "Too early: the deadline has not passed.", 1201: "Phil's server rejected it: the bytes did not match their seal.", 1802: "Those terms are not allowed.", 1803: "The wallet has to sign this itself.", 1804: "The prize is not in the bounty.", 1805: "Entries are closed.", 1806: "That entry account cannot be used.", 1807: "This challenge is full." };
function why(e: any): string {
  const m = /custom program error: 0x([0-9a-f]+)/i.exec(String(e?.message ?? e) + " " + (e?.logs ?? []).join(" "));
  return (m && WHY[parseInt(m[1], 16)]) || explain(e);
}

// ---- coins: a prize is SOL or any token ----
const coins = new Map<string, Coin>();
async function coinOf(mint: Uint8Array | null): Promise<Coin | undefined> {
  if (!mint) return undefined;
  const k = b58(mint);
  if (!coins.has(k)) { const c = await coinInfo(NET, k); coins.set(k, { mint: c.mint, tokenProgram: c.tokenProgram, decimals: c.decimals }); }
  return coins.get(k);
}
const coinName = (mint: Uint8Array | null) => (!mint ? "SOL" : b58(mint) === CONTRACT ? "Philcoin" : `of coin ${short(b58(mint))}`);
const prizeText = (b: Bounty) => `${amountText(b.prize, b.mint ? coins.get(b58(b.mint))?.decimals ?? 0 : 9)} ${coinName(b.mint)}`;
function status(b: Bounty): { tag: string; open: boolean; say: string } {
  const t = nowSeconds();
  if (b.state === "paid") return { tag: "paid", open: false, say: b.how === "draw" ? "Paid. The sponsor did not pick in time, so a block hash drew the winner." : "Paid. The sponsor picked the winner." };
  if (b.state === "refunded") return { tag: "refunded", open: false, say: "Nobody entered before the deadline, so the prize went back to the sponsor." };
  if (b.state === "drawn") return { tag: "drawn", open: false, say: `A block hash drew entry number ${b.winnerIndex + 1}. Anyone can now pay it out.` };
  if (b.drawSlot > 0n) return { tag: "drawing", open: false, say: "The sponsor did not pick in time. A draw has been started and is waiting for its block." };
  if (t <= b.deadline) return { tag: "open", open: true, say: `Open for entries until ${when(b.deadline)}. The sponsor can pick a winner at any time.` };
  if (b.count === 0) return { tag: "no entries", open: false, say: "The deadline passed with no entries. The prize can go back to the sponsor." };
  if (t <= b.deadline + b.graceSeconds) return { tag: "judging", open: false, say: `Entries are closed. The sponsor has until ${when(b.deadline + b.graceSeconds)} to pick; after that anyone can start a draw.` };
  return { tag: "overdue", open: false, say: "The sponsor did not pick in time. Anyone can start a draw, and a block hash will pick an entry." };
}

// ---- wallet ----
let wallet: PublicKey | null = null;
async function needWallet(): Promise<PublicKey> {
  if (wallet) return wallet;
  try { wallet = await connectWallet(); $("who").textContent = `Connected: ${short(wallet.toBase58())}`; $("connect").textContent = "Connected"; $("no-wallet").hidden = true; return wallet; }
  catch (e: any) { $("no-wallet").hidden = false; $("no-wallet").innerHTML = noWalletHtml(NET, e); throw new Error("Connect a wallet first."); }
}
$("connect").addEventListener("click", () => { void needWallet().then(() => { if (current) show(); }).catch(() => {}); });

// ---- the board ----
interface Listed { address: string; b: Bounty }
let board: Listed[] = [];
async function readBoard(): Promise<void> {
  const note = $("board-note");
  if (!live) { note.textContent = "The program is not on Solana yet."; return; }
  try {
    const list: any[] = await NET.rpc("getProgramAccounts", [PROGRAM.programId, { encoding: "base64", commitment: "confirmed", filters: [{ dataSize: BOUNTY_SIZE }] }]);
    board = list.map((a) => ({ address: a.pubkey as string, b: decodeBounty(bytesOf(a.account.data[0]))! })).filter((x) => x.b).sort((x, y) => y.b.posted - x.b.posted);
    await Promise.all(board.map((x) => coinOf(x.b.mint).catch(() => undefined)));
    const openFirst = [...board].sort((x, y) => Number(status(y.b).open) - Number(status(x.b).open));
    $("board").innerHTML = openFirst.slice(0, 40).map((x) => { const s = status(x.b); return `<button type="button" class="bounty" data-b="${esc(x.address)}"><b>${esc(x.b.text)}</b><span><span class="tag prize">${esc(prizeText(x.b))}</span><span class="tag ${s.open ? "open" : ""}">${esc(s.tag)}</span>${practice.has(x.address) ? '<span class="tag">practice</span>' : ""}<span>${x.b.count} entr${x.b.count === 1 ? "y" : "ies"}</span><span>${s.open ? "closes " + when(x.b.deadline) : ""}</span></span></button>`; }).join("");
    note.textContent = board.length ? `${board.length} challenge${board.length === 1 ? "" : "s"} on ${NET.name}, read from Solana just now.` : "No challenges yet. Post the first one.";
    document.querySelectorAll<HTMLButtonElement>("#board .bounty").forEach((el) => el.addEventListener("click", () => { void openBounty(el.dataset.b!); }));
  } catch (e: any) { note.textContent = "The board could not be read just now: " + String(e?.message ?? e); }
}
$("reload").addEventListener("click", () => { void readBoard(); });

// ---- one challenge ----
let current: { address: PublicKey; b: Bounty; entries: (Entry & { address: string })[]; coin?: Coin } | null = null;
async function read(address: PublicKey): Promise<void> {
  const info = (await NET.rpc("getAccountInfo", [address.toBase58(), { encoding: "base64", commitment: "confirmed" }])).value;
  const b = info && info.owner === PROGRAM.programId ? decodeBounty(bytesOf(info.data[0])) : null;
  if (!b) throw new Error(`There is no challenge at that address on ${NET.name}.`);
  const list: any[] = await NET.rpc("getProgramAccounts", [PROGRAM.programId, { encoding: "base64", commitment: "confirmed", filters: [{ dataSize: ENTRY_SIZE }, { memcmp: { offset: 8, bytes: address.toBase58() } }] }]);
  const entries = list.map((a) => ({ ...decodeEntry(bytesOf(a.account.data[0]))!, address: a.pubkey as string })).filter((e) => e.link !== undefined).sort((x, y) => x.index - y.index);
  current = { address, b, entries, coin: await coinOf(b.mint) };
}
function show(): void {
  const { address, b, entries } = current!, s = status(b), a = address.toBase58(), mine = !!wallet && b58(b.sponsor) === wallet.toBase58();
  $("v-text").textContent = b.text;
  const rows: [string, string][] = [["Prize", `<b>${esc(prizeText(b))}</b>, locked`], ["Sponsor", `${esc(short(b58(b.sponsor)))}${mine ? " (you)" : ""}`], ["Entries close", when(b.deadline)], ["Sponsor picks by", when(b.deadline + b.graceSeconds)],
    ["On chain", `<a href="${NET.explorer("address", a)}" rel="noopener">${esc(short(a))}</a>`]];
  if (b.state === "paid") rows.push(["Paid to", `${esc(short(b58(b.winner)))}, entry number ${b.winnerIndex + 1}, on ${when(b.paidTime)}`]);
  if (b.how === "draw") rows.push(["Drawn by", `the hash of block ${b.hashSlot}`]);
  $("kv").innerHTML = rows.map(([k, x]) => `<li><span>${k}</span><span>${x}</span></li>`).join("");
  $("v-status").className = "say" + (b.state === "paid" ? " good" : ""); $("v-status").textContent = s.say;
  const decided = b.state === "paid" || b.state === "drawn";
  $("entries").innerHTML = entries.length ? entries.map((e) => {
    const link = safeLink(e.link), won = decided && e.index === b.winnerIndex, canPick = mine && b.state === "open" && b.drawSlot === 0n;
    return `<li class="${won ? "won" : ""}"><span>${link ? `<a href="${esc(link)}" rel="noopener nofollow ugc" target="_blank">${esc(e.link)}</a>` : `<span class="plain">${esc(e.link)}</span>`}</span>`
      + `${canPick ? `<button type="button" class="btn small" data-pick="${e.index}">Pick as winner</button>` : won ? `<span class="tag open">${b.state === "paid" ? "winner" : "drawn"}</span>` : "<span></span>"}`
      + `<small>Entry ${e.index + 1} · ${esc(short(b58(e.entrant)))} · ${when(e.time)}</small></li>`; }).join("") : `<li><span class="muted">No entries yet.</span><span></span></li>`;
  document.querySelectorAll<HTMLButtonElement>("#entries [data-pick]").forEach((el) => el.addEventListener("click", () => { void act("pick", Number(el.dataset.pick)); }));
  // What can be done to the prize right now.
  const t = nowSeconds(), acts: [string, string][] = [];
  if (b.state === "open" && b.drawSlot === 0n && b.count > 0 && t > b.deadline + b.graceSeconds) acts.push(["arm", "Start the draw"]);
  if (b.state === "open" && b.drawSlot > 0n) acts.push(["draw", "Draw the winner"]);
  if (b.state === "drawn") acts.push(["claim", "Pay the winner"]);
  if (b.state === "open" && b.count === 0 && t > b.deadline) acts.push(["refund", "Return the prize to the sponsor"]);
  $("v-actions").innerHTML = acts.map(([id, label]) => `<button type="button" class="btn" data-act="${id}">${label}</button>`).join("");
  document.querySelectorAll<HTMLButtonElement>("#v-actions [data-act]").forEach((el) => el.addEventListener("click", () => { void act(el.dataset.act!); }));
  $("v-action-note").textContent = acts.length && !mine ? "Anyone can do this. It can only pay what the rules already decided." : mine && b.state === "open" && b.drawSlot === 0n && entries.length ? "You are the sponsor: pick any entry below to pay it." : "";
  $("enter-wrap").hidden = !s.open;
  $("board-panel").hidden = true; $("view").hidden = false;
  try { history.replaceState(null, "", `?b=${a}`); } catch { /* sandboxed */ }
}
async function openBounty(text: string): Promise<void> {
  try { const address = key(text, "challenge address"); $("view-note").textContent = ""; await read(address); show(); landed($("v-text"), $("view-note"), "Read from Solana just now"); }
  catch (e: any) { current = null; $("view").hidden = true; $("board-panel").hidden = false; $("board-note").textContent = String(e?.message ?? e); }
}
const again = async (note: string) => { await read(current!.address); show(); $("view-note").textContent = note; };
$("refresh").addEventListener("click", () => { void again("Read from Solana just now").catch((e) => { $("view-note").textContent = String(e?.message ?? e); }); });
$("back").addEventListener("click", () => { current = null; $("view").hidden = true; $("board-panel").hidden = false; try { history.replaceState(null, "", location.pathname); } catch { /* sandboxed */ } void readBoard(); });

// Every way the prize moves. Each is one transaction; the program decides whether it is allowed.
async function act(what: string, pick?: number): Promise<void> {
  const say = (t: string) => { $("v-action-note").textContent = t; };
  try {
    const c = current!, w = await needWallet();
    let ixs: TransactionInstruction[], done: string;
    if (what === "pick") { const e = c.entries.find((x) => x.index === pick)!; ixs = awardInstructions(program!, c.address, w, new PublicKey(e.address), new PublicKey(e.entrant), c.coin); done = `Paid. Entry ${e.index + 1} won.`; }
    else if (what === "arm") { ixs = [armInstruction(program!, c.address)]; done = "The draw has started. Its block arrives in a few seconds; then press Draw the winner."; }
    else if (what === "draw") { ixs = [drawInstruction(program!, c.address)]; done = "Drawn. Now anyone can pay the winner."; }
    else if (what === "claim") { const e = c.entries.find((x) => x.index === c.b.winnerIndex); if (!e) throw new Error("The drawn entry could not be found. Read again."); ixs = claimInstructions(program!, c.address, new PublicKey(e.address), new PublicKey(e.entrant), w, c.coin); done = "Paid to the entry that was drawn."; }
    else { ixs = [refundInstruction(program!, c.address, new PublicKey(c.b.sponsor), c.coin)]; done = "The prize went back to the sponsor."; }
    await signAndSend(NET, w, new Transaction().add(...ixs), [], say);
    await again(done); landed($("v-status"), null, "");
  } catch (e: any) { say(why(e)); }
}

// ---- enter ----
$("e-send").addEventListener("click", async () => {
  const b = $("e-send") as HTMLButtonElement, say = (t: string) => { $("e-note").textContent = t; };
  b.classList.add("busy");
  try {
    const link = val("e-link");
    if (!link) throw new Error("Paste your clip's link.");
    if (byteLength(link) > MAX_LINK) throw new Error(`A link can be at most ${MAX_LINK} characters.`);
    if (!safeLink(link)) throw new Error("That does not look like a link to a clip on X, YouTube, TikTok, Twitch, Kick, Instagram, Streamable or Medal.");
    const w = await needWallet(), rent: number = await NET.rpc("getMinimumBalanceForRentExemption", [ENTRY_SIZE]);
    const made = enterInstructions(program!, current!.address, w, link, rent);
    await signAndSend(NET, w, new Transaction().add(...made.instructions), [made.entry], say);
    ($("e-link") as HTMLInputElement).value = ""; say("");
    await again("You are in. Your entry is on chain."); landed($("entries"), null, "");
  } catch (e: any) { say(why(e)); }
  b.classList.remove("busy");
});

// ---- post ----
$("p-send").addEventListener("click", async () => {
  const b = $("p-send") as HTMLButtonElement, say = (t: string) => { $("p-note").textContent = t; };
  b.classList.add("busy");
  try {
    if (!live) throw new Error("The program is not on Solana yet.");
    const text = val("p-text"), coinText = val("p-coin");
    if (!text) throw new Error("Say what the challenge is.");
    if (byteLength(text) > MAX_TEXT) throw new Error(`The challenge can be at most ${MAX_TEXT} bytes.`);
    let coin: Coin | undefined;
    if (coinText && coinText.toUpperCase() !== "SOL") { const c = await coinInfo(NET, coinText); coin = { mint: c.mint, tokenProgram: c.tokenProgram, decimals: c.decimals }; coins.set(c.mint.toBase58(), coin); }
    const prize = units(val("p-prize"), coin ? coin.decimals : 9);
    if (prize <= 0n) throw new Error("The prize must be more than zero.");
    const w = await needWallet(), rent: number = await NET.rpc("getMinimumBalanceForRentExemption", [BOUNTY_SIZE]);
    const made = postInstructions({ program: program!, sponsor: w, text, deadline: nowSeconds() + Number(val("p-deadline")), graceSeconds: Number(val("p-grace")), prize, rentLamports: rent, coin }, Keypair.generate());
    await signAndSend(NET, w, new Transaction().add(...made.instructions), [made.bounty], say);
    say(""); ($("p-text") as HTMLInputElement).value = ""; ($("post") as HTMLDetailsElement).open = false;
    await openBounty(made.bounty.publicKey.toBase58());
  } catch (e: any) { say(why(e)); }
  b.classList.remove("busy");
});

// ---- the same rule, in Phil ----
const TWICE = `record Prize mode linear {
  amount : U64
}

callable Pay(prize : Prize) -> U64 {
  outcomes { success U64 };
}

// Paying a prize uses it up.
fn pay(prize : Prize) -> U64 satisfies Pay {
  let Prize { amount } = prize;
  return amount;
}

component main provides U64 {
  let prize = construct Prize { amount = 500 };
  let winner = pay(prize);
  let sponsor = pay(prize);
  return winner + sponsor;
}
`;
const ONCE = TWICE.replace("  let winner = pay(prize);\n  let sponsor = pay(prize);\n  return winner + sponsor;", "  let winner = pay(prize);\n  return winner;");
let once = false;
function philDemo(): void {
  const src = once ? ONCE : TWICE, o = runPhil(src, {});
  $("phil-demo").innerHTML = `<pre class="code">${highlightHtml(src, o.ok ? undefined : o.span)}</pre>`
    + `<div class="says${o.ok ? " good" : ""}">${o.ok ? `<b>Ran to completion</b>${esc(o.returns.map((r) => `hands back ${r.text}`).join(" · "))}` : `<b>${esc(KIND_TITLE[o.kind] ?? o.kind)}${o.line ? `, line ${o.line}` : ""}</b>${esc(o.message)}`}</div>`
    + `<div class="row"><button type="button" class="btn ghost small" id="phil-flip">${once ? "Show the mistake again" : "Show the working version"}</button><span class="muted" style="font-size:13.5px">Run in our own simulator of Phil, in this browser.</span></div>`;
  $("phil-flip").addEventListener("click", () => { once = !once; philDemo(); });
}
philDemo();

// ---- the page ----
const facts: [string, string][] = [];
if (live) {
  facts.push(["Program", `<a href="${NET.explorer("address", PROGRAM.programId)}" rel="noopener">${esc(PROGRAM.programId)}</a>`]);
  if (PROGRAM.checkedOn) facts.push(["Last proven", `${esc(PROGRAM.checkedOn)}, on a local validator and on ${NET.name}: every ending, and what a cheating sponsor or entrant would try`]);
  if (PROGRAM.selftest?.enterUnits) facts.push(["Cost", `${Number(PROGRAM.selftest.postUnits).toLocaleString("en-GB")} compute units to post, ${Number(PROGRAM.selftest.enterUnits).toLocaleString("en-GB")} to enter`]);
} else { facts.push(["Program", "not deployed yet"]); $("net").textContent = "Coming to Solana devnet · unaudited"; ($("p-send") as HTMLButtonElement).disabled = true; }
facts.push(["Source", `<a href="https://github.com/philcoinhigh/Phil-tools/tree/main/bounty">bounty/runtime.c</a> and its tests`]);
$("p-facts").innerHTML = facts.map(([k, x]) => `<li><span>${k}</span><span>${x}</span></li>`).join("");
const asked = new URLSearchParams(location.search).get("b");
if (asked && live) void openBounty(asked); else void readBoard();
wireFooter();
