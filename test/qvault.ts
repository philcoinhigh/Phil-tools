// The quantum-safe vault, run natively: Phil's emitted upload server + qvault/runtime.c, with the
// harness standing in for Solana. Also checks the signature library against itself and the program.
import { execFileSync, execSync } from "child_process";
import { hex, unhex, sha256, concat } from "../site/src/draw";
import { N, CHAINS, SIG_BYTES, QVAULT_SIZE, KIND_OPEN, keyRoot, sign, rootFromSignature, positions, work, spendDigest, bestSalt, makeSpend, openData, spendData, decodeQVault, step, NO_NEXT_KEY } from "../site/src/wots";

let fails = 0;
const check = (name: string, ok: boolean, info = "") => { if (!ok) { fails++; console.log("FAIL", name, info); } else console.log("ok  ", name); };
const BIN = "out/phil-qvault-native";
execSync(`giveaway/native/build.sh ${BIN} qvault/runtime.c`, { stdio: "inherit" });

const PROGRAM = "11".repeat(32), VAULT = "22".repeat(32), ALICE = "aa".repeat(32), MALLORY = "ee".repeat(32), SYSTEM = "00".repeat(32);
interface Acct { key: string; owner: string; flag: 0 | 1 | 2; data: Uint8Array; lamports: bigint }
function run(accounts: Acct[], ix: Uint8Array) {
  const input = ["slot 7000", "time 1763000000", `program ${PROGRAM}`, ...accounts.map((a) => `account ${a.key} ${a.owner} ${a.flag} ${a.data.length ? hex(a.data) : "-"} ${a.lamports}`), `ix ${hex(ix)}`, ""].join("\n");
  const out = execFileSync(BIN, { input }).toString().split("\n");
  return { logs: out.filter((l) => l.startsWith("LOG ")).join("\n"), ret: Number(/RET (\d+)/.exec(out.find((l) => l.startsWith("RET ")) ?? "")?.[1] ?? -1),
    data: unhex((out.find((l) => l.startsWith("ACCOUNT 0 ")) ?? "").split(" ")[2] ?? ""), lamports: out.filter((l) => l.startsWith("LAMPORTS ")).map((l) => BigInt(l.split(" ")[2])) };
}
const RENT = 2_004_480n, SOL = 1_000_000_000n;
const vaultAcct = (data: Uint8Array, lamports: bigint, o: Partial<Acct> = {}): Acct => ({ key: VAULT, owner: PROGRAM, flag: 1, data, lamports, ...o });
const wallet = (key: string, lamports = 0n, flag: 0 | 1 = 1): Acct => ({ key, owner: SYSTEM, flag, data: new Uint8Array(0), lamports });
const seed = sha256(new TextEncoder().encode("a test seed, never used for anything real")), V = unhex(VAULT), A = unhex(ALICE), M = unhex(MALLORY);
const same = (r: { data: Uint8Array; lamports: bigint[] }, before: Uint8Array, lamports: bigint) => hex(r.data) === hex(before) && r.lamports[0] === lamports;

// ---- the signature itself ----
const root0 = keyRoot(seed, 0n), root1 = keyRoot(seed, 1n);
{
  const digest = sha256(new TextEncoder().encode("a message")).slice(0, N), sig = sign(seed, 0n, digest);
  check("signature: 26 chain values of 24 bytes, and it leads back to the key's fingerprint", sig.length === SIG_BYTES && SIG_BYTES === 624 && CHAINS === 26 && hex(rootFromSignature(sig, digest)) === hex(root0));
  const other = sha256(new TextEncoder().encode("another message")).slice(0, N);
  check("signature: it does not fit any other message", hex(rootFromSignature(sig, other)) !== hex(root0));
  check("signature: a different key's fingerprint is different, and each key comes from the seed alone", hex(root1) !== hex(root0) && hex(keyRoot(seed, 0n)) === hex(root0));
  const bent = sig.slice(); bent[100] ^= 1;
  check("signature: one flipped bit breaks it", hex(rootFromSignature(bent, digest)) !== hex(root0));
  // Hashing forward is the only thing a forger can do with a signature. It moves a chain to a higher position, and
  // the checksum chains would then have to move to a lower one, which needs a hash run backwards.
  const p = positions(digest), up = digest.slice(); const i = p.findIndex((c) => c < 255); up[i] = p[i] + 1;
  const forged = sig.slice(); forged.set(step(i, p[i], sig.slice(i * N, (i + 1) * N)), i * N);
  check("signature: advancing a chain to forge a nearby message is caught by the checksum", hex(rootFromSignature(forged, up)) !== hex(root0) && positions(up).slice(N).join() !== p.slice(N).join());
  check("signature: the verifier's work is what the positions say, and a chosen salt lowers it", work(digest) === p.reduce((s, c) => s + 255 - c, 0) && (() => {
    const base = { vault: V, recipient: A, amount: 5n, nextRoot: root1, counter: 0n }; return work(spendDigest({ ...base, salt: bestSalt(base, 400) })) < work(spendDigest({ ...base, salt: 0n })) + 1; })());
  // THE ONE RULE. Every extra signature from one key hands a forger each chain at the lowest position signed so far.
  const signed = [1n, 2n, 3n, 4n].map((n) => { const d = spendDigest({ vault: V, recipient: A, amount: n, nextRoot: root1, counter: 0n, salt: n }); return { d, p: positions(d), s: sign(seed, 0n, d) }; });
  const lowest = (k: number) => Array.from({ length: CHAINS }, (_, c) => Math.min(...signed.slice(0, k).map((x) => x.p[c])));
  const exposed = (k: number) => lowest(k).reduce((t, c) => t + (255 - c), 0);
  check("the one rule: each further signature from the same key exposes more of every chain", exposed(2) > exposed(1) && exposed(3) >= exposed(2) && exposed(4) >= exposed(3), [1, 2, 3, 4].map(exposed).join(" < "));
  const low = lowest(4);
  let forgedDigest: Uint8Array | null = null, tries = 0n;
  for (; tries < 400000n && !forgedDigest; tries++) {
    const d = spendDigest({ vault: V, recipient: M, amount: 999n, nextRoot: NO_NEXT_KEY, counter: 0n, salt: tries });
    if (positions(d).every((c, k) => c >= low[k])) forgedDigest = d;
  }
  // With no secret at all: start each chain from whichever signature stood lowest, and hash forward.
  const forgery = forgedDigest && concat(...positions(forgedDigest).map((c, k) => { const from = signed.find((x) => x.p[k] === low[k])!; let x = from.s.slice(k * N, (k + 1) * N); for (let j = low[k]; j < c; j++) x = step(k, j, x); return x; }));
  check("the one rule: from four signatures, a forger signs a payment to themselves without knowing any secret", !!forgery && hex(rootFromSignature(forgery, forgedDigest!)) === hex(root0), `no forgery in ${tries} tries`);
  console.log(`     the forgery took ${tries} tries at a salt`);
}

