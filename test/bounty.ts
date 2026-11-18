// Clip Bounties, run natively: Phil's emitted server and bounty/runtime.c, with the harness standing in for Solana.
import { execFileSync, execSync } from "child_process";
import { hex, unhex, sha256, concat } from "../site/src/draw";
import { postData, enterData, decodeBounty, decodeEntry, drawnIndex, safeLink, BOUNTY_SIZE, ENTRY_SIZE, OP_AWARD, OP_ARM, OP_DRAW, OP_CLAIM, OP_REFUND, KIND_POST, DRAW_AHEAD } from "../site/src/bounty";

let fails = 0;
const check = (name: string, ok: boolean, info = "") => { if (!ok) { fails++; console.log("FAIL", name, info); } else console.log("ok  ", name); };
execSync("giveaway/native/build.sh out/phil-bounty-native bounty/runtime.c", { stdio: "inherit" });
const BIN = "out/phil-bounty-native", PROGRAM = "99".repeat(32), SYSTEM = "00".repeat(32);
const TOKEN = "06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9", SLOT_HASHES = "06a7d517192f0aafc6f265e3fb77cc7ada82c529d0be3b136e2d005520000000";
const BOUNTY = "b0".repeat(32), SPONSOR = "50".repeat(32), ALICE = "a1".repeat(32), BOB = "b2".repeat(32), MALLORY = "e7".repeat(32), MINT = "33".repeat(32);
interface Acct { key: string; owner: string; flag: 0 | 1 | 2; data: Uint8Array; lamports: bigint }
let clock = 1763000000, slot = 7000;
function run(accounts: Acct[], ix: Uint8Array) {
  const input = [`slot ${slot}`, `time ${clock}`, `program ${PROGRAM}`, ...accounts.map((a) => `account ${a.key} ${a.owner} ${a.flag} ${a.data.length ? hex(a.data) : "-"} ${a.lamports}`), `ix ${hex(ix)}`, ""].join("\n");
  const out = execFileSync(BIN, { input }).toString().split("\n");
  return { logs: out.filter((l) => l.startsWith("LOG ")).join("\n"), ret: Number(/RET (\d+)/.exec(out.find((l) => l.startsWith("RET ")) ?? "")?.[1] ?? -1),
    all: out.filter((l) => l.startsWith("ACCOUNT ")).map((l) => unhex(l.split(" ")[2] ?? "")), lamports: out.filter((l) => l.startsWith("LAMPORTS ")).map((l) => BigInt(l.split(" ")[2])) };
}
const RENT = 4_454_400n, ENTRY_RENT = 3_118_080n, SOL = 1_000_000_000n, DAY = 86400, BUMP = 251;
const bountyAcct = (data: Uint8Array, lamports: bigint, o: Partial<Acct> = {}): Acct => ({ key: BOUNTY, owner: PROGRAM, flag: 1, data, lamports, ...o });
const wallet = (key: string, flag: 0 | 1 | 2 = 1, lamports = 0n): Acct => ({ key, owner: SYSTEM, flag, data: new Uint8Array(0), lamports });
const entryAcct = (key: string, data: Uint8Array = new Uint8Array(ENTRY_SIZE), o: Partial<Acct> = {}): Acct => ({ key, owner: PROGRAM, flag: 1, data, lamports: ENTRY_RENT, ...o });
const u64le = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };
const tokenAcct = (key: string, mint: string, owner: string, amount: bigint): Acct => { const d = new Uint8Array(165); d.set(unhex(mint), 0); d.set(unhex(owner), 32); d.set(u64le(amount), 64); d[108] = 1; return { key, owner: TOKEN, flag: 1, data: d, lamports: 2_039_280n }; };
const mintAcct = (key = MINT): Acct => { const d = new Uint8Array(82); d[44] = 6; d[45] = 1; return { key, owner: TOKEN, flag: 0, data: d, lamports: 1n }; };
const held = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset).getBigUint64(64, true);
const AUTHORITY = hex(sha256(concat(new TextEncoder().encode("cb"), unhex(BOUNTY), Uint8Array.of(BUMP), unhex(PROGRAM), new TextEncoder().encode("ProgramDerivedAddress"))));
const slotHashes = (entries: [number, Uint8Array][]): Acct => { const d = new Uint8Array(8 + 40 * entries.length); const v = new DataView(d.buffer); v.setBigUint64(0, BigInt(entries.length), true); entries.forEach(([s, h], i) => { v.setBigUint64(8 + 40 * i, BigInt(s), true); d.set(h, 16 + 40 * i); }); return { key: SLOT_HASHES, owner: SYSTEM, flag: 0, data: d, lamports: 1n }; };
const empty = new Uint8Array(BOUNTY_SIZE), TEXT = "First clip of a five-star escape that ends in the sea", DEADLINE = clock + 2 * DAY;
const terms = { bump: BUMP, deadline: DEADLINE, graceSeconds: DAY, prize: SOL, text: TEXT };

