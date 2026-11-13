// The giveaway program, run natively: Phil's emitted upload server + our Solana runtime, with
// giveaway/native/harness.c standing in for Solana. Also checks the byte formats.
import { execFileSync, execSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import { buildRecord, cleanEntries, decodeDraw, hex, unhex, sha256, uploadData, helloFrame, beginFrame, pickWinners, randomnessOf, readVerdict, concat, utf8, OP_LOCK, OP_DRAW, OP_CHECK, MAX_PAYLOAD, DRAW_SIZE, Giveaway } from "../site/src/draw";

let fails = 0;
const check = (name: string, ok: boolean, info = "") => { if (!ok) { fails++; console.log("FAIL", name, info); } else console.log("ok  ", name); };

const BIN = "out/phil-draw-native";
execSync(`giveaway/native/build.sh ${BIN}`, { stdio: "inherit" });

const PROGRAM = "11".repeat(32), DRAWKEY = "22".repeat(32), OTHER = "33".repeat(32);
const SLOT_HASHES = hex(Uint8Array.from([0x06,0xa7,0xd5,0x17,0x19,0x2f,0x0a,0xaf,0xc6,0xf2,0x65,0xe3,0xfb,0x77,0xcc,0x7a,0xda,0x82,0xc5,0x29,0xd0,0xbe,0x3b,0x13,0x6e,0x2d,0x00,0x55,0x20,0x00,0x00,0x00]));
interface Acct { key: string; owner: string; writable: boolean; data: Uint8Array }
function run(o: { slot: number; accounts: Acct[]; ix: Uint8Array; time?: number }) {
  const input = [`slot ${o.slot}`, `time ${o.time ?? 1763000000}`, `program ${PROGRAM}`,
    ...o.accounts.map((a) => `account ${a.key} ${a.owner} ${a.writable ? 1 : 0} ${a.data.length ? hex(a.data) : "-"}`), `ix ${hex(o.ix)}`, ""].join("\n");
  const out = execFileSync(BIN, { input }).toString().split("\n");
  return { logs: out.filter((l) => l.startsWith("LOG ")), ret: Number(/RET (\d+)/.exec(out.find((l) => l.startsWith("RET ")) ?? "")?.[1] ?? -1),
    accounts: out.filter((l) => l.startsWith("ACCOUNT ")).map((l) => unhex(l.split(" ")[2] ?? "")) };
}
const emptyDraw = (): Acct => ({ key: DRAWKEY, owner: PROGRAM, writable: true, data: new Uint8Array(DRAW_SIZE) });
function slotHashes(entries: [number, Uint8Array][], pad = 0): Acct {
  const all = [...entries];
  const data = new Uint8Array(8 + 40 * (all.length + pad));
  const v = new DataView(data.buffer);
  v.setBigUint64(0, BigInt(all.length + pad), true);
  all.forEach(([slot, h], i) => { v.setBigUint64(8 + 40 * i, BigInt(slot), true); data.set(h, 16 + 40 * i); });
  return { key: SLOT_HASHES, owner: OTHER, writable: false, data };
}

// ---- formats ----
check("sha256 agrees with Node's", [0, 1, 55, 56, 63, 64, 65, 1000].every((n) => { const m = crypto.randomBytes(n); return hex(sha256(m)) === crypto.createHash("sha256").update(m).digest("hex"); }));
check("Hello frame is Phil's codec v1: PHIL, version 1, tag 1, big-endian", hex(helloFrame([1, 2])) === "5048494c01010006" + "0002" + "0001" + "0002");
check("Begin frame is Phil's codec v1: length, kind, SHA-256 tag, digest", hex(beginFrame(3, "ab", new Uint8Array(32).fill(7))) === "5048494c0102002c" + "0000000000000003" + "02" + "6162" + "01" + "07".repeat(32));
const c = cleanEntries("  @alice \nbob\n\nALICE\n@Bob , carol\r\ndave  smith\n");
check("entries are trimmed; blanks and repeats (any case, with or without @) are dropped", c.entries.join("|") === "@alice|bob|carol|dave smith" && c.repeats === 2);

const g: Giveaway = { title: "Launch week giveaway", winners: 2, delay: 150, entries: ["@alice", "@bob", "@carol", "@dave", "@erin", "@frank", "@grace"] };
const rec = buildRecord(g);
check("a short list is uploaded whole", rec.kind === 1 && new TextDecoder().decode(rec.payload).endsWith("@alice\n@bob\n@carol\n@dave\n@erin\n@frank\n@grace"));
const big: Giveaway = { ...g, entries: Array.from({ length: 400 }, (_, i) => `@entrant_number_${i}`) };
const bigRec = buildRecord(big);
check("a long list is uploaded as its SHA-256", bigRec.kind === 2 && bigRec.payload.length < 120 && hex(bigRec.payload.slice(-32)) === hex(sha256(utf8(big.entries.join("\n")))));
check("the largest inline record still fits one transaction", buildRecord({ ...g, entries: Array.from({ length: 60 }, (_, i) => `@handle_${String(i).padStart(4, "0")}`) }).payload.length <= MAX_PAYLOAD);

// ---- LOCK through Phil's upload server ----
const lock = run({ slot: 5000, accounts: [emptyDraw()], ix: uploadData(OP_LOCK, rec.payload) });
const locked = decodeDraw(lock.accounts[0])!;
check("LOCK: Phil's server walks the whole protocol and accepts", lock.ret === 0 && readVerdict(lock.logs).accepted &&
  ["UploadServer started", "Hello recognized", "version agreed", "Begin recognized", "policy passed", "payload received", "SHA-256 matches", "giveaway locked", "ACCEPTED"].every((s, i, a) => { const at = lock.logs.findIndex((l) => l.includes(s)); return at >= 0 && (i === 0 || at > lock.logs.findIndex((l) => l.includes(a[i - 1]))); }), lock.logs.join(" | "));
check("LOCK: the account records the giveaway and the target slot", locked.state === "locked" && locked.title === g.title && locked.count === 7 && locked.winners === 2 && locked.lockSlot === 5000 && locked.targetSlot === 5150 && locked.kind === 1 &&
  hex(locked.payloadDigest) === hex(sha256(rec.payload)) && hex(locked.listDigest) === hex(rec.listDigest) && locked.payloadLength === rec.payload.length && locked.lockTime === 1763000000);
const lockedAcct = (): Acct => ({ key: DRAWKEY, owner: PROGRAM, writable: true, data: lock.accounts[0] });

const untouched = (r: ReturnType<typeof run>) => hex(r.accounts[0]) === hex(new Uint8Array(DRAW_SIZE));
const tampered = rec.payload.slice(); tampered[tampered.length - 1] ^= 1;
let r = run({ slot: 5000, accounts: [emptyDraw()], ix: uploadData(OP_LOCK, tampered, { declaredDigest: sha256(rec.payload) }) });
check("LOCK: one changed byte is rejected by Phil's digest check, and nothing is written", r.ret === 1201 && /do not match the declared digest/.test(r.logs.join()) && untouched(r) && !readVerdict(r.logs).accepted);
r = run({ slot: 5000, accounts: [emptyDraw()], ix: uploadData(OP_LOCK, rec.payload.slice(0, -3), { declaredLength: rec.payload.length, declaredDigest: sha256(rec.payload) }) });
check("LOCK: fewer bytes than declared stops at early end of input", r.ret === 1900 && /fewer bytes arrived/.test(r.logs.join()) && untouched(r));
r = run({ slot: 5000, accounts: [emptyDraw()], ix: concat(uploadData(OP_LOCK, rec.payload), Uint8Array.of(9)) });
check("LOCK: bytes left over after the upload fail the transaction", r.ret === 120);
r = run({ slot: 5000, accounts: [emptyDraw()], ix: uploadData(OP_LOCK, rec.payload, { versions: [2, 7] }) });
check("LOCK: a client that only speaks other versions is told unsupported", r.ret === 1300 && /no protocol version in common/.test(r.logs.join()) && untouched(r));
r = run({ slot: 5000, accounts: [emptyDraw()], ix: uploadData(OP_LOCK, rec.payload, { versions: [1, 2, 7] }) });
check("LOCK: a client offering several versions gets the common one", r.ret === 0);
r = run({ slot: 5000, accounts: [emptyDraw()], ix: uploadData(OP_LOCK, rec.payload, { versions: [2, 1] }) });
check("LOCK: versions out of order are not a recognizable Hello", r.ret === 1603 && /Hello frame was not recognized/.test(r.logs.join()));
r = run({ slot: 5000, accounts: [emptyDraw()], ix: uploadData(OP_LOCK, rec.payload, { kind: "something/else" }) });
check("LOCK: the wrong kind of upload is rejected by policy before the payload is read", r.ret === 1402 && !/payload received/.test(r.logs.join()));
r = run({ slot: 5000, accounts: [emptyDraw()], ix: uploadData(OP_LOCK, new Uint8Array(MAX_PAYLOAD + 1)) });
check("LOCK: an oversized upload is rejected by policy", r.ret === 1401);
r = run({ slot: 6000, accounts: [lockedAcct()], ix: uploadData(OP_LOCK, buildRecord({ ...g, title: "Swapped" }).payload) });
check("LOCK: a locked giveaway cannot be locked again", r.ret === 1403 && hex(r.accounts[0]) === hex(lock.accounts[0]));
r = run({ slot: 5000, accounts: [{ ...emptyDraw(), owner: OTHER }], ix: uploadData(OP_LOCK, rec.payload) });
check("LOCK: an account the program does not own is refused", r.ret === 1404);
r = run({ slot: 5000, accounts: [emptyDraw()], ix: uploadData(OP_LOCK, rec.payload, { cancel: true }) });
check("LOCK: a client may cancel after the policy answer; nothing is written", r.ret === 1500 && untouched(r));
const wrongCount = buildRecord(g).payload.slice(); wrongCount[6] = 9;
r = run({ slot: 5000, accounts: [emptyDraw()], ix: uploadData(OP_LOCK, wrongCount) });
check("LOCK: a record whose count is not the number of lines is valid to Phil but not stored", r.ret === 1802 && /SHA-256 matches/.test(r.logs.join()) && untouched(r));
const bad = (mutate: (p: Uint8Array) => void) => { const p = buildRecord(g).payload.slice(); mutate(p); return run({ slot: 5000, accounts: [emptyDraw()], ix: uploadData(OP_LOCK, p) }).ret; };
check("LOCK: zero winners, more winners than entries, and a too-short delay are refused", bad((p) => { p[10] = 0; }) === 1802 && bad((p) => { p[10] = 8; }) === 1802 && bad((p) => { p[11] = 5; }) === 1802);
r = run({ slot: 5000, accounts: [emptyDraw()], ix: Uint8Array.of(OP_LOCK, 1, 2, 3) });
check("LOCK: garbage is not a recognizable Hello", r.ret === 1602 + 100 && untouched(r), String(r.ret));
r = run({ slot: 5000, accounts: [emptyDraw()], ix: uploadData(OP_LOCK, bigRec.payload) });
check("LOCK: a fingerprint-only giveaway locks too", r.ret === 0 && decodeDraw(r.accounts[0])!.kind === 2 && hex(decodeDraw(r.accounts[0])!.listDigest) === hex(bigRec.listDigest) && decodeDraw(r.accounts[0])!.count === 400);

// ---- CHECK: the wallet-free question "is this the locked giveaway?" ----
r = run({ slot: 5100, accounts: [{ ...lockedAcct(), writable: false }], ix: uploadData(OP_CHECK, rec.payload) });
check("CHECK: the real list is accepted and matches the lock", r.ret === 0 && /byte for byte the giveaway that is locked/.test(r.logs.join()) && hex(r.accounts[0]) === hex(lock.accounts[0]));
const edited = buildRecord({ ...g, entries: [...g.entries.slice(0, 6), "@mallory"] }, 1);
r = run({ slot: 5100, accounts: [{ ...lockedAcct(), writable: false }], ix: uploadData(OP_CHECK, edited.payload, { declaredDigest: locked.payloadDigest, declaredLength: locked.payloadLength }) });
check("CHECK: an edited list under the locked digest is rejected by Phil", r.ret === 1201 || r.ret === 1900, String(r.ret));
r = run({ slot: 5100, accounts: [{ ...lockedAcct(), writable: false }], ix: uploadData(OP_CHECK, edited.payload) });
check("CHECK: an edited list with its own honest digest is a valid upload but not the locked one", r.ret === 1803 && readVerdict(r.logs).why.includes("not the giveaway that is locked"));

// ---- DRAW ----
const h = (n: number) => new Uint8Array(32).fill(n);
r = run({ slot: 5150, accounts: [lockedAcct(), slotHashes([[5149, h(1)]])], ix: Uint8Array.of(OP_DRAW) });
check("DRAW: refused until the target slot has passed", r.ret === 204 && hex(r.accounts[0]) === hex(lock.accounts[0]));
r = run({ slot: 5151, accounts: [lockedAcct(), slotHashes([[5149, h(1)], [5148, h(2)]])], ix: Uint8Array.of(OP_DRAW) });
check("DRAW: refused while there is no block at or after the target", r.ret === 204);
const hashes = slotHashes([[5153, h(9)], [5152, h(8)], [5149, h(1)], [5148, h(2)]]);   // 5150 and 5151 were skipped
const drawn = run({ slot: 5154, accounts: [lockedAcct(), hashes], ix: Uint8Array.of(OP_DRAW) });
const d = decodeDraw(drawn.accounts[0])!;
const R = randomnessOf(locked.payloadDigest, h(8), unhex(DRAWKEY));
check("DRAW: uses the first block at or after the target slot", drawn.ret === 0 && d.state === "drawn" && d.hashSlot === 5152 && hex(d.slotHash) === hex(h(8)));
check("DRAW: the randomness and the winner are the ones anyone can recompute", hex(d.randomness) === hex(R) && d.winner === pickWinners(R, 7, 2)[0] && pickWinners(R, 7, 2).length === 2 && new Set(pickWinners(R, 7, 7)).size === 7);
check("DRAW: a later caller with more history gets the same answer", hex(run({ slot: 5300, accounts: [lockedAcct(), slotHashes([[5299, h(5)], [5153, h(9)], [5152, h(8)], [5149, h(1)]])], ix: Uint8Array.of(OP_DRAW) }).accounts[0]) === hex(drawn.accounts[0]));
r = run({ slot: 5400, accounts: [{ key: DRAWKEY, owner: PROGRAM, writable: true, data: drawn.accounts[0] }, hashes], ix: Uint8Array.of(OP_DRAW) });
check("DRAW: cannot be drawn twice", r.ret === 203 && hex(r.accounts[0]) === hex(drawn.accounts[0]));
r = run({ slot: 5154, accounts: [lockedAcct(), { ...hashes, key: OTHER }], ix: Uint8Array.of(OP_DRAW) });
check("DRAW: a stand-in for Solana's block hashes is refused", r.ret === 202);
r = run({ slot: 9000, accounts: [lockedAcct(), slotHashes(Array.from({ length: 512 }, (_, i) => [8999 - i, h(3)] as [number, Uint8Array]))], ix: Uint8Array.of(OP_DRAW) });
check("DRAW: once Solana no longer keeps the target block, the giveaway is marked expired", r.ret === 0 && decodeDraw(r.accounts[0])!.state === "expired");
const spread = new Array(7).fill(0);
for (let i = 0; i < 700; i++) spread[pickWinners(sha256(utf8("seed" + i)), 7, 1)[0]]++;
check("the pick is spread evenly over the entries", spread.every((n) => n > 60 && n < 140), spread.join(","));

// ---- Phil's own interface check, when Phil's repository is at hand ----
const checker = [process.env.PHIL_REPO, "../phil", "/home/claude/src/phil"].filter(Boolean).map((p) => `${p}/scripts/check_runtime_abi.py`).find((p) => fs.existsSync(p));
if (checker) {
  execSync("$(command -v clang-18 || command -v clang) --target=x86_64-unknown-linux-gnu -std=c17 -ffreestanding -fno-builtin -DPHIL_DRAW_C_STRUCT_RETURN -S -emit-llvm giveaway/runtime.c -o out/phil-draw-runtime.ll");
  const out = execSync(`python3 ${checker} giveaway/phil-llvm/phil-llvm-phase0-control-codec.ll out/phil-draw-runtime.ll`).toString();
  check("Phil's own checker accepts our runtime against every signature Phil's LLVM declares", /PASS: runtime provider matches 46 Phil LLVM ABI signature/.test(out), out);
} else console.log("skip Phil's ABI checker (no Phil checkout here)");

console.log(fails ? `\n${fails} FAILED` : "\nAll giveaway checks passed.");
process.exit(fails ? 1 : 0);
