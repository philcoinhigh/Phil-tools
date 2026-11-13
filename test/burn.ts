// The burn vault, run natively: Phil's emitted upload server + burn/runtime.c, with the harness
// standing in for Solana and for the token program's Burn.
import { execFileSync, execSync } from "child_process";
import * as fs from "fs";
import { hex, unhex, sha256, concat, utf8 } from "../site/src/draw";
import { openData, burnData, decodeVault, potOf, ruleRecord, offerRecord, VAULT_SIZE, OP_OPEN, OP_BURN } from "../site/src/burn";

let fails = 0;
const check = (name: string, ok: boolean, info = "") => { if (!ok) { fails++; console.log("FAIL", name, info); } else console.log("ok  ", name); };
const BIN = "out/phil-burn-native";
execSync(`giveaway/native/build.sh ${BIN} burn/runtime.c`, { stdio: "inherit" });

const PROGRAM = "11".repeat(32), VAULT = "22".repeat(32), MINT = "33".repeat(32), TOKENS = "44".repeat(32), SENDER = "55".repeat(32), OTHER = "66".repeat(32), SYSTEM = "00".repeat(32);
const TOKEN = "06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9", TOKEN_2022 = "06ddf6e1ee758fde18425dbce46ccddab61afc4d83b90d27febdf928d8a18bfc";
interface Acct { key: string; owner: string; flag: 0 | 1 | 2; data: Uint8Array; lamports: bigint }
function run(o: { slot?: number; accounts: Acct[]; ix: Uint8Array }) {
  const input = [`slot ${o.slot ?? 7000}`, "time 1763000000", `program ${PROGRAM}`,
    ...o.accounts.map((a) => `account ${a.key} ${a.owner} ${a.flag} ${a.data.length ? hex(a.data) : "-"} ${a.lamports}`), `ix ${hex(o.ix)}`, ""].join("\n");
  const out = execFileSync(BIN, { input }).toString().split("\n");
  return { logs: out.filter((l) => l.startsWith("LOG ")), ret: Number(/RET (\d+)/.exec(out.find((l) => l.startsWith("RET ")) ?? "")?.[1] ?? -1),
    data: out.filter((l) => l.startsWith("ACCOUNT ")).map((l) => unhex(l.split(" ")[2] ?? "")), lamports: out.filter((l) => l.startsWith("LAMPORTS ")).map((l) => BigInt(l.split(" ")[2])) };
}
const RENT = 2672640n, THRESHOLD = 1_000_000_000_000n;   // a million coins with six decimals
const u64 = (v: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); return b; };
const emptyVault = (lamports = RENT): Acct => ({ key: VAULT, owner: PROGRAM, flag: 1, data: new Uint8Array(VAULT_SIZE), lamports });
const mintAcct = (supply: bigint, owner = TOKEN): Acct => { const d = new Uint8Array(82); d.set(u64(supply), 36); d[44] = 6; d[45] = 1; return { key: MINT, owner, flag: 1, data: d, lamports: 1461600n }; };
const tokenAcct = (amount: bigint, o: { mint?: string; holder?: string; owner?: string } = {}): Acct => { const d = new Uint8Array(165); d.set(unhex(o.mint ?? MINT), 0); d.set(unhex(o.holder ?? SENDER), 32); d.set(u64(amount), 64); d[108] = 1; return { key: TOKENS, owner: o.owner ?? TOKEN, flag: 1, data: d, lamports: 2039280n }; };
const sender = (flag: 0 | 1 | 2 = 2): Acct => ({ key: SENDER, owner: SYSTEM, flag, data: new Uint8Array(0), lamports: 50_000_000n });
const tokenProgram = (key = TOKEN): Acct => ({ key, owner: "77".repeat(32), flag: 0, data: new Uint8Array(0), lamports: 1n });