// ---- POST ----
const posted = run([bountyAcct(empty, RENT + SOL), wallet(SPONSOR, 2)], postData(terms));
let b = decodeBounty(posted.all[0])!;
check("POST: a sponsor posts a challenge with its prize locked", posted.ret === 0 && b.state === "open" && b.prize === SOL && b.reserve === RENT && hex(b.sponsor) === SPONSOR && b.text === TEXT && b.deadline === DEADLINE && b.count === 0 && b.mint === null && /POSTED/.test(posted.logs), `${posted.ret} ${posted.logs}`);
let r = run([bountyAcct(empty, RENT), wallet(SPONSOR, 2)], postData(terms));
check("POST: a challenge cannot be posted without its prize in the account", r.ret === 1804, String(r.ret));
r = run([bountyAcct(empty, RENT + SOL), wallet(SPONSOR, 1)], postData(terms));
check("POST: the sponsor has to sign", r.ret === 1803, String(r.ret));
r = run([bountyAcct(empty, RENT + SOL), wallet(SPONSOR, 2)], postData({ ...terms, deadline: clock - 1 }));
check("POST: a deadline in the past is refused", r.ret === 1802, String(r.ret));
r = run([bountyAcct(empty, RENT + SOL), wallet(SPONSOR, 2)], postData({ ...terms, deadline: clock + 91 * DAY }));
check("POST: a deadline more than 90 days away is refused", r.ret === 1802, String(r.ret));
r = run([bountyAcct(empty, RENT + SOL), wallet(SPONSOR, 2)], postData({ ...terms, prize: 0n }));
check("POST: a prize of nothing is refused", r.ret === 1802, String(r.ret));
r = run([bountyAcct(posted.all[0], RENT + SOL), wallet(SPONSOR, 2)], postData({ ...terms, text: "replaced" }));
check("POST: a posted challenge cannot be posted over", r.ret === 1404, String(r.ret));
{ const d = postData(terms); d[d.length - 1] ^= 1; r = run([bountyAcct(empty, RENT + SOL), wallet(SPONSOR, 2)], d); }
check("POST: text changed after it was sealed is REJECTED by Phil", r.ret === 1201, String(r.ret));
r = run([bountyAcct(empty, RENT + SOL), wallet(SPONSOR, 2)], postData(terms, { kind: "phil-bounty/enter" }));
check("POST: an upload of the wrong kind is refused by policy", r.ret === 1402, String(r.ret));
r = run([bountyAcct(empty, RENT + SOL, { owner: SYSTEM }), wallet(SPONSOR, 2)], postData(terms));
check("POST: an account the program does not own is refused", r.ret === 1403, String(r.ret));
r = run([bountyAcct(empty, RENT + SOL), wallet(SPONSOR, 2)], postData({ ...terms, text: "x".repeat(281) }));
check("POST: text longer than 280 bytes is refused", r.ret === 1801 || r.ret === 1401, String(r.ret));

