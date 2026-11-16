// The Line's referee, run natively: Phil's emitted upload server + line/runtime.c, with the
// harness standing in for Solana. Also checks the TypeScript rules against the program's.
import { execFileSync, execSync } from "child_process";
import { hex, unhex, sha256, concat } from "../site/src/draw";
import { openData, joinData, commitData, revealData, timeoutData, commitment, moveBytes, decodeMatch, playRound, newBoard, replay, practicePull, resultText,
  Match, Side, Board, MATCH_SIZE, OP_REVEAL, OP_COMMIT, KIND_REVEAL, KIND_COMMIT, START_ENERGY, ROUNDS } from "../site/src/line";

let fails = 0;
const check = (name: string, ok: boolean, info = "") => { if (!ok) { fails++; console.log("FAIL", name, info); } else console.log("ok  ", name); };
const BIN = "out/phil-line-native";
execSync(`giveaway/native/build.sh ${BIN} line/runtime.c`, { stdio: "inherit" });

const PROGRAM = "11".repeat(32), MATCH = "22".repeat(32), A = "aa".repeat(32), B = "bb".repeat(32), WA = "a1".repeat(32), WB = "b1".repeat(32), EVE = "ee".repeat(32), SYSTEM = "00".repeat(32);
const T0 = 1763000000, WINDOW = 120;
interface Acct { key: string; owner: string; flag: 0 | 1 | 2; data: Uint8Array }
function run(accounts: Acct[], ix: Uint8Array, time = T0) {
  const input = ["slot 7000", `time ${time}`, `program ${PROGRAM}`, ...accounts.map((a) => `account ${a.key} ${a.owner} ${a.flag} ${a.data.length ? hex(a.data) : "-"} 1`), `ix ${hex(ix)}`, ""].join("\n");
  const out = execFileSync(BIN, { input }).toString().split("\n");
  return { logs: out.filter((l) => l.startsWith("LOG ")).join("\n"), ret: Number(/RET (\d+)/.exec(out.find((l) => l.startsWith("RET ")) ?? "")?.[1] ?? -1), data: unhex((out.find((l) => l.startsWith("ACCOUNT 0 ")) ?? "").split(" ")[2] ?? "") };
}
const match = (data: Uint8Array = new Uint8Array(MATCH_SIZE), o: Partial<Acct> = {}): Acct => ({ key: MATCH, owner: PROGRAM, flag: 1, data, ...o });
const signer = (key: string, flag: 0 | 1 | 2 = 2): Acct => ({ key, owner: SYSTEM, flag, data: new Uint8Array(0) });
const M = unhex(MATCH), nonce = (n: number) => sha256(Uint8Array.of(n, n >> 8, 7));
const same = (r: { data: Uint8Array }, before: Uint8Array) => hex(r.data) === hex(before);

// ---- OPEN ----
const opened = run([match(), signer(A), signer(WA)], openData(WINDOW));
let m = decodeMatch(opened.data)!;
check("OPEN: Phil's server accepts, and player A is seated with the wallet it plays for", opened.ret === 0 && /Phil: ACCEPTED/.test(opened.logs) && m.phase === "waiting" && hex(m.players[0]) === A && hex(m.owners[0]) === WA && m.window === WINDOW && m.node === 3 && m.energy.join() === "30,30" && !m.invited && m.openedTime === T0, String(opened.ret));
let r = run([match(opened.data), signer(EVE)], openData(WINDOW));
check("OPEN: a match that exists cannot be opened over", r.ret === 1404 && same(r, opened.data), String(r.ret));
r = run([match(), signer(A)], openData(5));
check("OPEN: a time limit too short to play is refused", r.ret === 1802 && decodeMatch(r.data) === null, String(r.ret));
r = run([match(), signer(A, 0)], openData(WINDOW));
check("OPEN: the player's key must sign", r.ret === 1408, String(r.ret));
r = run([match(), signer(A), signer(WA, 0)], openData(WINDOW));
check("OPEN: a wallet cannot be named as owner without signing", r.ret === 1802, String(r.ret));
r = run([match(), signer(A)], openData(WINDOW, undefined, { kind: KIND_COMMIT }));
check("OPEN: the wrong kind of upload is refused by policy", r.ret === 1402, String(r.ret));
r = run([match(undefined, { owner: EVE }), signer(A)], openData(WINDOW));
check("OPEN: an account the program does not own is refused", r.ret === 1403, String(r.ret));
{ const good = openData(WINDOW), bent = good.slice(); bent[bent.length - 1] ^= 1;
  r = run([match(), signer(A)], bent);
  check("OPEN: bytes that do not match their declared digest are rejected by Phil", r.ret === 1201 && /do not match the declared digest/.test(r.logs), String(r.ret));
  r = run([match(), signer(A)], concat(good, Uint8Array.of(0)));
  check("OPEN: bytes left over after the upload fail the transaction", r.ret === 120, String(r.ret)); }
