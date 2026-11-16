// The Line: play it in the browser, or on Solana where Phil's upload server referees every move.
// On Solana, moves are signed by a throwaway key this page holds, so the wallet is asked once.
import { PublicKey, Transaction, Keypair, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PROGRAM, DEMO } from "./line-data";
import { esc, landed, store } from "./shared";
import { wireFooter } from "./foot";
import { hex, unhex, sha256, concat, readVerdict } from "./draw";
import { chain, bytesOf, short, when, connectWallet, noWalletHtml, signAndSend, sendLocal, simulateOnly, explain } from "./wallet";
import { decodeMatch, commitment, revealData, playRound, newBoard, replay, practicePull, resultText, Match, Board, Side, Result, How, MATCH_SIZE, PLACES, START_ENERGY, ROUNDS } from "./line";
import { openInstructions, joinInstruction, commitInstruction, revealInstruction, timeoutInstruction, Move } from "./line-tx";

const NET = chain(PROGRAM?.network ?? "devnet", PROGRAM?.rpc ?? "https://api.devnet.solana.com");
const $ = (id: string) => document.getElementById(id)!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const live = !!PROGRAM?.programId;
const programId = () => new PublicKey(PROGRAM.programId);
const WINDOW_SECONDS = 180;
const FEE_FLOAT = 6_000_000;                    // lamports a player key is topped up to: enough for several matches' fees

// ---- what the page shows ----
interface View {
  referee: "browser" | "solana"; names: [string, string]; you: Side | null;
  board: Board; history: [number, number][]; phase: "idle" | "waiting" | "committing" | "revealing" | "over";
  committed: [boolean, boolean]; revealed: [boolean, boolean];
}
const idle = (): View => ({ referee: "browser", names: ["A", "B"], you: null, board: newBoard(), history: [], phase: "idle", committed: [false, false], revealed: [false, false] });
let view = idle(), busy = false, lastNode = 3;

// The wire's seven places.
{ const wire = $("wire");
  for (let i = 0; i < PLACES; i++) { const p = document.createElement("div"); p.className = "place" + (i === 0 || i === PLACES - 1 ? " end" : i === 3 ? " mid" : ""); p.style.left = `${(i / (PLACES - 1)) * 100}%`; wire.insertBefore(p, $("node")); }
  for (const [i, text] of [[0, "A WINS HERE"], [PLACES - 1, "B WINS HERE"]] as [number, string][]) { const t = document.createElement("div"); t.className = "tag"; t.style.left = `${(i / (PLACES - 1)) * 100}%`; t.textContent = text; wire.appendChild(t); } }