// ---- ENTER ----
const LINK_A = "https://x.com/alice/status/1234567890", LINK_B = "https://www.youtube.com/watch?v=abcdefghijk";
const E_A = "ea".repeat(32), E_B = "eb".repeat(32), E_C = "ec".repeat(32);
clock += 3600;
const in1 = run([bountyAcct(posted.all[0], RENT + SOL), entryAcct(E_A), wallet(ALICE, 2)], enterData(LINK_A));
let e = decodeEntry(in1.all[1])!;
check("ENTER: an entry is numbered, timed and tied to its wallet and its bounty", in1.ret === 0 && e.index === 0 && e.link === LINK_A && hex(e.entrant) === ALICE && hex(e.bounty) === BOUNTY && e.time === clock && decodeBounty(in1.all[0])!.count === 1, `${in1.ret} ${in1.logs}`);
clock += 60;
const in2 = run([bountyAcct(in1.all[0], RENT + SOL), entryAcct(E_B), wallet(BOB, 2)], enterData(LINK_B));
check("ENTER: the next entry gets the next number", in2.ret === 0 && decodeEntry(in2.all[1])!.index === 1 && decodeBounty(in2.all[0])!.count === 2);
const entryA = in1.all[1], entryB = in2.all[1], two = in2.all[0];
r = run([bountyAcct(two, RENT + SOL), entryAcct(E_C), wallet(MALLORY, 1)], enterData(LINK_A));
check("ENTER: the entrant has to sign: nobody can enter in another wallet's name", r.ret === 1803, String(r.ret));
r = run([bountyAcct(two, RENT + SOL), entryAcct(E_A, entryA), wallet(MALLORY, 2)], enterData("https://x.com/mallory/status/1"));
check("ENTER: an existing entry cannot be written over", r.ret === 1806, String(r.ret));
{ const d = enterData(LINK_A); d[d.length - 3] ^= 1; r = run([bountyAcct(two, RENT + SOL), entryAcct(E_C), wallet(ALICE, 2)], d); }
check("ENTER: a link changed after it was sealed is REJECTED by Phil", r.ret === 1201, String(r.ret));
clock = DEADLINE + 1;
r = run([bountyAcct(two, RENT + SOL), entryAcct(E_C), wallet(MALLORY, 2)], enterData("https://x.com/late/status/1"));
check("ENTER: no entries after the deadline", r.ret === 1805, String(r.ret));

// ---- AWARD: the sponsor picks ----
clock = DEADLINE - 100;
const award = (accounts: Acct[]) => run(accounts, Uint8Array.of(OP_AWARD));
const won = award([bountyAcct(two, RENT + SOL), wallet(SPONSOR, 2), entryAcct(E_B, entryB, { flag: 0 }), wallet(BOB, 1)]);
b = decodeBounty(won.all[0])!;
check("AWARD: the sponsor picks an entry and its entrant is paid the whole prize", won.ret === 0 && b.state === "paid" && b.how === "sponsor" && b.winnerIndex === 1 && hex(b.winner) === BOB && won.lamports[0] === RENT && won.lamports[3] === SOL && /AWARDED/.test(won.logs), `${won.ret} ${won.logs}`);
r = award([bountyAcct(two, RENT + SOL), wallet(MALLORY, 2), entryAcct(E_B, entryB, { flag: 0 }), wallet(BOB, 1)]);
check("AWARD: only the sponsor can pick", r.ret === 303, String(r.ret));
r = award([bountyAcct(two, RENT + SOL), wallet(SPONSOR, 2), entryAcct(E_B, entryB, { flag: 0 }), wallet(SPONSOR, 1)]);
check("AWARD: the prize cannot be sent anywhere but to the entry's own wallet, the sponsor's included", r.ret === 306, String(r.ret));
{ const fake = entryB.slice(); fake.set(unhex(MALLORY), 40); r = award([bountyAcct(two, RENT + SOL), wallet(SPONSOR, 2), entryAcct(E_C, fake, { flag: 0, owner: SYSTEM }), wallet(MALLORY, 1)]); }
check("AWARD: a made-up entry account is refused", r.ret === 305, String(r.ret));
{ const other = entryB.slice(); other.set(unhex("77".repeat(32)), 8); r = award([bountyAcct(two, RENT + SOL), wallet(SPONSOR, 2), entryAcct(E_C, other, { flag: 0 }), wallet(BOB, 1)]); }
check("AWARD: an entry to a different bounty is refused", r.ret === 305, String(r.ret));
r = award([bountyAcct(won.all[0], RENT), wallet(SPONSOR, 2), entryAcct(E_A, entryA, { flag: 0 }), wallet(ALICE, 1)]);
check("AWARD: the prize is paid once: a second award is refused", r.ret === 302, String(r.ret));

