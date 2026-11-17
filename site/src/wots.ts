// A hash-based one-time signature (Winternitz, one byte per chain) and the quantum-safe vault's
// byte formats. Nothing here depends on elliptic curves: the only assumption is that SHA-256 is
// hard to run backwards, which is believed to hold against quantum computers at reduced strength.
// The construction is the well-known one, as in Dean Little's Solana Winternitz Vault. The program
// in qvault/runtime.c verifies exactly what this signs; test/qvault.ts checks them against each other.
//
// THE ONE RULE: a key may sign exactly one message. Two different signatures from one key let
// anyone forge more. So a key is used once, and each spend moves the vault to the next key.
import { concat, sha256, utf8, uploadData, Upload } from "./draw";

/** Bytes kept of each hash in a chain: 192 bits. A quantum search for a preimage costs about 2^96 hash steps. */
export const N = 24;
/** 24 chains carry the message, 2 carry its checksum. */
export const CHAINS = 26;
export const SIG_BYTES = CHAINS * N;
export const OP_OPEN = 1, OP_SPEND = 2, OP_FINISH = 3, OP_CANCEL = 4;
export const KIND_OPEN = "phil-qvault/open", KIND_SPEND = "phil-qvault/spend", KIND_FINISH = "phil-qvault/finish", KIND_CANCEL = "phil-qvault/cancel";
export const QVAULT_SIZE = 320;
/** The longest waiting time a vault may set: 30 days. */
export const MAX_DELAY = 30 * 86400;

const u64 = (v: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); return b; };
const TAG_F = utf8("QF1"), TAG_K = utf8("QK1"), TAG_M = utf8("QM2"), TAG_S = utf8("QS1"), TAG_C = utf8("QC1");
/** One step along chain `i`, from position `j` to `j + 1`. */
export const step = (i: number, j: number, x: Uint8Array) => sha256(concat(TAG_F, Uint8Array.of(i, j), x)).slice(0, N);
function walk(i: number, from: number, to: number, x: Uint8Array): Uint8Array { for (let j = from; j < to; j++) x = step(i, j, x); return x; }
/** The 26 chain positions for a 24-byte digest: its bytes, then the checksum that stops a forger moving any chain forward. */
export function positions(digest: Uint8Array): number[] {
  const p = Array.from(digest.slice(0, N));
  const check = p.reduce((s, b) => s + (255 - b), 0);
  return [...p, check >> 8, check & 255];
}
/** How many hash steps a verifier takes for this digest. The signer picks a salt that keeps it low. */
export const work = (digest: Uint8Array) => positions(digest).reduce((s, c) => s + (255 - c), 0);

/** The secret start of chain `i` for one-time key number `index`. Every key of a vault comes from one 32-byte seed. */
export const secretStart = (seed: Uint8Array, index: bigint, i: number) => sha256(concat(TAG_S, seed, u64(index), Uint8Array.of(i))).slice(0, N);
/** The public fingerprint of one-time key number `index`: the hash of all 26 chain ends. This is what the vault stores. */
export function keyRoot(seed: Uint8Array, index: bigint): Uint8Array {
  const ends: Uint8Array[] = [];
  for (let i = 0; i < CHAINS; i++) ends.push(walk(i, 0, 255, secretStart(seed, index, i)));
  return sha256(concat(TAG_K, ...ends));
}
export function sign(seed: Uint8Array, index: bigint, digest: Uint8Array): Uint8Array {
  return concat(...positions(digest).map((c, i) => walk(i, 0, c, secretStart(seed, index, i))));
}
/** The key fingerprint a signature implies for a digest. It is valid if this equals the vault's stored one. */
export function rootFromSignature(signature: Uint8Array, digest: Uint8Array): Uint8Array {
  if (signature.length !== SIG_BYTES) throw new Error("A signature is 624 bytes.");
  return sha256(concat(TAG_K, ...positions(digest).map((c, i) => walk(i, c, 255, signature.slice(i * N, (i + 1) * N)))));
}

// ---- the vault ----
/** The "coin" of a spend that pays SOL. */
export const SOL = new Uint8Array(32);
export interface Spend { vault: Uint8Array; recipient: Uint8Array; mint?: Uint8Array; amount: bigint; nextRoot: Uint8Array; counter: bigint; salt: bigint }
/** What a spend's signature covers: this vault, this recipient, this coin, this amount, the next key, and which spend it is. */
export const spendDigest = (s: Spend) => sha256(concat(TAG_M, s.vault, s.recipient, s.mint ?? SOL, u64(s.amount), s.nextRoot, u64(s.counter), u64(s.salt))).slice(0, N);
/** Tries salts and keeps the one whose signature is cheapest to verify on chain. */
function cheapest(digestOf: (salt: bigint) => Uint8Array, tries: number): bigint {
  let best = 0n, least = Infinity;
  for (let t = 0n; t < BigInt(tries); t++) { const w = work(digestOf(t)); if (w < least) { least = w; best = t; } }
  return best;
}
export const bestSalt = (s: Omit<Spend, "salt">, tries = 3000) => cheapest((salt) => spendDigest({ ...s, salt }), tries);
export interface Terms { bump?: number; delay?: bigint; guardRoot?: Uint8Array }
export const openRecord = (root: Uint8Array, t: Terms = {}) => concat(utf8("QVLT2"), root, Uint8Array.of(t.bump ?? 0), u64(t.delay ?? 0n), t.guardRoot ?? new Uint8Array(32));
export const spendRecord = (amount: bigint, salt: bigint, nextRoot: Uint8Array, signature: Uint8Array) => concat(utf8("QSPD1"), u64(amount), u64(salt), nextRoot, signature);
export const openData = (root: Uint8Array, t: Terms = {}, u: Upload = {}) => uploadData(OP_OPEN, openRecord(root, t), { kind: KIND_OPEN, ...u });
export const spendData = (amount: bigint, salt: bigint, nextRoot: Uint8Array, signature: Uint8Array, u: Upload = {}) => uploadData(OP_SPEND, spendRecord(amount, salt, nextRoot, signature), { kind: KIND_SPEND, ...u });
export const finishData = (u: Upload = {}) => uploadData(OP_FINISH, utf8("QFIN1"), { kind: KIND_FINISH, ...u });
export const NO_NEXT_KEY = new Uint8Array(32);