const solo = run([match(), signer(A)], openData(WINDOW));
check("OPEN: a player key may play for itself", solo.ret === 0 && hex(decodeMatch(solo.data)!.owners[0]) === A);

// ---- JOIN ----
r = run([match(opened.data), signer(A), signer(WA)], joinData());
check("JOIN: the same key cannot sit on both sides", r.ret === 1804 && same(r, opened.data), String(r.ret));
const joined = run([match(opened.data), signer(B), signer(WB)], joinData(), T0 + 30);
m = decodeMatch(joined.data)!;
check("JOIN: player B is seated and round 1 opens", joined.ret === 0 && m.phase === "committing" && m.round === 1 && hex(m.players[1]) === B && hex(m.owners[1]) === WB && m.phaseStart === T0 + 30 && m.history.length === 0, String(joined.ret));
r = run([match(joined.data), signer(EVE)], joinData());
check("JOIN: a full match cannot be joined", r.ret === 1404 && same(r, joined.data), String(r.ret));
const invite = run([match(), signer(A), signer(WA)], openData(WINDOW, unhex(WB)));
r = run([match(invite.data), signer(EVE), signer(EVE)], joinData());
check("JOIN: an invitation is for one wallet", decodeMatch(invite.data)!.invited && r.ret === 1803 && same(r, invite.data), String(r.ret));
r = run([match(invite.data), signer(B), signer(WB)], joinData());
check("JOIN: the invited wallet gets in", r.ret === 0 && decodeMatch(r.data)!.phase === "committing");

// ---- COMMIT ----
const nA = nonce(1), nB = nonce(2), hA = commitment(M, 1, 0, 12, nA), hB = commitment(M, 1, 1, 9, nB);
r = run([match(joined.data), signer(EVE)], commitData(1, hA));
check("COMMIT: only the two players may move", r.ret === 1405 && same(r, joined.data), String(r.ret));
r = run([match(joined.data), signer(A, 0)], commitData(1, hA));
check("COMMIT: a move must be signed by its player", r.ret === 1408, String(r.ret));
r = run([match(joined.data), signer(A)], commitData(2, hA));
check("COMMIT: a commit names its round, and another round's is refused", r.ret === 1805 && same(r, joined.data), String(r.ret));
r = run([match(joined.data), signer(A)], commitData(1, hA), T0 + 30 + WINDOW + 1);
check("COMMIT: after the time limit it is too late", r.ret === 1806 && same(r, joined.data), String(r.ret));
const cA = run([match(joined.data), signer(A)], commitData(1, hA), T0 + 40);
m = decodeMatch(cA.data)!;
check("COMMIT: A's hidden move is recorded, and nothing about it but its hash", cA.ret === 0 && m.committed.join() === "true,false" && hex(m.commits[0]) === hex(hA) && m.phase === "committing" && !hex(cA.data).includes(hex(nA)), String(cA.ret));
r = run([match(cA.data), signer(A)], commitData(1, commitment(M, 1, 0, 30, nA)), T0 + 41);
check("COMMIT: a move is final; a second one is refused", r.ret === 1406 && same(r, cA.data), String(r.ret));
r = run([match(cA.data), signer(A)], revealData(M, 1, 0, 12, nA), T0 + 41);
check("REVEAL: nobody can reveal before both sides have committed", r.ret === 1404 && same(r, cA.data), String(r.ret));
const cB = run([match(cA.data), signer(B)], commitData(1, hB), T0 + 50);
m = decodeMatch(cB.data)!;
check("COMMIT: when both have committed, reveals open and the clock restarts", cB.ret === 0 && m.phase === "revealing" && m.committed.join() === "true,true" && m.phaseStart === T0 + 50 && /both sides have committed/.test(cB.logs));
r = run([match(cB.data), signer(A)], commitData(1, hA), T0 + 51);
check("COMMIT: no commits during reveals", r.ret === 1404, String(r.ret));