// ---- the sponsor goes quiet: ARM, DRAW, CLAIM ----
const arm = (data: Uint8Array) => run([bountyAcct(data, RENT + SOL)], Uint8Array.of(OP_ARM));
clock = DEADLINE + DAY - 5;
r = arm(two);
check("ARM: nobody can start the draw while the sponsor still has time to pick", r.ret === 311, String(r.ret));
clock = DEADLINE + DAY + 5; slot = 9000;
const armed = arm(two);
check("ARM: after the grace time anyone starts the draw, and it names a block that does not exist yet", armed.ret === 0 && decodeBounty(armed.all[0])!.drawSlot === BigInt(9000 + DRAW_AHEAD), `${armed.ret}`);
r = arm(armed.all[0]);
check("ARM: a draw that is waiting for its block cannot be restarted", r.ret === 312, String(r.ret));
r = award([bountyAcct(armed.all[0], RENT + SOL), wallet(SPONSOR, 2), entryAcct(E_B, entryB, { flag: 0 }), wallet(BOB, 1)]);
check("ARM: once the draw has started the sponsor can no longer pick", r.ret === 304, String(r.ret));
r = run([bountyAcct(armed.all[0], RENT + SOL), entryAcct(E_C), wallet(MALLORY, 2)], enterData("https://x.com/late/status/2"));
check("ARM: and nobody can add entries", r.ret === 1805, String(r.ret));
const h = (n: number) => sha256(Uint8Array.of(n)), TARGET = 9000 + DRAW_AHEAD;
const draw = (data: Uint8Array, hashes: Acct) => run([bountyAcct(data, RENT + SOL), hashes], Uint8Array.of(OP_DRAW));
slot = TARGET;
r = draw(armed.all[0], slotHashes([[TARGET - 1, h(1)]]));
check("DRAW: not before the named block has passed", r.ret === 321, String(r.ret));
slot = TARGET + 3;
r = draw(armed.all[0], { ...slotHashes([[TARGET + 2, h(9)]]), key: MALLORY });
check("DRAW: block hashes are only taken from Solana's own record of them", r.ret === 320, String(r.ret));
// The named slot was skipped, so the first block after it draws.
const drawn = draw(armed.all[0], slotHashes([[TARGET + 2, h(7)], [TARGET + 1, h(5)], [TARGET - 1, h(3)]]));
b = decodeBounty(drawn.all[0])!;
const expected = drawnIndex(h(5), unhex(BOUNTY), 2);
check("DRAW: the first block at or after the named one picks an entry number, and anyone can redo the sum", drawn.ret === 0 && b.state === "drawn" && b.how === "draw" && b.hashSlot === BigInt(TARGET + 1) && hex(b.slotHash) === hex(h(5)) && b.winnerIndex === expected, `${drawn.ret} ${b.winnerIndex} ${expected}`);
r = draw(drawn.all[0], slotHashes([[TARGET + 2, h(8)]]));
check("DRAW: a draw happens once", r.ret === 302, String(r.ret));
const winnerEntry = expected === 0 ? [E_A, entryA, ALICE] as const : [E_B, entryB, BOB] as const, loserEntry = expected === 0 ? [E_B, entryB, BOB] as const : [E_A, entryA, ALICE] as const;
const claim = (data: Uint8Array, lamports: bigint, en: readonly [string, Uint8Array, string], to: string) => run([bountyAcct(data, lamports), entryAcct(en[0], en[1], { flag: 0 }), wallet(to, 1)], Uint8Array.of(OP_CLAIM));
r = claim(drawn.all[0], RENT + SOL, loserEntry, loserEntry[2]);
check("CLAIM: an entry that was not drawn cannot take the prize", r.ret === 305, String(r.ret));
r = claim(drawn.all[0], RENT + SOL, winnerEntry, MALLORY);
check("CLAIM: the drawn entry's prize cannot be sent to another wallet", r.ret === 306, String(r.ret));
const claimed = claim(drawn.all[0], RENT + SOL, winnerEntry, winnerEntry[2]);
b = decodeBounty(claimed.all[0])!;
check("CLAIM: anyone can send it, and the drawn entry's wallet is paid", claimed.ret === 0 && b.state === "paid" && hex(b.winner) === winnerEntry[2] && claimed.lamports[0] === RENT && claimed.lamports[2] === SOL, `${claimed.ret} ${claimed.logs}`);
r = claim(claimed.all[0], RENT, winnerEntry, winnerEntry[2]);
check("CLAIM: once", r.ret === 302, String(r.ret));
// The draw's block was missed: after the window anyone may start it again.
slot = TARGET + 600;
r = draw(armed.all[0], slotHashes(Array.from({ length: 512 }, (_, i) => [TARGET + 599 - i, h(i & 255)] as [number, Uint8Array])));
check("DRAW: a block whose hash is no longer kept draws nothing", r.ret === 322, String(r.ret));
r = arm(armed.all[0]);
check("ARM: and the draw can then be started again", r.ret === 0 && decodeBounty(r.all[0])!.drawSlot === BigInt(TARGET + 600 + DRAW_AHEAD), String(r.ret));