// ---- OPEN ----
const empty = new Uint8Array(QVAULT_SIZE);
const opened = run([vaultAcct(empty, RENT)], openData(root0));
let v = decodeQVault(opened.data)!;
check("OPEN: Phil's server accepts, and the vault holds the first key's fingerprint and nothing else about it", opened.ret === 0 && /Phil: ACCEPTED/.test(opened.logs) && v.state === "open" && hex(v.root) === hex(root0) && v.counter === 0n && v.reserve === RENT && !hex(opened.data).includes(hex(seed)), String(opened.ret));
let r = run([vaultAcct(opened.data, RENT)], openData(root1));
check("OPEN: an open vault's key cannot be replaced by opening it again", r.ret === 1404 && same(r, opened.data, RENT), String(r.ret));
r = run([vaultAcct(empty, RENT)], openData(new Uint8Array(32)));
check("OPEN: a vault with no key is refused", r.ret === 1802, String(r.ret));
r = run([vaultAcct(empty, RENT, { owner: MALLORY })], openData(root0));
check("OPEN: an account the program does not own is refused", r.ret === 1403, String(r.ret));
{ const good = openData(root0), bent = good.slice(); bent[bent.length - 1] ^= 1;
  r = run([vaultAcct(empty, RENT)], bent);
  check("OPEN: bytes that do not match their declared digest are rejected by Phil", r.ret === 1201 && /do not match the declared digest/.test(r.logs), String(r.ret)); }

// ---- SPEND ----
const funded = RENT + 3n * SOL;
const first = makeSpend(seed, V, A, SOL, 0n);
const spendIx = (s: ReturnType<typeof makeSpend>) => spendData(s.spend.amount, s.spend.salt, s.spend.nextRoot, s.signature);
const paid = run([vaultAcct(opened.data, funded), wallet(ALICE)], spendIx(first));
v = decodeQVault(paid.data)!;
check("SPEND: a one-time signature moves the money, with no wallet signing at all", paid.ret === 0 && /Phil: ACCEPTED/.test(paid.logs) && paid.lamports[0] === funded - SOL && paid.lamports[1] === SOL, `${paid.ret} ${paid.lamports.join(",")}`);
check("SPEND: the vault moved to the next key in the same step", v.counter === 1n && hex(v.root) === hex(root1) && v.totalSpent === SOL && hex(v.lastRecipient) === ALICE && v.state === "open");
r = run([vaultAcct(paid.data, funded - SOL), wallet(ALICE)], spendIx(first));
check("SPEND: the same signature can never be used again", r.ret === 1806 && same(r, paid.data, funded - SOL), String(r.ret));
r = run([vaultAcct(opened.data, funded), wallet(MALLORY)], spendIx(first));
check("SPEND: a signature seen in the open cannot be redirected to another recipient", r.ret === 1806 && same(r, opened.data, funded), String(r.ret));
r = run([vaultAcct(opened.data, funded), wallet(ALICE)], spendData(2n * SOL, first.spend.salt, first.spend.nextRoot, first.signature));
check("SPEND: nor to a larger amount", r.ret === 1806 && same(r, opened.data, funded), String(r.ret));
r = run([vaultAcct(opened.data, funded), wallet(ALICE)], spendData(SOL, first.spend.salt, keyRoot(sha256(M), 1n), first.signature));
check("SPEND: nor can the next key be swapped for the attacker's", r.ret === 1806 && same(r, opened.data, funded), String(r.ret));
r = run([vaultAcct(opened.data, funded, { key: "23".repeat(32) }), wallet(ALICE)], spendIx(first));
check("SPEND: a signature for one vault does not open another with the same key", r.ret === 1806, String(r.ret));
{ const bent = first.signature.slice(); bent[7] ^= 1;
  r = run([vaultAcct(opened.data, funded), wallet(ALICE)], spendData(SOL, first.spend.salt, first.spend.nextRoot, bent));
  check("SPEND: a signature with one bit changed is refused", r.ret === 1806 && same(r, opened.data, funded), String(r.ret));
  const ix = spendIx(first), swapped = ix.slice(); swapped[swapped.length - 3] ^= 1;
  r = run([vaultAcct(opened.data, funded), wallet(ALICE)], swapped);
  check("SPEND: bytes changed after their digest was declared are rejected by Phil before the signature is looked at", r.ret === 1201 && /Phil: REJECTED/.test(r.logs) && same(r, opened.data, funded), String(r.ret)); }