// ---- OPEN ----
const opened = run({ accounts: [emptyVault()], ix: openData(unhex(MINT), THRESHOLD, "philcoin") });
const v0 = decodeVault(opened.data[0])!;
check("OPEN: Phil's server accepts the rule and the vault records it", opened.ret === 0 && /Phil: ACCEPTED/.test(opened.logs.join()) && v0.open && hex(v0.mint) === MINT && v0.threshold === THRESHOLD && v0.label === "philcoin" && v0.reserve === RENT && v0.burns === 0 && v0.openedSlot === 7000 && hex(v0.ruleDigest) === hex(sha256(ruleRecord(unhex(MINT), THRESHOLD, "philcoin"))));
const vault = (lamports: bigint, data = opened.data[0]): Acct => ({ key: VAULT, owner: PROGRAM, flag: 1, data, lamports });
const blank = (r: ReturnType<typeof run>) => hex(r.data[0]) === hex(new Uint8Array(VAULT_SIZE));
let r = run({ accounts: [vault(RENT)], ix: openData(unhex(OTHER), 1n, "swapped") });
check("OPEN: an open vault's rule cannot be replaced", r.ret === 1403 && hex(r.data[0]) === hex(opened.data[0]));
const rule = ruleRecord(unhex(MINT), THRESHOLD, "philcoin"); const bent = rule.slice(); bent[10] ^= 1;
r = run({ accounts: [emptyVault()], ix: concat(Uint8Array.of(OP_OPEN), openData(unhex(MINT), THRESHOLD, "philcoin").slice(1, -rule.length), bent) });
check("OPEN: a rule that does not match its declared digest is rejected by Phil", r.ret === 1201 && blank(r));
r = run({ accounts: [emptyVault()], ix: openData(unhex(MINT), THRESHOLD, "philcoin", { kind: "phil-burn/offer" }) });
check("OPEN: the wrong kind of upload is rejected by policy", r.ret === 1402 && blank(r));
r = run({ accounts: [{ ...emptyVault(), owner: OTHER }], ix: openData(unhex(MINT), THRESHOLD, "philcoin") });
check("OPEN: an account the program does not own is refused", r.ret === 1404);
const zero = ruleRecord(unhex(MINT), 5n, "x"); zero.set(u64(0n), 37);
r = run({ accounts: [emptyVault()], ix: concat(openData(unhex(MINT), 5n, "x").slice(0, 1), (() => { const w = openData(unhex(MINT), 5n, "x", { declaredDigest: sha256(zero) }); return concat(w.slice(1, -zero.length), zero); })()) });
check("OPEN: a threshold of zero is refused", r.ret === 1802 && blank(r), String(r.ret));