// ---- REFUND: only when nobody entered ----
const refund = (data: Uint8Array, to: string) => run([bountyAcct(data, RENT + SOL), wallet(to, 1)], Uint8Array.of(OP_REFUND));
clock = DEADLINE + 1;
r = refund(two, SPONSOR);
check("REFUND: with entries in, the sponsor cannot take the prize back", r.ret === 340, String(r.ret));
clock = DEADLINE - 1;
r = refund(posted.all[0], SPONSOR);
check("REFUND: not before the deadline", r.ret === 341, String(r.ret));
clock = DEADLINE + 1;
r = refund(posted.all[0], MALLORY);
check("REFUND: only to the sponsor", r.ret === 306, String(r.ret));
const back = refund(posted.all[0], SPONSOR);
check("REFUND: if nobody entered, the prize goes back to the sponsor", back.ret === 0 && decodeBounty(back.all[0])!.state === "refunded" && back.lamports[1] === SOL && back.lamports[0] === RENT, String(back.ret));
r = arm(posted.all[0]);
check("ARM: a bounty with no entries has nothing to draw", r.ret === 310, String(r.ret));

// ---- a token prize ----
clock = 1763000000;
const VTOK = "44".repeat(32), BTOK = "b7".repeat(32), authority: Acct = { key: AUTHORITY, owner: SYSTEM, flag: 0, data: new Uint8Array(0), lamports: 0n }, tokenProgram: Acct = { key: TOKEN, owner: SYSTEM, flag: 0, data: new Uint8Array(0), lamports: 1n };
const tterms = { ...terms, prize: 500_000000n };
const tposted = run([bountyAcct(empty, RENT), wallet(SPONSOR, 2), tokenAcct(VTOK, MINT, AUTHORITY, 500_000000n), mintAcct()], postData(tterms));
b = decodeBounty(tposted.all[0])!;
check("TOKEN: a challenge is posted with a token prize held where only the program can sign", tposted.ret === 0 && hex(b.mint!) === MINT && b.prize === 500_000000n && b.bump === BUMP, `${tposted.ret}`);
r = run([bountyAcct(empty, RENT), wallet(SPONSOR, 2), tokenAcct(VTOK, MINT, AUTHORITY, 499_999999n), mintAcct()], postData(tterms));
check("TOKEN: not if the token account holds less than the prize", r.ret === 1804, String(r.ret));
r = run([bountyAcct(empty, RENT), wallet(SPONSOR, 2), tokenAcct(VTOK, MINT, SPONSOR, 500_000000n), mintAcct()], postData(tterms));
check("TOKEN: not if the sponsor could still move the tokens", r.ret === 1804, String(r.ret));
const tin = run([bountyAcct(tposted.all[0], RENT), entryAcct(E_B), wallet(BOB, 2)], enterData(LINK_B));
const tAward = (to: Acct, from = tokenAcct(VTOK, MINT, AUTHORITY, 500_000000n)) => award([bountyAcct(tin.all[0], RENT), wallet(SPONSOR, 2), entryAcct(E_B, tin.all[1], { flag: 0 }), to, from, mintAcct(), authority, tokenProgram]);
const twon = tAward(tokenAcct(BTOK, MINT, BOB, 0n));
check("TOKEN: the winner's token account is paid the whole prize", twon.ret === 0 && held(twon.all[3]) === 500_000000n && held(twon.all[4]) === 0n && decodeBounty(twon.all[0])!.state === "paid", `${twon.ret} ${twon.logs}`);
r = tAward(tokenAcct(BTOK, MINT, MALLORY, 0n));
check("TOKEN: a token account that is not the winner's is refused", r.ret === 306, String(r.ret));
r = tAward(tokenAcct(BTOK, "34".repeat(32), BOB, 0n));
check("TOKEN: nor one for a different coin", r.ret === 306, String(r.ret));

// ---- links ----
check("links: only links to where clips are posted are shown as links", safeLink(LINK_A) === LINK_A && !!safeLink(LINK_B) && !!safeLink("https://www.tiktok.com/@a/video/1") && safeLink("javascript:alert(1)") === null && safeLink("https://evil.example/x.com") === null && safeLink("http://x.com/a") === null && safeLink("not a link") === null && safeLink("https://notx.com/a") === null);
check("the upload's kind is fixed", KIND_POST === "phil-bounty/post" && [OP_ARM, OP_DRAW, OP_CLAIM, OP_REFUND].join() === "4,5,6,7");
console.log(fails ? `bounty: ${fails} FAILED` : "bounty: all passed");
process.exit(fails ? 1 : 0);