// ---- REVEAL: the commitment is opened by Phil's server ----
r = run([match(cB.data), signer(A)], revealData(M, 1, 0, 30, nA), T0 + 55);
check("REVEAL: a different pull, declared honestly, is refused before any payload is read: it is not the commitment", r.ret === 1407 && /REJECTED by policy before any payload was read/.test(r.logs) && same(r, cB.data), String(r.ret));
r = run([match(cB.data), signer(A)], revealData(M, 1, 0, 30, nA, { declaredDigest: hA }), T0 + 55);
check("REVEAL: a different pull that claims the committed hash is rejected by Phil: the bytes do not match", r.ret === 1201 && /Phil: REJECTED, the bytes do not match the declared digest/.test(r.logs) && same(r, cB.data), String(r.ret));
r = run([match(cB.data), signer(A)], revealData(M, 1, 0, 12, nonce(9), { declaredDigest: hA }), T0 + 55);
check("REVEAL: the right pull with the wrong nonce is rejected by Phil too", r.ret === 1201 && same(r, cB.data), String(r.ret));
r = run([match(cB.data), signer(B)], revealData(M, 1, 0, 12, nA), T0 + 55);
check("REVEAL: one side cannot open the other side's commitment", r.ret === 1407 && same(r, cB.data), String(r.ret));
r = run([match(cB.data), signer(A)], revealData(M, 1, 0, 12, nA), T0 + 50 + WINDOW + 1);
check("REVEAL: after the time limit it is too late", r.ret === 1806 && same(r, cB.data), String(r.ret));
const rA = run([match(cB.data), signer(A)], revealData(M, 1, 0, 12, nA), T0 + 60);
m = decodeMatch(rA.data)!;
check("REVEAL: the committed move is accepted by Phil and recorded", rA.ret === 0 && /Phil: SHA-256 matches the declared digest/.test(rA.logs) && /Phil: ACCEPTED/.test(rA.logs) && m.revealed.join() === "true,false" && m.pulls[0] === 12 && m.phase === "revealing" && m.round === 1, String(rA.ret));
r = run([match(rA.data), signer(A)], revealData(M, 1, 0, 12, nA), T0 + 61);
check("REVEAL: a second copy of a reveal is refused", r.ret === 1406 && same(r, rA.data), String(r.ret));
const rB = run([match(rA.data), signer(B)], revealData(M, 1, 1, 9, nB), T0 + 70);
m = decodeMatch(rB.data)!;
check("REVEAL: when both are open the round is played: 12 beats 9, the node moves toward A, both pay", rB.ret === 0 && /ROUND PLAYED/.test(rB.logs) && m.node === 2 && m.energy.join() === "20,23" && m.round === 2 && m.phase === "committing" && m.history.join("|") === "12,9" && m.committed.join() === "false,false" && hex(m.commits[0]) === "00".repeat(32) && m.phaseStart === T0 + 70, JSON.stringify([m.node, m.energy, m.round]));
// A commitment that can never be opened: it names another match, round or side, or pulls more than there is.
const commitBoth = (data: Uint8Array, round: number, a: Uint8Array, b: Uint8Array, t: number) => run([match(run([match(data), signer(A)], commitData(round, a), t).data), signer(B)], commitData(round, b), t);
{ const okB = commitment(M, 2, 1, 0, nB);
  for (const [name, bytes, code] of [
    ["another round", moveBytes(M, 3, 0, 5, nA), 1807], ["the other side", moveBytes(M, 2, 1, 5, nA), 1807], ["another match", moveBytes(unhex(EVE), 2, 0, 5, nA), 1807], ["more than its energy", moveBytes(M, 2, 0, 21, nA), 1808],
  ] as [string, Uint8Array, number][]) {
    const both = commitBoth(rB.data, 2, sha256(bytes), okB, T0 + 80);
    r = run([match(both.data), signer(A)], concat(Uint8Array.of(OP_REVEAL), revealData(M, 2, 0, 0, nA, { declaredDigest: sha256(bytes) }).slice(1, -67), bytes), T0 + 81);
    check(`REVEAL: a commitment to ${name} opens, but is not a move`, both.ret === 0 && r.ret === code && same(r, both.data), String(r.ret));
  } }

