// Reads a giveaway back from Solana alone: its account, and the transaction that locked it.
// A giveaway run from the website has no record in the repository, so this is how its page is made.
import { decodeDraw, pickWinners, hex, sha256, listBytes, cleanEntries, Draw, OP_LOCK } from "./draw";
import { base58Decode } from "./solana-call";
import { Chain, bytesOf } from "./wallet";

export interface Locked { kind: 1 | 2; count: number; winners: number; delay: number; title: string; entries: string[] | null; listDigest: Uint8Array }
/** The giveaway record, as uploaded. With kind 1 the entry list is inside it; with kind 2 only its SHA-256 is. */
export function parseRecord(p: Uint8Array): Locked | null {
  if (p.length < 16 || new TextDecoder().decode(p.slice(0, 5)) !== "DRAW1") return null;
  const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const kind = p[5], titleLength = p[15], at = 16 + titleLength;
  if ((kind !== 1 && kind !== 2) || at > p.length) return null;
  const base = { kind: kind as 1 | 2, count: v.getUint32(6, true), winners: p[10], delay: v.getUint32(11, true), title: new TextDecoder().decode(p.slice(16, at)) };
  if (kind === 2) return p.length === at + 32 ? { ...base, entries: null, listDigest: p.slice(at) } : null;
  const list = p.slice(at), entries = new TextDecoder().decode(list).split("\n");
  return entries.length === base.count ? { ...base, entries, listDigest: sha256(list) } : null;
}
/** The payload inside a lock instruction: instruction byte, Hello frame, Begin frame, one byte, payload. */
export function payloadOfUpload(data: Uint8Array): Uint8Array | null {
  let at = 1;
  for (const tag of [1, 2]) {
    if (data.length < at + 8 || data[at] !== 0x50 || data[at + 1] !== 0x48 || data[at + 2] !== 0x49 || data[at + 3] !== 0x4c || data[at + 5] !== tag) return null;
    at += 8 + ((data[at + 6] << 8) | data[at + 7]);
  }
  return data.length > at && data[at] === 1 ? data.slice(at + 1) : null;
}

/** The same shape as a giveaway recorded in the repository, so one page shows both. */
export interface ChainGiveaway {
  id: string; fromChain: true; title: string; network: string; program: string; wallet: string; account: string; state: Draw["state"];
  entries: string[] | null; repeatsRemoved: 0; winnerCount: number; count: number; kind: 1 | 2; payloadDigest: string; payloadLength: number; listDigest: string; delaySlots: number;
  lock: { signature: string; slot: number; time: number }; draw: { signature: string | null; targetSlot: number; hashSlot: number };
  winners: { index: number; entry: string }[];
}
export function winnersOf(d: Draw, entries: string[] | null): { index: number; entry: string }[] {
  if (d.state !== "drawn") return [];
  return pickWinners(d.randomness, d.count, d.winners).map((index) => ({ index, entry: entries?.[index] ?? `Entry number ${index + 1}` }));
}
/** Checks a pasted list against the fingerprint that was locked. Returns the cleaned entries, or null. */
export function listMatches(text: string, g: { listDigest: string; count: number }): string[] | null {
  const entries = cleanEntries(text).entries;
  return entries.length === g.count && hex(sha256(listBytes(entries))) === g.listDigest ? entries : null;
}

export async function giveawayFromChain(c: Chain, program: string, account: string): Promise<ChainGiveaway> {
  const info = (await c.rpc("getAccountInfo", [account, { encoding: "base64", commitment: "confirmed" }])).value;
  if (!info) throw new Error(`There is no giveaway at that address on ${c.name}.`);
  const d = info.owner === program ? decodeDraw(bytesOf(info.data[0])) : null;
  if (!d || d.state === "empty") throw new Error("That address is not a giveaway made with this program.");
  const sigs: any[] = await c.rpc("getSignaturesForAddress", [account, { limit: 25, commitment: "confirmed" }]);
  let lockSignature = "", drawSignature: string | null = null, wallet = "", locked: Locked | null = null;
  for (const s of sigs ?? []) {
    if (s.err) continue;
    const tx = await c.rpc("getTransaction", [s.signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
    const logs: string[] = tx?.meta?.logMessages ?? [], keys: string[] = tx?.transaction?.message?.accountKeys ?? [];
    if (logs.some((l) => l.includes("Phil draw: DRAWN") || l.includes("Phil draw: EXPIRED"))) drawSignature = s.signature;
    for (const ix of tx?.transaction?.message?.instructions ?? []) {
      if (keys[ix.programIdIndex] !== program) continue;
      const data = base58Decode(ix.data);
      const payload = data[0] === OP_LOCK ? payloadOfUpload(data) : null;
      // Only the upload whose SHA-256 is the one in the account is the lock. Refused attempts are ignored.
      if (payload && hex(sha256(payload)) === hex(d.payloadDigest)) { locked = parseRecord(payload); lockSignature = s.signature; wallet = keys[0]; }
    }
  }
  if (!locked || hex(locked.listDigest) !== hex(d.listDigest)) throw new Error("Could not find this giveaway's lock transaction on Solana. Try again in a moment.");
  return {
    id: account, fromChain: true, title: d.title, network: c.name, program, wallet, account, state: d.state,
    entries: locked.entries, repeatsRemoved: 0, winnerCount: d.winners, count: d.count, kind: d.kind, payloadDigest: hex(d.payloadDigest), payloadLength: d.payloadLength, listDigest: hex(d.listDigest), delaySlots: d.delay,
    lock: { signature: lockSignature, slot: d.lockSlot, time: d.lockTime }, draw: { signature: drawSignature, targetSlot: d.targetSlot, hashSlot: d.hashSlot },
    winners: winnersOf(d, locked.entries),
  };
}
