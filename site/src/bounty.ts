// Clip Bounties: what is uploaded, and how the two kinds of account read.
import { uploadData, Upload, sha256, concat } from "./draw";

export const OP_POST = 1, OP_ENTER = 2, OP_AWARD = 3, OP_ARM = 4, OP_DRAW = 5, OP_CLAIM = 6, OP_REFUND = 7;
export const KIND_POST = "phil-bounty/post", KIND_ENTER = "phil-bounty/enter";
export const BOUNTY_SIZE = 512, ENTRY_SIZE = 320, MAX_TEXT = 280, MAX_LINK = 220, DRAW_AHEAD = 20, DRAW_WINDOW = 450;
const utf8 = (s: string) => new TextEncoder().encode(s);
const u64 = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt.asUintN(64, n), true); return b; };

export interface Terms { bump: number; deadline: number; graceSeconds: number; prize: bigint; text: string }
export const postRecord = (t: Terms) => concat(utf8("CBTY1"), Uint8Array.of(t.bump), u64(BigInt(t.deadline)), u64(BigInt(t.graceSeconds)), u64(t.prize), utf8(t.text));
export const postData = (t: Terms, u: Upload = {}) => uploadData(OP_POST, postRecord(t), { kind: KIND_POST, ...u });
export const enterData = (link: string, u: Upload = {}) => uploadData(OP_ENTER, concat(utf8("CENT1"), utf8(link)), { kind: KIND_ENTER, ...u });

export interface Bounty { state: "open" | "paid" | "refunded" | "drawn"; how: "sponsor" | "draw" | null; sponsor: Uint8Array; mint: Uint8Array | null; prize: bigint; reserve: bigint; deadline: number; graceSeconds: number;
  count: number; posted: number; drawSlot: bigint; winnerIndex: number; winner: Uint8Array; paidTime: number; hashSlot: bigint; slotHash: Uint8Array; text: string; bump: number }
export function decodeBounty(d: Uint8Array): Bounty | null {
  if (d.length < BOUNTY_SIZE || new TextDecoder().decode(d.slice(0, 8)) !== "PHILBNTY" || d[8] < 1 || d[8] > 4) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength), mint = d.slice(48, 80), textLen = Math.min(v.getUint16(224, true), MAX_TEXT);
  return { state: (["", "open", "paid", "refunded", "drawn"] as const)[d[8]] as Bounty["state"], how: d[10] === 1 ? "sponsor" : d[10] === 2 ? "draw" : null, sponsor: d.slice(16, 48), mint: mint.some((x) => x) ? mint : null,
    prize: v.getBigUint64(80, true), reserve: v.getBigUint64(88, true), deadline: Number(v.getBigInt64(96, true)), graceSeconds: Number(v.getBigUint64(104, true)), count: v.getUint32(112, true), posted: Number(v.getBigInt64(120, true)),
    drawSlot: v.getBigUint64(128, true), winnerIndex: v.getUint32(136, true), winner: d.slice(144, 176), paidTime: Number(v.getBigInt64(176, true)), hashSlot: v.getBigUint64(184, true), slotHash: d.slice(192, 224),
    text: new TextDecoder().decode(d.slice(226, 226 + textLen)), bump: d[9] };
}
export interface Entry { bounty: Uint8Array; entrant: Uint8Array; index: number; time: number; link: string }
export function decodeEntry(d: Uint8Array): Entry | null {
  if (d.length < ENTRY_SIZE || new TextDecoder().decode(d.slice(0, 8)) !== "PHILBENT") return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return { bounty: d.slice(8, 40), entrant: d.slice(40, 72), index: v.getUint32(72, true), time: Number(v.getBigInt64(80, true)), link: new TextDecoder().decode(d.slice(90, 90 + Math.min(v.getUint16(88, true), MAX_LINK))) };
}
/** The entry number a block hash draws: anyone can redo this from the bounty's own record. */
export const drawnIndex = (slotHash: Uint8Array, bounty: Uint8Array, count: number) => Number(new DataView(sha256(concat(slotHash, bounty)).buffer).getBigUint64(0, true) % BigInt(count));
/** Only links to where clips are normally posted are shown as links. Anything else is shown as plain text. */
export function safeLink(text: string): string | null {
  try { const u = new URL(text.trim()); return u.protocol === "https:" && /(^|\.)(x\.com|twitter\.com|youtube\.com|youtu\.be|tiktok\.com|twitch\.tv|kick\.com|instagram\.com|streamable\.com|medal\.tv)$/.test(u.hostname) ? u.href : null; } catch { return null; }
}