// ---- BURN ----
const FEES = 800_000_000n;   // 0.8 SOL of fees has arrived
const full = (o: { vaultLamports?: bigint; supply?: bigint; held?: bigint } = {}) => [vault(o.vaultLamports ?? RENT + FEES), mintAcct(o.supply ?? 1_000_000_000_000_000n), tokenAcct(o.held ?? 3n * THRESHOLD), sender(), tokenProgram()];
const b = run({ slot: 7100, accounts: full(), ix: burnData(700_000_000n) });
const v1 = decodeVault(b.data[0])!;
const supply = (d: Uint8Array) => new DataView(d.buffer).getBigUint64(36, true), held = (d: Uint8Array) => new DataView(d.buffer).getBigUint64(64, true);
check("BURN: Phil accepts the offer, the coins are burned, then the pot is paid", b.ret === 0 && b.logs.findIndex((l) => l.includes("token program burned")) < b.logs.findIndex((l) => l.includes("BURNED")) && /Phil: ACCEPTED/.test(b.logs.join()), b.logs.join(" | "));
check("BURN: supply and the sender's coins both fall by exactly the threshold", supply(b.data[1]) === 1_000_000_000_000_000n - THRESHOLD && held(b.data[2]) === 2n * THRESHOLD);
check("BURN: the sender receives the whole pot and the vault keeps only its reserve", b.lamports[3] === 50_000_000n + FEES && b.lamports[0] === RENT && b.lamports.reduce((a, x) => a + x, 0n) === full().reduce((a, x) => a + x.lamports, 0n));
check("BURN: the vault's running totals are updated", v1.burns === 1 && v1.totalBurned === THRESHOLD && v1.totalPaid === FEES && v1.lastPaid === FEES && v1.lastSlot === 7100 && potOf(b.lamports[0], v1) === 0n);
const same = (x: ReturnType<typeof run>, accounts: Acct[]) => x.data.every((d, i) => hex(d) === hex(accounts[i].data)) && x.lamports.every((l, i) => l === accounts[i].lamports);
r = run({ accounts: full({ vaultLamports: b.lamports[0] }).map((a, i) => (i === 0 ? vault(b.lamports[0], b.data[0]) : a)), ix: burnData(0n) });
check("BURN: an empty vault pays nothing and burns nothing", r.ret === 1806);
r = run({ accounts: full(), ix: burnData(900_000_000n) });
check("BURN: if the pot is less than the sender asked for, nothing happens", r.ret === 1807 && same(r, full()));
r = run({ accounts: full({ held: THRESHOLD - 1n }), ix: burnData(0n) });
check("BURN: without enough coins the token program refuses, and nothing is paid", r.ret === 1808 && r.lamports[3] === 50_000_000n && r.lamports[0] === RENT + FEES);
let a = full(); a[1] = { ...a[1], key: OTHER };
r = run({ accounts: a, ix: burnData(0n) });
check("BURN: a different coin cannot take the pot", r.ret === 1803 && r.lamports[0] === RENT + FEES);
a = full(); a[4] = tokenProgram(OTHER); a[1] = { ...a[1], owner: OTHER }; a[2] = { ...a[2], owner: OTHER };
r = run({ accounts: a, ix: burnData(0n) });
check("BURN: a stand-in for the token program is refused before it is called", r.ret === 1804 && r.lamports[0] === RENT + FEES);
a = full(); a[4] = tokenProgram(TOKEN_2022);
r = run({ accounts: a, ix: burnData(0n) });
check("BURN: the token program must be the one the coin belongs to", r.ret === 1804);
a = full(); a[1] = mintAcct(1_000_000_000_000_000n, TOKEN_2022); a[2] = tokenAcct(3n * THRESHOLD, { owner: TOKEN_2022 }); a[4] = tokenProgram(TOKEN_2022);
r = run({ accounts: a, ix: burnData(0n) });
check("BURN: coins of the newer token program work the same way", r.ret === 0 && r.lamports[3] === 50_000_000n + FEES);
a = full(); a[3] = sender(1);
r = run({ accounts: a, ix: burnData(0n) });
check("BURN: the sender must have signed", r.ret === 1805 && r.lamports[0] === RENT + FEES);
a = full(); a[2] = tokenAcct(3n * THRESHOLD, { holder: OTHER });
r = run({ accounts: a, ix: burnData(0n) });
check("BURN: someone else's coins cannot be burned", r.ret === 1808 && r.lamports[0] === RENT + FEES);
a = full(); a[2] = tokenAcct(3n * THRESHOLD, { mint: OTHER });
r = run({ accounts: a, ix: burnData(0n) });
check("BURN: a token account of another coin is refused by the token program", r.ret === 1808);
r = run({ accounts: full().slice(0, 4), ix: burnData(0n) });
check("BURN: missing accounts are refused", r.ret === 1809);
r = run({ accounts: [emptyVault(RENT + FEES), ...full().slice(1)], ix: burnData(0n) });
check("BURN: a vault that was never opened pays nothing", r.ret === 1405 && r.lamports[0] === RENT + FEES);
const offer = offerRecord(0n); const forged = offer.slice(); forged[5] = 1;
r = run({ accounts: full(), ix: (() => { const w = burnData(0n); return concat(w.slice(0, -offer.length), forged); })() });
check("BURN: an offer altered after its digest was declared is rejected by Phil", r.ret === 1201 && same(r, full()));
r = run({ accounts: full(), ix: openData(unhex(OTHER), 1n, "x") });
check("an OPEN sent to a vault that is already open changes nothing", r.ret === 1403 && same(r, full()));
r = run({ accounts: full(), ix: Uint8Array.of(9) });
check("there is no other instruction: nothing withdraws", r.ret === 103 && same(r, full()));
// Two burns in a row: the second gets only what arrived in between.
const second = run({ slot: 7200, accounts: [vault(b.lamports[0] + 5_000n, b.data[0]), { ...mintAcct(0n), data: b.data[1] }, { ...tokenAcct(0n), data: b.data[2] }, sender(), tokenProgram()], ix: burnData(1n) });
check("a later burn takes only the fees that arrived since", second.ret === 0 && second.lamports[3] === 50_000_000n + 5_000n && decodeVault(second.data[0])!.burns === 2 && decodeVault(second.data[0])!.totalBurned === 2n * THRESHOLD && decodeVault(second.data[0])!.totalPaid === FEES + 5_000n);

const checker = [process.env.PHIL_REPO, "../phil", "/home/claude/src/phil"].filter(Boolean).map((p) => `${p}/scripts/check_runtime_abi.py`).find((p) => fs.existsSync(p));
if (checker) {
  execSync("$(command -v clang-18 || command -v clang) --target=x86_64-unknown-linux-gnu -std=c17 -ffreestanding -fno-builtin -DPHIL_DRAW_C_STRUCT_RETURN -S -emit-llvm burn/runtime.c -o out/phil-burn-runtime.ll");
  const out = execSync(`python3 ${checker} giveaway/phil-llvm/phil-llvm-phase0-control-codec.ll out/phil-burn-runtime.ll`).toString();
  check("Phil's own checker accepts the vault's runtime against every signature Phil's LLVM declares", /PASS: runtime provider matches 46 Phil LLVM ABI signature/.test(out), out);
}
console.log(fails ? `\n${fails} FAILED` : "\nAll burn vault checks passed.");
process.exit(fails ? 1 : 0);