function setStatus(html: string, tone: "" | "good" | "bad" = ""): void { const s = $("status"); s.className = "status" + (tone ? " " + tone : ""); s.innerHTML = html; }
function render(): void {
  const v = view, b = v.board;
  for (const [i, side] of ["a", "b"].entries()) {
    const you = v.you === i;
    $(`name-${side}`).innerHTML = `${esc(v.names[i])}${you ? " (you)" : ""}<small>pulls ${i === 0 ? "left" : "right"}</small>`;
    ($(`bar-${side}`) as HTMLElement).style.width = `${(b.energy[i] / START_ENERGY) * 100}%`;
    $(`en-${side}`).textContent = String(b.energy[i]);
    const chip = $(`chip-${side}`);
    const text = v.phase === "committing" ? (v.committed[i] ? "committed" : "choosing") : v.phase === "revealing" ? (v.revealed[i] ? "revealed" : "revealing") : v.phase === "waiting" ? (i === 0 ? "seated" : "empty seat") : v.phase === "over" ? (b.result === (i === 0 ? "a" : "b") ? "won" : "") : "";
    chip.textContent = text; chip.hidden = !text; chip.className = "chip" + ((v.phase === "committing" && v.committed[i]) || (v.phase === "revealing" && v.revealed[i]) || text === "won" || text === "seated" ? " on" : "");
  }
  $("round").textContent = String(Math.min(b.round, ROUNDS));
  const node = $("node");
  node.style.left = `${(b.node / (PLACES - 1)) * 100}%`;
  if (b.node !== lastNode) { node.classList.remove("tug"); void node.offsetWidth; node.classList.add("tug"); lastNode = b.node; }
  $("wire").setAttribute("aria-label", `The wire: the coin is ${b.node === 3 ? "in the middle" : `${Math.abs(b.node - 3)} place${Math.abs(b.node - 3) === 1 ? "" : "s"} toward ${v.names[b.node < 3 ? 0 : 1]}`}`);
  $("referee").textContent = v.phase === "idle" ? "" : v.referee === "solana" ? "· referee: Phil's server on Solana" : "· referee: your browser (rules only)";
  $("starts").hidden = v.phase !== "idle";
  const canMove = v.phase === "committing" && v.you !== null && !v.committed[v.you] && !busy;
  $("pull").hidden = !canMove;
  if (canMove) {
    const max = b.energy[v.you!], input = $("pull-in") as HTMLInputElement;
    if (Number(input.max) !== max) { input.max = String(max); input.value = String(Math.min(Number(input.value), max)); }
    $("pull-out").textContent = input.value; $("pull-max").textContent = `(0 to ${max})`;
    $("cheat-wrap").hidden = v.referee !== "solana";
  }
  $("after").hidden = v.phase === "idle";
  ($("again") as HTMLElement).hidden = v.phase !== "over" && v.referee === "solana" && v.you !== null;
  $("again").textContent = v.phase === "over" ? "New match" : v.you === null ? "Play your own" : "Leave this match";
  // The rounds so far.
  const rows = $("rounds"), boards = replay(v.history);
  rows.hidden = v.history.length === 0;
  $("th-a").textContent = `${v.names[0].toUpperCase()} PULLED`; $("th-b").textContent = `${v.names[1].toUpperCase()} PULLED`;
  rows.querySelector("tbody")!.innerHTML = v.history.map(([a, bb], i) => `<tr><td>${i + 1}</td><td class="${a > bb ? "w" : ""}">${a}</td><td class="${bb > a ? "w" : ""}">${bb}</td><td>${a === bb ? "held" : `→ ${esc(v.names[a > bb ? 0 : 1])}`}${boards[i + 1].node === 3 ? " (middle)" : ""}</td></tr>`).reverse().join("");
}
interface Entry { tag: string; text: string; phil?: string; ok?: boolean; signature?: string }
function log(e: Entry): void {
  const li = document.createElement("li");
  li.innerHTML = `<span class="t">${esc(e.tag)}</span><span>${esc(e.text)}</span>${e.phil ? `<span class="phil${e.ok === false ? " no" : ""}">${esc(e.phil)}</span>` : ""}${e.signature ? `<a href="${NET.explorer("tx", e.signature)}" rel="noopener">transaction</a>` : ""}`;
  $("reflog").prepend(li);
}
const describeRound = (v: View, a: number, b: number): string => {
  const mine = v.you === null ? null : v.you === 0 ? a : b, theirs = v.you === null ? null : v.you === 0 ? b : a;
  const moved = a === b ? "The coin holds." : `The coin moves toward ${esc(v.names[a > b ? 0 : 1])}${v.you === (a > b ? 0 : 1) ? " (you)" : ""}.`;
  return mine === null ? `${esc(v.names[0])} pulled <b>${a}</b>, ${esc(v.names[1])} pulled <b>${b}</b>. ${moved}` : `You pulled <b>${mine}</b>, ${esc(v.names[v.you === 0 ? 1 : 0])} pulled <b>${theirs}</b>. ${moved}`;
};
const overText = (v: View): string => {
  const text = resultText(v.board, v.names);
  if (v.you === null || v.board.result === "drawn" || v.board.result === "void") return text;
  return (v.board.result === (v.you === 0 ? "a" : "b") ? "You won. " : "You lost. ") + text;
};