// ---- TIMEOUT ----
r = run([match(cA.data)], timeoutData(), T0 + 30 + WINDOW);
check("TIMEOUT: not before the limit has passed", r.ret === 133 && same(r, cA.data), String(r.ret));
r = run([match(cA.data)], timeoutData(), T0 + 30 + WINDOW + 1);
m = decodeMatch(r.data)!;
check("TIMEOUT: the side that did not commit forfeits", r.ret === 0 && m.phase === "over" && m.result === "a" && m.how === "no-commit" && m.endedTime === T0 + 30 + WINDOW + 1 && m.history.length === 0 && /B did not move in time/.test(resultText(m)), JSON.stringify([r.ret, m.result, m.how]));
const over = r.data;
r = run([match(joined.data)], timeoutData(), T0 + 30 + WINDOW + 1);
check("TIMEOUT: if neither side moved the match is void", r.ret === 0 && decodeMatch(r.data)!.result === "void" && decodeMatch(r.data)!.how === "nobody-moved");
{ const onlyB = run([match(cB.data), signer(B)], revealData(M, 1, 1, 9, nB), T0 + 60);
  r = run([match(onlyB.data)], timeoutData(), T0 + 50 + WINDOW + 1);
  m = decodeMatch(r.data)!;
  check("TIMEOUT: a side that committed and did not reveal forfeits", r.ret === 0 && m.result === "b" && m.how === "no-reveal" && /A committed a move and did not reveal it in time/.test(resultText(m)), JSON.stringify([m.result, m.how])); }
r = run([match(over)], timeoutData(), T0 + 9999);
check("TIMEOUT: a finished match cannot be timed out again", r.ret === 132 && same(r, over), String(r.ret));
r = run([match(opened.data)], timeoutData(), T0 + 9999);
check("TIMEOUT: a match still waiting for an opponent is left alone", r.ret === 132, String(r.ret));
r = run([match(over), signer(A)], commitData(1, hA), T0 + 9999);
check("a finished match takes no more moves", r.ret === 1404 && same(r, over), String(r.ret));
r = run([match(cA.data)], concat(timeoutData(), Uint8Array.of(1)), T0 + 9999);
check("TIMEOUT: takes no data", r.ret === 103, String(r.ret));
r = run([match(cA.data)], Uint8Array.of(9));
check("an unknown instruction is refused", r.ret === 103, String(r.ret));

