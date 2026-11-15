// Giveaways: shows the draws recorded in giveaway/draws, checks one against Solana, and lets a
// visitor try an altered list against the on-chain program. All without a wallet.
import { PROGRAM, EMITTED, DRAWS } from "./giveaway-data";
import { esc, landed } from "./shared";
const NET = chain("devnet", "https://api.devnet.solana.com");
import { wireFooter } from "./foot";
import { buildRecord, cleanEntries, decodeDraw, hex, unhex, sha256, listBytes, uploadData, pickWinners, randomnessOf, readVerdict, OP_CHECK } from "./draw";
import { accountData, simulate, buildCall, base58Decode } from "./solana-call";
import { PublicKey, Transaction } from "@solana/web3.js";
import { giveawayFromChain, listMatches, ChainGiveaway } from "./draw-chain";
import { drawInstruction, DRAW_WINDOW_SLOTS } from "./draw-tx";
import { chain, connectWallet, signAndSend, noWalletHtml, explain, short as shortKey } from "./wallet";
import { store } from "./shared";

const RPC = "https://api.devnet.solana.com";
const $ = (id: string) => document.getElementById(id)!;
const explorer = (kind: string, id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
const short = (s: string) => (s.length > 20 ? `${s.slice(0, 8)}…${s.slice(-8)}` : s);
const n = (v: number) => v.toLocaleString("en-GB");
let current: any = null;
let runs = 0;

function show(g: any) {
  current = g;
  document.querySelectorAll<HTMLButtonElement>("#pick button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === g.id)));
  $("g-title").textContent = g.title;
  const count: number = g.count ?? g.entries.length, waiting = g.state === "locked", known = !!g.entries;
  $("g-when").textContent = `${g.lock.time ? new Date(g.lock.time * 1000).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" }) : ""} · ${n(count)} entries · ${g.winnerCount ?? g.winners.length} winner${(g.winnerCount ?? g.winners.length) === 1 ? "" : "s"}`;
  const expired = g.winners.length === 0 && !waiting;
  $("verify").parentElement!.parentElement!.hidden = expired || waiting || !known; $("ask").parentElement!.parentElement!.hidden = expired || waiting || !known;
  $("e-wrap").hidden = !known; $("need-list").hidden = known; $("draw-wrap").hidden = !waiting;
  if (waiting) $("draw-lead").textContent = `The list is locked. The block at slot ${n(g.draw.targetSlot)} picks the winner. Once it has passed, anyone can send the draw; it must be sent within about three minutes of that block, or this giveaway ends with no winner.`;
  $("g-winners").innerHTML = waiting ? `<div><b>Not drawn yet</b><span>The winning block has not been used yet. Share this page now: a giveaway announced before its draw is worth far more than one announced after.</span></div>` : expired ? `<div><b style="color:var(--bad)">No winner</b><span>Nobody told the program to draw while Solana still kept the chosen block. This giveaway can never produce a winner.</span></div>` : g.winners.map((w: any, i: number) => `<div><b>${esc(w.entry)}</b><span>${g.winners.length > 1 ? `winner ${i + 1} · ` : ""}entry ${n(w.index + 1)} of ${n(count)}</span></div>`).join("");
  const rows: [string, string][] = [
    ["Giveaway account", `<a href="${explorer("address", g.account)}" rel="noopener">${esc(g.account)}</a>`],
    ["Locked", `<a href="${explorer("tx", g.lock.signature)}" rel="noopener">slot ${n(g.lock.slot)}</a>, accepted by Phil's server`],
    waiting ? ["Drawn", `not yet: after slot ${n(g.draw.targetSlot)}`] : expired ? ["Drawn", "never: expired"] : ["Drawn", `${g.draw.signature ? `<a href="${explorer("tx", g.draw.signature)}" rel="noopener">by the block at slot ${n(g.draw.hashSlot)}</a>` : `by the block at slot ${n(g.draw.hashSlot)}`}, ${n(g.draw.hashSlot - g.lock.slot)} slots after the lock`],
    ["On chain", g.kind === 1 ? "the entry list itself" : "the list's SHA-256 fingerprint (the list is too long for one transaction)"],
    ["List fingerprint", `<code>${esc(g.listDigest)}</code>`],
  ];
  if (g.fromChain && g.wallet) rows.push(["Run by", `<a href="${explorer("address", g.wallet)}" rel="noopener">${esc(shortKey(g.wallet))}</a>, the wallet that paid to lock it`]);
  if (g.repeatsRemoved) rows.push(["Repeats removed", `${n(g.repeatsRemoved)} before locking`]);
  $("g-facts").innerHTML = rows.map(([k, v]) => `<li><span>${k}</span><span style="color:inherit;font-size:inherit">${v}</span></li>`).join("");
  const won = new Set(g.winners.map((w: any) => w.index));
  $("entries").innerHTML = (g.entries ?? []).map((e: string, i: number) => `<li${won.has(i) ? ' class="won"' : ""}>${esc(e)}</li>`).join("");
  ($("tamper") as HTMLTextAreaElement).value = (g.entries ?? []).join("\n");
  ($("find") as HTMLInputElement).value = "";
  $("verify-out").hidden = true; $("ask-out").hidden = true; $("verify-note").textContent = ""; $("ask-note").textContent = "";
  $("card").hidden = false;
}

// ---- Check it yourself ----
type Check = [boolean, string, string?];
async function verify(g: any): Promise<{ checks: Check[]; error?: string }> {
  const checks: Check[] = [];
  let seen;
  try { seen = await accountData(RPC, g.account); } catch (e: any) { return { checks, error: /rate-limit|answered/.test(String(e?.message)) ? e.message : "Could not reach Solana devnet from this browser. Check the connection and try again." }; }
  if (!seen) return { checks: [[false, "The giveaway's account is not on devnet", "Devnet may have been reset since this draw. The record in the repository is all that remains."]] };
  const d = decodeDraw(seen.data);
  checks.push([seen.owner === g.program && !!d, "The account exists on Solana and belongs to the giveaway program", short(g.account)]);
  if (!d) return { checks };
  checks.push([d.state === "drawn", "It was locked, then drawn, and can never be changed", `locked at slot ${n(d.lockSlot)}, target slot ${n(d.targetSlot)}`]);
  const record = buildRecord({ title: g.title, winners: g.winnerCount, delay: g.delaySlots, entries: g.entries }, g.kind);
  checks.push([hex(sha256(listBytes(g.entries))) === hex(d.listDigest) && d.count === g.entries.length, "The list on this page is the list that was locked", `${n(g.entries.length)} entries; fingerprint ${hex(d.listDigest).slice(0, 16)}…`]);
  checks.push([hex(sha256(record.payload)) === hex(d.payloadDigest), "The title, the number of winners and the delay are the ones that were locked"]);
  checks.push([d.hashSlot >= d.targetSlot && d.targetSlot === d.lockSlot + d.delay, "The winning block came after the lock", `block at slot ${n(d.hashSlot)}, ${n(d.hashSlot - d.lockSlot)} slots later`]);
  const randomness = randomnessOf(d.payloadDigest, d.slotHash, base58Decode(g.account));
  const winners = pickWinners(randomness, d.count, d.winners);
  checks.push([hex(randomness) === hex(d.randomness), "The randomness is that block's hash mixed with the locked list, nothing else"]);
  checks.push([winners[0] === d.winner && winners.length === g.winners.length && winners.every((w, i) => w === g.winners[i].index), `Redoing the draw here gives the same winner${winners.length === 1 ? "" : "s"}`, winners.map((w) => g.entries[w]).join(", ")]);
  const s = await simulate(RPC, buildCall(g.wallet ?? PROGRAM?.wallet, g.program, [{ key: g.account }], uploadData(OP_CHECK, record.payload)));
  checks.push([s.ok && readVerdict(s.logs).accepted && /byte for byte/.test(s.logs.join("\n")), "Phil's server on Solana, asked just now, accepts this list as the locked one", s.ok ? `${s.units ?? "?"} compute units` : s.error]);
  return { checks };
}
$("verify").addEventListener("click", async () => {
  const b = $("verify") as HTMLButtonElement, g = current;
  b.classList.add("busy"); b.textContent = "Reading Solana…";
  const r = await verify(g);
  b.classList.remove("busy"); b.textContent = "Check again";
  $("checks").innerHTML = r.checks.map(([ok, text, more]) => `<li class="${ok ? "yes" : "no"}"><span>${esc(text)}${more ? `<small>${esc(more)}</small>` : ""}</span></li>`).join("");
  const good = !r.error && r.checks.length > 1 && r.checks.every(([ok]) => ok);
  $("verify-verdict").className = `verdict ${good ? "good" : "bad"}`;
  $("verify-verdict").textContent = r.error ?? (good ? `Everything checks out. ${g.winners.map((w: any) => w.entry).join(" and ")} won fairly.` : "Something does not match. Do not trust this result.");
  $("verify-out").hidden = false;
  landed($("verify-out"), $("verify-note"), `Checked just now (check ${++runs})`);
});

// ---- Try to cheat ----
$("ask").addEventListener("click", async () => {
  const b = $("ask") as HTMLButtonElement, g = current;
  const edited = cleanEntries(($("tamper") as HTMLTextAreaElement).value).entries;
  const verdict = $("ask-verdict");
  const done = (cls: string, text: string, steps: string[] = [], note = "Answered just now") => {
    verdict.className = `verdict ${cls}`; verdict.textContent = text;
    $("ask-steps").innerHTML = steps.map((s) => `<li class="${/REJECTED|fewer bytes|not recognized|could not be stored|left over/.test(s) ? "bad" : /ACCEPTED|byte for byte/.test(s) ? "good" : ""}">${esc(s)}</li>`).join("");
    $("ask-out").hidden = false;
    landed($("ask-out"), $("ask-note"), `${note} (try ${++runs})`);
  };
  if (edited.length === 0) return done("bad", "There is nothing in the list.", [], "Not sent");
  let payload: Uint8Array;
  try { payload = buildRecord({ title: g.title, winners: Math.min(g.winnerCount, edited.length), delay: g.delaySlots, entries: edited }, g.kind).payload; }
  catch (e: any) { return done("bad", String(e?.message ?? e), [], "Not sent"); }
  if (payload.length > 940) return done("bad", "That list is too long to send in one transaction. Try a smaller change.", [], "Not sent");
  b.classList.add("busy"); b.textContent = "Asking Phil on Solana…";
  // The altered list is sent under the fingerprint and size that were locked: the claim a cheat would make.
  const s = await simulate(RPC, buildCall(g.wallet ?? PROGRAM?.wallet, g.program, [{ key: g.account }], uploadData(OP_CHECK, payload, { declaredDigest: unhex(g.payloadDigest), declaredLength: g.payloadLength })));
  b.classList.remove("busy"); b.textContent = "Ask Phil";
  const v = readVerdict(s.logs);
  if (!s.logs.length) return done("bad", s.error ?? "Solana did not answer.", [], "No answer");
  const same = edited.join("\n") === g.entries.join("\n");
  done(v.accepted ? "good" : "bad", v.accepted ? (same ? "Accepted. This is the real list, unchanged." : "Accepted. Your change did not alter the list (repeats and blank lines are ignored).") : `${v.why} The locked list cannot be swapped for this one.`, v.steps);
});
$("reset").addEventListener("click", () => { ($("tamper") as HTMLTextAreaElement).value = current.entries.join("\n"); $("ask-out").hidden = true; $("ask-note").textContent = ""; });
$("find").addEventListener("input", () => {
  const q = ($("find") as HTMLInputElement).value.trim().toLowerCase().replace(/^@/, "");
  document.querySelectorAll<HTMLLIElement>("#entries li").forEach((li) => { li.hidden = !!q && !li.textContent!.toLowerCase().includes(q); });
});

// ---- a giveaway run from the website, found by its address ----
const listKey = (g: { listDigest: string }) => `philcoin.list.${g.listDigest}`;
function withList(g: ChainGiveaway, entries: string[]): ChainGiveaway {
  return { ...g, entries, winners: g.winners.map((w) => ({ index: w.index, entry: entries[w.index] })) };
}
async function showFromChain(account: string): Promise<void> {
  const note = $("community");
  note.hidden = false; note.className = "community"; note.textContent = "Reading this giveaway from Solana…";
  try {
    if (!PROGRAM?.programId) throw new Error("The giveaway program is not deployed.");
    let g = await giveawayFromChain(NET, PROGRAM.programId, new PublicKey(account).toBase58());
    const kept = !g.entries ? listMatches(store(listKey(g)) ?? "", g) : null;
    if (kept) g = withList(g, kept);
    note.innerHTML = `<b>A community giveaway.</b> Anyone can run one from <a href="../coin/">My coin</a>. This one was read from Solana just now; it was not run by the maintainers of this site.`;
    show(g);
  } catch (e: any) { note.className = "community bad"; note.textContent = /Invalid public key|Non-base58/.test(String(e?.message)) ? "That is not a valid giveaway address." : String(e?.message ?? e); }
}
$("list-go").addEventListener("click", () => {
  const entries = listMatches(($("list-in") as HTMLTextAreaElement).value, current);
  if (!entries) { $("list-note").textContent = `That is not the locked list. It must be exactly the ${n(current.count)} entries, in the same order.`; return; }
  store(listKey(current), entries.join("\n"));
  show(withList(current, entries));
});
$("draw-now").addEventListener("click", async () => {
  const b = $("draw-now") as HTMLButtonElement, g = current, say = (t: string) => { $("draw-note").textContent = t; };
  b.disabled = true; b.classList.add("busy");
  try {
    const slot: number = await NET.rpc("getSlot", [{ commitment: "confirmed" }]);
    if (slot <= g.draw.targetSlot + 1) throw new Error(`Too early. About ${Math.max(1, Math.ceil((g.draw.targetSlot + 2 - slot) * 0.4))} seconds to go.`);
    if (slot > g.draw.targetSlot + DRAW_WINDOW_SLOTS) say("The window has probably passed. Sending anyway, which will mark it expired…");
    let wallet;
    try { wallet = await connectWallet(); } catch (e) { $("draw-note").innerHTML = noWalletHtml(NET, e); b.disabled = false; b.classList.remove("busy"); return; }
    await signAndSend(NET, wallet, new Transaction().add(drawInstruction(new PublicKey(g.program), new PublicKey(g.account))), [], say);
    say("Drawn."); await showFromChain(g.account);
  } catch (e: any) { say(/too early/i.test((e?.logs ?? []).join(" ")) ? "Too early: the winning block has not passed yet. Try again in a few seconds." : explain(e)); }
  b.disabled = false; b.classList.remove("busy");
});

// ---- the page ----
const askedDraw = new URLSearchParams(location.search).get("draw");
if (askedDraw) { $("pick").hidden = true; void showFromChain(askedDraw); }
else if (DRAWS.length === 0) $("none").hidden = false;
else {
  $("pick").innerHTML = DRAWS.length > 1 ? DRAWS.map((g) => `<button type="button" data-id="${esc(g.id)}" aria-pressed="false">${esc(g.title)}</button>`).join("") : "";
  document.querySelectorAll<HTMLButtonElement>("#pick button").forEach((b) => b.addEventListener("click", () => show(DRAWS.find((g) => g.id === b.dataset.id))));
  show(DRAWS.find((g) => g.id === new URLSearchParams(location.search).get("g")) ?? DRAWS[0]);
}
$("phil-lead").innerHTML = `Phil's compiler backend emits a function called <code>UploadServer</code>: the server side of Phil's upload protocol, as LLVM. That function is the on-chain program's decision-maker, unmodified${PROGRAM?.stackSlotsMoved ? " apart from moving its stack slots to the top of the function, which Solana's code generator requires" : ""}. It calls out for every byte-level step, and we wrote those steps for Solana: reading frames from the transaction, hashing with Solana's SHA-256, and writing the account. The draw itself (reading the block hash, picking the winner) is ours and is not Phil.`;
const facts: [string, string][] = [];
if (PROGRAM?.programId) facts.push(["Program", `<a href="${explorer("address", PROGRAM.programId)}" rel="noopener">${esc(PROGRAM.programId)}</a>`]);
if (PROGRAM?.programBytes) facts.push(["Size", `${n(PROGRAM.programBytes)} bytes`]);
if (PROGRAM?.selftest?.lockUnits) facts.push(["Cost to lock", `${n(PROGRAM.selftest.lockUnits)} compute units of 200,000 allowed; ${n(PROGRAM.selftest.drawUnits)} to draw`]);
if (EMITTED?.commit) facts.push(["Phil's LLVM", `emitted by <code>phil-llvm-phase0-control-codec</code> at Phil <a href="https://github.com/abiggerhammer/phil/commit/${esc(EMITTED.commit)}" rel="noopener">${esc(EMITTED.commit.slice(0, 10))}</a>`]);
facts.push(["Interface", "Phil's own checker (<code>check_runtime_abi.py</code>) accepts our runtime against all 46 signatures Phil's LLVM declares"]);
facts.push(["Frames", "in the format of Phil's control codec v1"]);
$("p-facts").innerHTML = facts.map(([k, v]) => `<li><span>${k}</span><span style="color:inherit;font-size:inherit">${v}</span></li>`).join("");
wireFooter();