// ---- pull control ----
$("pull-in").addEventListener("input", () => { $("pull-out").textContent = ($("pull-in") as HTMLInputElement).value; });
document.querySelectorAll<HTMLButtonElement>("#pull-quick button").forEach((b) => b.addEventListener("click", () => {
  const input = $("pull-in") as HTMLInputElement; input.value = String(Math.round(Number(input.max) * Number(b.dataset.f))); $("pull-out").textContent = input.value;
}));
const randomBytes = (n: number) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; };

// ================= practice: the rules in this browser =================
let local: { match: Uint8Array; botPull: number; botNonce: Uint8Array } | null = null;
function localRound(): void {
  // The bot decides and commits first, so it cannot react to you.
  const botPull = practicePull(view.board, 1, Math.random), botNonce = randomBytes(32);
  local = { match: local?.match ?? randomBytes(32), botPull, botNonce };
  view.committed = [false, true]; view.revealed = [false, false]; view.phase = "committing";
  log({ tag: `round ${view.board.round}`, text: `The bot committed its move: ${hex(commitment(local.match, view.board.round, 1, botPull, botNonce)).slice(0, 16)}…` });
  setStatus(`Round <b>${view.board.round}</b>. The bot has committed a hidden pull. Choose yours.`);
  render();
}
function startLocal(): void {
  stopChain();
  view = { ...idle(), referee: "browser", names: ["You", "Bot"], you: 0, phase: "committing" }; local = null; $("reflog").innerHTML = "";
  view.names = ["You", "Bot"];
  localRound();
}
async function commitLocal(pull: number): Promise<void> {
  const l = local!, round = view.board.round, nonce = randomBytes(32), mine = commitment(l.match, round, 0, pull, nonce);
  busy = true; view.committed = [true, true]; render();
  log({ tag: `round ${round}`, text: `You committed: ${hex(mine).slice(0, 16)}…` });
  setStatus("Both moves are committed. Revealing…");
  await sleep(450);
  // The check the referee makes on Solana, made here: the revealed bytes must hash to what was committed.
  const ok = hex(commitment(l.match, round, 0, pull, nonce)) === hex(mine);
  log({ tag: `round ${round}`, text: `Both revealed: you ${pull}, bot ${l.botPull}.`, phil: ok ? "hashes match" : "", ok });
  const before = view;
  view = { ...view, board: playRound(view.board, pull, l.botPull), history: [...view.history, [pull, l.botPull]] };
  busy = false;
  if (view.board.result !== "none") { view.phase = "over"; render(); setStatus(`${describeRound(before, pull, l.botPull)} <b>${esc(overText(view))}</b>`, view.board.result === "a" ? "good" : view.board.result === "b" ? "bad" : ""); log({ tag: "over", text: overText(view) }); return; }
  const said = describeRound(before, pull, l.botPull);
  localRound();
  setStatus(`${said} Round <b>${view.board.round}</b>: the bot has committed again. Your pull?`);
}