/** Builds the whole spend for the vault's current key: the next key's fingerprint, a cheap salt, and the one-time signature. */
export function makeSpend(seed: Uint8Array, vault: Uint8Array, recipient: Uint8Array, amount: bigint, counter: bigint, closing = false, mint: Uint8Array = SOL): { spend: Spend; signature: Uint8Array; record: Uint8Array; work: number } {
  const nextRoot = closing ? NO_NEXT_KEY : keyRoot(seed, counter + 1n);
  const base = { vault, recipient, mint, amount, nextRoot, counter };
  const spend = { ...base, salt: bestSalt(base) }, digest = spendDigest(spend), signature = sign(seed, counter, digest);
  return { spend, signature, record: spendRecord(amount, spend.salt, nextRoot, signature), work: work(digest) };
}

// ---- the guard key: a second one-time key, kept offline, that can cancel and re-key ----
export interface Cancel { vault: Uint8Array; newRoot: Uint8Array; newGuardRoot: Uint8Array; guardCounter: bigint; salt: bigint }
/** What a cancel's signature covers: this vault, its new key, its new guard key, and which guard key signs. */
export const cancelDigest = (c: Cancel) => sha256(concat(TAG_C, c.vault, c.newRoot, c.newGuardRoot, u64(c.guardCounter), u64(c.salt))).slice(0, N);
export const cancelRecord = (salt: bigint, newRoot: Uint8Array, newGuardRoot: Uint8Array, signature: Uint8Array) => concat(utf8("QCNL1"), u64(salt), newRoot, newGuardRoot, signature);
export const cancelData = (record: Uint8Array, u: Upload = {}) => uploadData(OP_CANCEL, record, { kind: KIND_CANCEL, ...u });
/** Signs a cancel with the guard phrase. The vault gets the key that follows from `newSeed` at its current number; the guard moves to its own next key. */
export function makeCancel(guardSeed: Uint8Array, vault: Uint8Array, newSeed: Uint8Array, counter: bigint, guardCounter: bigint): { cancel: Cancel; record: Uint8Array; work: number } {
  const base = { vault, newRoot: keyRoot(newSeed, counter), newGuardRoot: keyRoot(guardSeed, guardCounter + 1n), guardCounter };
  const cancel = { ...base, salt: cheapest((salt) => cancelDigest({ ...base, salt }), 3000) }, digest = cancelDigest(cancel);
  return { cancel, record: cancelRecord(cancel.salt, base.newRoot, base.newGuardRoot, sign(guardSeed, guardCounter, digest)), work: work(digest) };
}

export interface Pending { ready: number; amount: bigint; recipient: Uint8Array; mint: Uint8Array }
export interface QVault { state: "open" | "closed"; counter: bigint; reserve: bigint; root: Uint8Array; openedTime: number; lastTime: number; totalSpent: bigint; lastRecipient: Uint8Array;
  delay: number; guardRoot: Uint8Array | null; guardCounter: bigint; pending: Pending | null; lastMint: Uint8Array; cancels: bigint; bump: number }
export function decodeQVault(d: Uint8Array): QVault | null {
  if (d.length < QVAULT_SIZE || new TextDecoder().decode(d.slice(0, 8)) !== "PHILQVLT" || (d[8] !== 1 && d[8] !== 2)) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength), ready = Number(v.getBigUint64(168, true)), guard = d.slice(128, 160);
  return { state: d[8] === 1 ? "open" : "closed", counter: v.getBigUint64(16, true), reserve: v.getBigUint64(24, true), root: d.slice(32, 64),
    openedTime: Number(v.getBigInt64(64, true)), lastTime: Number(v.getBigInt64(72, true)), totalSpent: v.getBigUint64(80, true), lastRecipient: d.slice(88, 120),
    delay: Number(v.getBigUint64(120, true)), guardRoot: guard.some((x) => x) ? guard : null, guardCounter: v.getBigUint64(160, true),
    pending: ready ? { ready, amount: v.getBigUint64(176, true), recipient: d.slice(184, 216), mint: d.slice(216, 248) } : null,
    lastMint: d.slice(248, 280), cancels: v.getBigUint64(280, true), bump: d[288] };
}
