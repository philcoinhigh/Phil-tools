// Burn vaults: the bytes. Shared by the page, the tests and the workflow script.
import { concat, utf8, uploadData, Upload } from "./draw";

export const OP_OPEN = 1, OP_BURN = 2;
export const KIND_OPEN = "phil-burn/open", KIND_OFFER = "phil-burn/offer";
export const VAULT_SIZE = 256;
const u64le = (v: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); return b; };

/** The rule uploaded at OPEN: which coin, and how many (smallest units) must be burned to take the pot. */
export function ruleRecord(mint: Uint8Array, threshold: bigint, label: string): Uint8Array {
  const l = utf8(label);
  if (mint.length !== 32) throw new Error("A mint address is 32 bytes.");
  if (threshold <= 0n || threshold >= 1n << 64n) throw new Error("The threshold must be a positive amount.");
  if (l.length > 32) throw new Error("The label must be at most 32 bytes.");
  return concat(utf8("BURN1"), mint, u64le(threshold), Uint8Array.of(l.length), l);
}
/** The offer uploaded at BURN: the least, in lamports, the sender will accept for burning the threshold. */
export const offerRecord = (leastLamports: bigint) => concat(utf8("BOFF1"), u64le(leastLamports));
export const openData = (mint: Uint8Array, threshold: bigint, label: string, u: Upload = {}) => uploadData(OP_OPEN, ruleRecord(mint, threshold, label), { kind: KIND_OPEN, ...u });
export const burnData = (leastLamports: bigint, u: Upload = {}) => uploadData(OP_BURN, offerRecord(leastLamports), { kind: KIND_OFFER, ...u });

export interface Vault {
  open: boolean; label: string; threshold: bigint; reserve: bigint; mint: Uint8Array;
  openedSlot: number; openedTime: number; burns: number; totalBurned: bigint; totalPaid: bigint;
  lastSlot: number; lastTime: number; lastPaid: bigint; ruleDigest: Uint8Array;
}
export function decodeVault(d: Uint8Array): Vault | null {
  if (d.length < VAULT_SIZE || new TextDecoder().decode(d.slice(0, 8)) !== "PHILBURN") return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u = (at: number) => v.getBigUint64(at, true);
  return { open: d[8] === 1, label: new TextDecoder().decode(d.slice(160, 160 + d[9])), threshold: u(16), reserve: u(24), mint: d.slice(32, 64),
    openedSlot: Number(u(64)), openedTime: Number(u(72)), burns: Number(u(80)), totalBurned: u(88), totalPaid: u(96),
    lastSlot: Number(u(104)), lastTime: Number(u(112)), lastPaid: u(120), ruleDigest: d.slice(128, 160) };
}
/** What the vault would pay right now: everything above its reserve. */
export const potOf = (lamports: bigint, v: Vault) => (lamports > v.reserve ? lamports - v.reserve : 0n);
export const sol = (lamports: bigint, digits = 4) => (Number(lamports) / 1e9).toLocaleString("en-GB", { maximumFractionDigits: digits });
export function coins(units: bigint, decimals: number): string {
  const whole = units / 10n ** BigInt(decimals);
  return Number(whole).toLocaleString("en-GB");
}