// ================= on Solana =================
interface Saved { match: string; side: Side; seed: string; owner: string; bot?: number[]; pulls: Record<number, number>; botPulls: Record<number, number> }
let saved: Saved | null = null, timer: ReturnType<typeof setInterval> | null = null, ticking = false, seen = "", wallet: PublicKey | null = null, cheated = 0;
const keyOf = (address: string) => `philcoin.line.match.${address}`;
const persist = () => { if (saved) store(keyOf(saved.match), JSON.stringify(saved)); };
function sessionKey(): Keypair {
  try { const raw = store("philcoin.line.key"); if (raw) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))); } catch { /* make a new one */ }
  const k = Keypair.generate();
  store("philcoin.line.key", JSON.stringify(Array.from(k.secretKey)));
  return k;
}
const botKey = () => (saved?.bot ? Keypair.fromSecretKey(Uint8Array.from(saved.bot)) : null);
const nonceFor = (s: Saved, round: number, side: Side) => sha256(concat(unhex(s.seed), Uint8Array.of(round, side)));
const moveFor = (s: Saved, round: number, side: Side, pull: number): Move => ({ round, side, pull, nonce: nonceFor(s, round, side) });
function stopChain(): void { if (timer) clearInterval(timer); timer = null; saved = null; seen = ""; }
async function readMatch(address: string): Promise<Match | null> {
  const info = (await NET.rpc("getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }])).value;
  return info && info.owner === PROGRAM.programId ? decodeMatch(bytesOf(info.data[0])) : null;
}
const nameOf = (m: Match, side: Side, s: Saved | null): string => {
  const owner = new PublicKey(m.owners[side]).toBase58(), player = new PublicKey(m.players[side]).toBase58();
  if (s?.bot && side !== s.side) return "Bot";
  if (s && side === s.side) return "You";
  return m.phase === "waiting" && side === 1 ? "Nobody yet" : short(owner === player ? player : owner);
};
function viewOf(m: Match, address: string): View {
  const s = saved && saved.match === address ? saved : null;
  const boards = replay(m.history), last = boards[boards.length - 1];
  const board: Board = m.phase === "over" ? { ...last, node: m.node, energy: m.energy, result: m.result as Result, how: m.how as How } : { round: m.round || 1, node: m.node, energy: m.energy, result: "none", how: "none" };
  return { referee: "solana", names: [nameOf(m, 0, s), nameOf(m, 1, s)], you: s ? s.side : null, board, history: m.history, phase: m.phase === "empty" ? "idle" : m.phase, committed: m.committed, revealed: m.revealed };
}
/** A step taken with a key this page holds. Its outcome goes in the referee log with Phil's verdict. */
async function step(tag: string, text: string, ix: TransactionInstruction, signer: Keypair): Promise<boolean> {
  try { const signature = await sendLocal(NET, [ix], [signer]); log({ tag, text, phil: "Phil: ACCEPTED", signature }); return true; }
  catch (e: any) { const v = e?.logs ? readVerdict(e.logs) : null; log({ tag, text: `${text} Refused: ${v?.steps.length ? v.why : String(e?.message ?? e)}`, ok: false, phil: v?.steps.length ? v.steps[v.steps.length - 1] : "" }); return false; }
}
async function tick(): Promise<void> {
  const s = saved;
  if (!s || ticking) return;
  ticking = true;
  try {
    const m = await readMatch(s.match);
    if (!m || saved !== s) return;
    const address = new PublicKey(s.match), me = sessionKey(), bot = botKey(), other: Side = s.side === 0 ? 1 : 0, tag = `round ${m.round}`;
    const stamp = `${m.phase}/${m.round}/${m.committed}/${m.revealed}/${m.history.length}`;
    if (stamp !== seen) {
      const before = view; seen = stamp; view = viewOf(m, s.match);
      if (m.history.length > before.history.length && before.referee === "solana") { const [a, b] = m.history[m.history.length - 1]; setStatus(`${describeRound(view, a, b)}${m.phase === "over" ? ` <b>${esc(overText(view))}</b>` : ` Round <b>${m.round}</b>: your pull?`}`, m.phase === "over" ? (view.board.result === (s.side === 0 ? "a" : "b") ? "good" : "bad") : ""); }
      else if (m.phase === "waiting") setStatus(s.bot ? "The match is open. Seating the bot…" : "The match is open on Solana. Send your friend the link; the game starts when they join.");
      else if (m.phase === "committing" && !m.committed[s.side]) setStatus(`Round <b>${m.round}</b>. ${m.committed[other] ? `${esc(view.names[other])} has committed a hidden pull.` : `${esc(view.names[other])} is choosing.`} Choose yours.`);
      else if (m.phase === "committing") setStatus(`Your move is committed. Waiting for ${esc(view.names[other])}…`);
      else if (m.phase === "revealing") setStatus("Both moves are committed. Opening them through Phil's server…");
      else if (m.phase === "over") { setStatus(`<b>${esc(overText(view))}</b>`, view.board.result === (s.side === 0 ? "a" : "b") ? "good" : view.board.result === "drawn" || view.board.result === "void" ? "" : "bad"); log({ tag: "over", text: overText(view) }); }
      render();
    }
    ($("copy-link") as HTMLElement).hidden = !(m.phase === "waiting" && !s.bot);
    ($("sweep") as HTMLElement).hidden = m.phase !== "over";
    const late = m.phase !== "over" && m.phase !== "waiting" && Date.now() / 1000 > m.phaseStart + m.window + 8;
    const theyOweAMove = m.phase === "committing" ? m.committed[s.side] && !m.committed[other] : m.phase === "revealing" ? m.revealed[s.side] && !m.revealed[other] : false;
    ($("claim") as HTMLElement).hidden = !(late && theyOweAMove);
    if (m.phase === "over") { if (timer) clearInterval(timer); timer = null; return; }

    // The bot plays from this browser too, with its own key. It commits before you choose.
    if (bot && m.phase === "waiting") await step("join", "The bot took the other seat.", joinInstruction(programId(), address, bot.publicKey, bot.publicKey), bot);
    if (bot && m.phase === "committing" && !m.committed[other]) {
      if (s.botPulls[m.round] === undefined) { s.botPulls[m.round] = practicePull({ round: m.round, node: m.node, energy: m.energy, result: "none", how: "none" }, other, Math.random); persist(); }
      const mv = moveFor(s, m.round, other, s.botPulls[m.round]), hash = commitment(address.toBytes(), mv.round, mv.side, mv.pull, mv.nonce);
      await step(tag, `The bot committed its move: ${hex(hash).slice(0, 16)}…`, commitInstruction(programId(), address, bot.publicKey, m.round, hash), bot);
    }
    if (m.phase === "revealing") {
      if (!m.revealed[s.side]) {
        const pull = s.pulls[m.round];
        if (pull === undefined) setStatus("This browser no longer has your move for this round, so it cannot be revealed. The round will be lost on time.", "bad");
        else {
          const mv = moveFor(s, m.round, s.side, pull);
          if (($("cheat") as HTMLInputElement).checked && cheated !== m.round) {
            cheated = m.round;
            const fake = pull === m.energy[s.side] ? pull - 1 : pull + 1;
            const r = await simulateOnly(NET, me.publicKey, [revealInstruction(programId(), address, me.publicKey, mv, revealData(address.toBytes(), m.round, s.side, fake, mv.nonce, { declaredDigest: m.commits[s.side] }))]);
            const v = readVerdict(r.logs);
            log({ tag, text: `Dry run: you committed ${pull} and tried to reveal ${fake}. ${r.failed ? "Refused, nothing changed." : "It was not refused, which should never happen."}`, ok: !r.failed ? true : false, phil: v.steps.find((x) => /REJECTED/.test(x)) ?? v.steps[v.steps.length - 1] ?? "" });
          }
          await step(tag, `You revealed ${pull}. Phil's server checked it against your commitment.`, revealInstruction(programId(), address, me.publicKey, mv), me);
        }
      }
      if (bot && !m.revealed[other] && s.botPulls[m.round] !== undefined) await step(tag, `The bot revealed ${s.botPulls[m.round]}.`, revealInstruction(programId(), address, bot.publicKey, moveFor(s, m.round, other, s.botPulls[m.round])), bot);
    }
  } catch (e: any) { $("after-note").textContent = String(e?.message ?? e); }
  finally { ticking = false; }
}
function watch(s: Saved): void { saved = s; persist(); seen = ""; cheated = 0; if (timer) clearInterval(timer); timer = setInterval(() => { void tick(); }, 2200); void tick(); try { history.replaceState(null, "", `?match=${s.match}`); } catch { /* sandboxed */ } $("key-note").hidden = false; }
async function commitChain(pull: number): Promise<void> {
  const s = saved!, m = await readMatch(s.match);
  if (!m || m.phase !== "committing") return;
  s.pulls[m.round] = pull; persist();                                    // kept before it is sent: without it the move could never be revealed
  const mv = moveFor(s, m.round, s.side, pull), address = new PublicKey(s.match), hash = commitment(address.toBytes(), mv.round, mv.side, mv.pull, mv.nonce);
  busy = true; render(); setStatus("Committing your hidden move…");
  const ok = await step(`round ${m.round}`, `You committed: ${hex(hash).slice(0, 16)}…`, commitInstruction(programId(), address, sessionKey().publicKey, m.round, hash), sessionKey());
  busy = false; seen = "";
  if (!ok) { delete s.pulls[m.round]; persist(); setStatus("Your move was not recorded. Try again.", "bad"); render(); }
  void tick();
}
async function withWallet(run: (w: PublicKey) => Promise<void>, button: HTMLElement): Promise<void> {
  if (!live) { setStatus("The referee is not on Solana yet. Practice in the browser for now.", "bad"); return; }
  button.classList.add("busy");
  try { wallet = wallet ?? await connectWallet(); $("no-wallet").hidden = true; await run(wallet); }
  catch (e: any) { if (!wallet) { $("no-wallet").hidden = false; $("no-wallet").innerHTML = noWalletHtml(NET, e); } else setStatus(esc(explain(e)), "bad"); }
  button.classList.remove("busy");
}
/** Top the page's own key up for fees, if it is low. */
async function topUp(w: PublicKey, to: PublicKey, want: number): Promise<TransactionInstruction[]> {
  const has: number = (await NET.rpc("getBalance", [to.toBase58(), { commitment: "confirmed" }])).value ?? 0;
  return has >= want / 2 ? [] : [SystemProgram.transfer({ fromPubkey: w, toPubkey: to, lamports: want - has })];
}
async function startChain(withBot: boolean, w: PublicKey): Promise<void> {
  const me = sessionKey(), bot = withBot ? Keypair.generate() : null;
  const rent: number = await NET.rpc("getMinimumBalanceForRentExemption", [MATCH_SIZE]);
  const made = openInstructions({ program: programId(), payer: w, player: me.publicKey, owner: w, windowSeconds: WINDOW_SECONDS, rentLamports: rent });
  const ixs = [...await topUp(w, me.publicKey, FEE_FLOAT), ...(bot ? [SystemProgram.transfer({ fromPubkey: w, toPubkey: bot.publicKey, lamports: FEE_FLOAT / 2 })] : []), ...made.instructions];
  const s: Saved = { match: made.match.publicKey.toBase58(), side: 0, seed: hex(randomBytes(32)), owner: w.toBase58(), bot: bot ? Array.from(bot.secretKey) : undefined, pulls: {}, botPulls: {} };
  store(keyOf(s.match), JSON.stringify(s));
  setStatus("Opening the match on Solana. Approve it in your wallet: this is the only prompt.");
  const signature = await signAndSend(NET, w, new Transaction().add(...ixs), [made.match, me], (t) => { $("after-note").textContent = t; });
  $("after-note").textContent = ""; $("reflog").innerHTML = "";
  log({ tag: "open", text: "You opened a match and took seat A.", phil: "Phil: ACCEPTED", signature });
  view = { ...idle(), referee: "solana", phase: "waiting", you: 0, names: ["You", withBot ? "Bot" : "Nobody yet"] }; render();
  watch(s);
}
async function joinChain(address: string, w: PublicKey): Promise<void> {
  const me = sessionKey(), match = new PublicKey(address);
  const ixs = [...await topUp(w, me.publicKey, FEE_FLOAT), joinInstruction(programId(), match, me.publicKey, w)];
  setStatus("Joining the match. Approve it in your wallet: this is the only prompt.");
  const signature = await signAndSend(NET, w, new Transaction().add(...ixs), [me], (t) => { $("after-note").textContent = t; });
  $("after-note").textContent = "";
  log({ tag: "join", text: "You took seat B.", phil: "Phil: ACCEPTED", signature });
  watch({ match: address, side: 1, seed: hex(randomBytes(32)), owner: w.toBase58(), pulls: {}, botPulls: {} });
}
/** Someone else's match, or one of yours from before: show it, and pick it up if this browser holds its key. */
let spectating: ReturnType<typeof setInterval> | null = null;
async function openMatch(address: string): Promise<void> {
  try { new PublicKey(address); } catch { setStatus("That is not a valid match address.", "bad"); return; }
  if (!live) return;
  let mine: Saved | null = null;
  try { mine = JSON.parse(store(keyOf(address)) ?? "null"); } catch { mine = null; }
  setStatus("Reading the match from Solana…");
  const m = await readMatch(address).catch(() => null);
  if (!m) { setStatus("There is no match at that address on Solana devnet.", "bad"); return; }
  if (mine && m.phase !== "over") { view = viewOf(m, address); watch(mine); return; }
  const show = async () => {
    const now = await readMatch(address).catch(() => null);
    if (!now) return;
    view = viewOf(now, address); render();
    const join = now.phase === "waiting";
    ($("claim") as HTMLElement).hidden = true; ($("sweep") as HTMLElement).hidden = true; ($("copy-link") as HTMLElement).hidden = true;
    $("join-wrap")?.remove();
    if (join) { setStatus(`<b>${esc(view.names[0])}</b> is waiting for an opponent. <button class="btn small" id="join" type="button">Join this match</button>`); $("join").addEventListener("click", () => { if (spectating) clearInterval(spectating); void withWallet((w) => joinChain(address, w), $("join")); }); if (spectating) { clearInterval(spectating); spectating = setInterval(() => { void readMatch(address).then((x) => { if (x && x.phase !== "waiting") void show(); }).catch(() => {}); }, 4000); } }
    else if (now.phase === "over") { setStatus(`<b>${esc(overText(view))}</b> ${when(now.endedTime)}.`); if (spectating) clearInterval(spectating); }
    else setStatus(`You are watching. Round <b>${now.round}</b>: ${now.phase === "committing" ? "the players are choosing" : "the moves are being opened"}.`);
  };
  await show();
  if (m.phase !== "over") { if (spectating) clearInterval(spectating); spectating = setInterval(() => { if (!saved) void show(); }, 3000); }
}

// ---- buttons ----
$("start-local").addEventListener("click", startLocal);
$("start-bot").addEventListener("click", () => { void withWallet((w) => startChain(true, w), $("start-bot")); });
$("start-friend").addEventListener("click", () => { void withWallet((w) => startChain(false, w), $("start-friend")); });
$("commit").addEventListener("click", () => {
  const pull = Number(($("pull-in") as HTMLInputElement).value);
  if (view.referee === "solana") void commitChain(pull); else void commitLocal(pull);
});
$("again").addEventListener("click", () => {
  stopChain(); if (spectating) clearInterval(spectating);
  view = idle(); local = null; busy = false; $("reflog").innerHTML = ""; $("key-note").hidden = true;
  for (const id of ["claim", "sweep", "copy-link"]) ($(id) as HTMLElement).hidden = true;
  try { history.replaceState(null, "", location.pathname); } catch { /* sandboxed */ }
  setStatus("Pick how to play."); render();
});
$("copy-link").addEventListener("click", async () => { const b = $("copy-link"); try { await navigator.clipboard.writeText(location.href); b.textContent = "Copied"; } catch { b.textContent = "Copy it from the address bar"; } setTimeout(() => { b.textContent = "Copy the match link"; }, 1600); });
$("claim").addEventListener("click", async () => {
  if (!saved) return;
  await step("time", "You called time: the other side did not move within the limit.", timeoutInstruction(programId(), new PublicKey(saved.match)), sessionKey());
  seen = ""; void tick();
});
$("sweep").addEventListener("click", async () => {
  const s = saved; if (!s) return;
  const note = $("after-note"); let total = 0;
  for (const k of [botKey(), sessionKey()]) {
    if (!k) continue;
    try { const has: number = (await NET.rpc("getBalance", [k.publicKey.toBase58(), { commitment: "confirmed" }])).value ?? 0;
      if (has > 10000) { await sendLocal(NET, [SystemProgram.transfer({ fromPubkey: k.publicKey, toPubkey: new PublicKey(s.owner), lamports: has - 5000 })], [k]); total += has - 5000; } } catch (e: any) { note.textContent = String(e?.message ?? e); return; }
  }
  note.textContent = total ? `Sent ${(total / 1e9).toFixed(4)} SOL back to ${short(s.owner)}.` : "There was nothing left to send.";
  ($("sweep") as HTMLElement).hidden = true;
});

// ---- matches on Solana ----
async function recent(): Promise<void> {
  const list = $("recent");
  const item = (address: string, title: string, sub: string) => `<li style="padding:11px 14px;border-top:1px solid var(--rule);font-size:14.5px"><a href="?match=${esc(address)}"><b>${esc(title)}</b></a><div class="muted" style="font-size:13px">${esc(sub)}</div></li>`;
  const nightly: string[] = (DEMO?.matches ?? []).map((d: any) => d.match);
  list.innerHTML = (DEMO?.matches ?? []).slice(0, 5).map((d: any) => item(d.match, `Nightly practice match, ${d.day}`, `${d.history.length} rounds · ${resultText({ result: d.result, how: d.how }, ["A", "B"])}`)).join("") || `<li style="padding:11px 14px" class="muted">${live ? "No recorded matches yet." : "The referee has not been deployed yet. The first nightly match will appear here."}</li>`;
  if (!live) return;
  try {
    const rows: any[] = await NET.rpc("getProgramAccounts", [PROGRAM.programId, { encoding: "base64", commitment: "confirmed", filters: [{ dataSize: MATCH_SIZE }] }]) ?? [];
    const found = rows.map((r) => ({ address: r.pubkey as string, m: decodeMatch(bytesOf(r.account.data[0])) })).filter((f) => f.m && !nightly.includes(f.address)).sort((a, b) => b.m!.openedTime - a.m!.openedTime).slice(0, 8);
    list.innerHTML += found.map(({ address, m }) => item(address, `${short(new PublicKey(m!.owners[0]).toBase58())} vs ${m!.phase === "waiting" ? "an open seat" : short(new PublicKey(m!.owners[1]).toBase58())}`,
      `${when(m!.openedTime)} · ${m!.phase === "over" ? `${m!.history.length} rounds · ${resultText(m!, ["A", "B"])}` : m!.phase === "waiting" ? "waiting for an opponent: open it to join" : `in play, round ${m!.round}`}`)).join("");
    $("recent-lead").textContent = `Every night two practice players play a whole match on devnet. Matches people have played from this page are listed too${rows.length ? `: ${rows.length} so far` : ""}.`;
  } catch { /* the nightly list is already shown */ }
}

// ---- the page ----
const facts: [string, string][] = [];
if (live) {
  facts.push(["Referee program", `<a href="${NET.explorer("address", PROGRAM.programId)}" rel="noopener">${esc(PROGRAM.programId)}</a>`]);
  if (PROGRAM.checkedOn) facts.push(["Last proven", `${esc(PROGRAM.checkedOn)}, on a local validator and on ${NET.name}`]);
  if (PROGRAM.selftest?.revealUnits) facts.push(["Cost of a reveal", `${Number(PROGRAM.selftest.revealUnits).toLocaleString("en-GB")} compute units`]);
  if (PROGRAM.philCommit) facts.push(["Phil's server from", `Phil <a href="https://github.com/abiggerhammer/phil/commit/${esc(PROGRAM.philCommit)}" rel="noopener">${esc(String(PROGRAM.philCommit).slice(0, 10))}</a>`]);
} else facts.push(["Referee program", "not deployed yet: practice in the browser works now"]);
facts.push(["Source", `<a href="https://github.com/philcoinhigh/Phil-tools/tree/main/line">line/runtime.c</a>, with its tests`]);
$("p-facts").innerHTML = facts.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join("");
if (!live) { ($("start-bot") as HTMLButtonElement).disabled = true; ($("start-friend") as HTMLButtonElement).disabled = true; $("net").textContent = "No stakes · Solana referee coming"; }
render();
void recent();
const asked = new URLSearchParams(location.search).get("match");
if (asked) void openMatch(asked);
wireFooter();
void landed;