r = run([vaultAcct(opened.data, funded), wallet(ALICE)], spendIx(makeSpend(sha256(M), V, A, SOL, 0n)));
check("SPEND: a signature from any other seed is refused", r.ret === 1806, String(r.ret));
r = run([vaultAcct(opened.data, funded), wallet(ALICE)], spendIx(makeSpend(seed, V, A, 4n * SOL, 0n)));
check("SPEND: more than the vault holds is refused, and its rent is not part of the balance", r.ret === 1804 && same(r, opened.data, funded), String(r.ret));
r = run([vaultAcct(opened.data, funded), wallet(ALICE)], spendIx(makeSpend(seed, V, A, SOL, 0n, true)));
check("SPEND: a vault with money left in it cannot be left without a next key", r.ret === 1805 && same(r, opened.data, funded), String(r.ret));
r = run([vaultAcct(opened.data, funded), wallet(ALICE, 0n, 0)], spendIx(first));
check("SPEND: the recipient must be able to receive", r.ret === 1405, String(r.ret));
r = run([vaultAcct(opened.data, funded), vaultAcct(opened.data, funded)], spendIx(makeSpend(seed, V, V, SOL, 0n)));
check("SPEND: the vault cannot pay itself", r.ret === 1405, String(r.ret));
r = run([vaultAcct(empty, funded), wallet(ALICE)], spendIx(first));
check("SPEND: a vault that was never opened pays nothing", r.ret === 1404, String(r.ret));
r = run([vaultAcct(opened.data, funded), wallet(ALICE)], openData(root0, { kind: KIND_OPEN }).map((b, i) => (i === 0 ? 2 : b)));
check("SPEND: an upload of the wrong kind is refused by policy", r.ret === 1402, String(r.ret));

// ---- a vault's whole life: several keys, then closed ----
{
  let data = paid.data, lamports = funded - SOL, counter = 1n, ok = true, units = 0;
  for (const amount of [SOL / 2n, SOL / 4n]) {
    const s = makeSpend(seed, V, A, amount, counter); units += s.work;
    const x = run([vaultAcct(data, lamports), wallet(ALICE)], spendIx(s));
    ok = ok && x.ret === 0 && x.lamports[0] === lamports - amount && decodeQVault(x.data)!.counter === counter + 1n && hex(decodeQVault(x.data)!.root) === hex(keyRoot(seed, counter + 1n));
    data = x.data; lamports -= amount; counter++;
  }
  check("three spends, three keys: each key signs once and the vault moves on", ok && counter === 3n);
  const rest = lamports - RENT, last = makeSpend(seed, V, A, rest, counter, true);
  const x = run([vaultAcct(data, lamports), wallet(ALICE)], spendIx(last));
  v = decodeQVault(x.data)!;
  check("the last spend empties the vault and ends it", x.ret === 0 && x.lamports[0] === RENT && v.state === "closed" && v.counter === 4n && v.totalSpent === 3n * SOL && /CLOSED/.test(x.logs), `${x.ret} ${x.lamports[0]}`);
  r = run([vaultAcct(x.data, RENT + SOL), wallet(ALICE)], spendIx(makeSpend(seed, V, A, SOL, 4n)));
  check("a closed vault never pays again, whatever is sent to it", r.ret === 1404, String(r.ret));
  console.log(`     hash steps to verify, with a chosen salt: about ${Math.round(units / 2)} a spend (${first.work} for the first)`);
}
r = run([vaultAcct(opened.data, funded), wallet(ALICE)], concat(spendIx(first), Uint8Array.of(0)));
check("bytes left over after the upload fail the transaction", r.ret === 120, String(r.ret));
r = run([vaultAcct(opened.data, funded)], Uint8Array.of(9));
check("an unknown instruction is refused", r.ret === 103, String(r.ret));

console.log(fails ? `qvault: ${fails} FAILED` : "qvault: all passed");
process.exit(fails ? 1 : 0);