// ---- whole matches: the program and the TypeScript rules must agree on every round ----
let seed = 20261116;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const tally: Record<string, number> = {}; let rounds = 0, agreed = true, why = "";
for (let game = 0; game < 30 && agreed; game++) {
  let data = joined.data, board: Board = newBoard(), t = T0 + 100;
  const style = game % 3;                                   // practice against practice, against random, against all-in
  while (board.result === "none") {
    const round = board.round;
    const a = practicePull(board, 0, rand), b = style === 0 ? practicePull(board, 1, rand) : style === 1 ? Math.floor(rand() * (board.energy[1] + 1)) : board.energy[1];
    const na = nonce(round * 2 + game * 64), nb = nonce(round * 2 + 1 + game * 64);
    data = commitBoth(data, round, commitment(M, round, 0, a, na), commitment(M, round, 1, b, nb), ++t).data;
    data = run([match(data), signer(B)], revealData(M, round, 1, b, nb), ++t).data;      // B reveals first this time
    data = run([match(data), signer(A)], revealData(M, round, 0, a, na), ++t).data;
    board = playRound(board, a, b); rounds++;
    const got = decodeMatch(data)!;
    const expectPhase = board.result === "none" ? "committing" : "over";
    if (got.node !== board.node || got.energy.join() !== board.energy.join() || got.result !== board.result || got.how !== board.how || got.phase !== expectPhase || got.round !== board.round || got.history.length !== (board.result === "none" ? board.round - 1 : board.round)) { agreed = false; why = `game ${game} round ${round}: program ${JSON.stringify([got.node, got.energy, got.result, got.how, got.round])} rules ${JSON.stringify(board)}`; }
    if (board.result !== "none") { const again = replay(got.history); if (JSON.stringify(again[again.length - 1]) !== JSON.stringify(board)) { agreed = false; why = "replay from the account's history differs"; } }
  }
  tally[`${board.result}/${board.how}`] = (tally[`${board.result}/${board.how}`] ?? 0) + 1;
}
check(`30 whole matches (${rounds} rounds): the program and the page's rules agree after every round`, agreed, why);
check("those matches ended in more than one way", Object.keys(tally).length >= 3, JSON.stringify(tally));
console.log("     endings:", JSON.stringify(tally));

// ---- the rules themselves ----
check("rules: equal pulls hold the node and both still pay", (() => { const b = playRound(newBoard(), 7, 7); return b.node === 3 && b.energy.join() === "25,25" && b.round === 2; })());
check("rules: energy comes back 2 a round and never passes 30", (() => { let b = playRound(newBoard(), 0, 0); return b.energy.join() === "30,30" && (b = playRound(b, 30, 1)).energy.join() === "2,30"; })());
check("rules: three places wins at once", (() => { let b = newBoard(); for (let i = 0; i < 3; i++) b = playRound(b, 0, 1); return b.result === "b" && b.how === "reached-end" && b.node === 6 && b.round === 3; })());
check("rules: fifteen held rounds is a draw", (() => { let b = newBoard(); for (let i = 0; i < ROUNDS; i++) b = playRound(b, 0, 0); return b.result === "drawn" && b.how === "fifteen-rounds"; })());
check("rules: a pull above a side's energy is not a move", (() => { try { playRound(newBoard(), START_ENERGY + 1, 0); return false; } catch { return true; } })());
check("practice opponent: always a legal pull", (() => { let b = newBoard(); for (let i = 0; i < 400; i++) { const a = practicePull(b, 0, rand), bb = practicePull(b, 1, rand); if (a > b.energy[0] || bb > b.energy[1] || a < 0 || bb < 0) return false; b = playRound(b, a, bb); if (b.result !== "none") b = newBoard(); } return true; })());
void OP_COMMIT; void KIND_REVEAL; void (0 as Side); void (null as unknown as Match);

console.log(fails ? `line: ${fails} FAILED` : "line: all passed");
process.exit(fails ? 1 : 0);
