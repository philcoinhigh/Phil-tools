// Giveaways: everything about the bytes. Shared by the page, the tests and the workflow script.
//
// A giveaway is uploaded to the on-chain program through Phil's upload protocol:
//   Hello frame, Begin frame (declared length and SHA-256), a one-byte "payload" choice, payload.
// The frames are in the format of Phil's control codec v1 (runtime/phase0/control_codec_v1.c).
// The payload is the giveaway record: title, winners, delay and the entry list (or its SHA-256).

// ---- SHA-256, synchronous, so the same code runs in a page, in a test and in a script ----
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256(msg: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const total = Math.ceil((msg.length + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg); buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor((msg.length * 8) / 2 ** 32)); view.setUint32(total - 4, (msg.length * 8) >>> 0);
  const w = new Uint32Array(64);
  const ror = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + 4 * i);
    for (let i = 16; i < 64; i++) w[i] = (w[i - 16] + (ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 7] + (ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10))) >>> 0;
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const o = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) o.setUint32(4 * i, h[i]);
  return out;
}

export const utf8 = (s: string) => new TextEncoder().encode(s);
export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const u32le = (v: number) => Uint8Array.of(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
const u16be = (v: number) => Uint8Array.of((v >>> 8) & 255, v & 255);
const u64be = (v: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v)); return b; };

// ---- the entry list ----
export const MAX_PAYLOAD = 940;
export const MIN_DELAY = 20, MAX_DELAY = 432000;
export const KIND = "phil-draw/1";
export const OP_LOCK = 1, OP_DRAW = 2, OP_CHECK = 3;

/** One entry per line: trimmed, blanks dropped, repeats (ignoring case and a leading @) dropped. */
export function cleanEntries(text: string): { entries: string[]; repeats: number } {
  const seen = new Set<string>();
  const entries: string[] = [];
  let repeats = 0;
  for (const raw of text.split(/\r?\n|,/)) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (!line) continue;
    const key = line.replace(/^@/, "").toLowerCase();
    if (seen.has(key)) { repeats++; continue; }
    seen.add(key); entries.push(line);
  }
  return { entries, repeats };
}
export const listBytes = (entries: string[]) => utf8(entries.join("\n"));

export interface Giveaway { title: string; winners: number; delay: number; entries: string[] }
export interface Record { kind: 1 | 2; payload: Uint8Array; listDigest: Uint8Array }

/** The record that is uploaded. The list goes in whole when it fits; otherwise its SHA-256 does. */
export function buildRecord(g: Giveaway, kind?: 1 | 2): Record {
  const title = utf8(g.title);
  if (title.length === 0 || title.length > 64) throw new Error("The title must be 1 to 64 bytes.");
  if (g.entries.length === 0) throw new Error("There are no entries.");
  if (g.winners < 1 || g.winners > g.entries.length || g.winners > 255) throw new Error("Winners must be between 1 and the number of entries.");
  if (g.delay < MIN_DELAY || g.delay > MAX_DELAY) throw new Error(`The delay must be ${MIN_DELAY} to ${MAX_DELAY} slots.`);
  const list = listBytes(g.entries);
  const listDigest = sha256(list);
  const head = concat(utf8("DRAW1"), Uint8Array.of(0), u32le(g.entries.length), Uint8Array.of(g.winners), u32le(g.delay), Uint8Array.of(title.length), title);
  const chosen = kind ?? (head.length + list.length <= MAX_PAYLOAD ? 1 : 2);
  head[5] = chosen;
  return { kind: chosen, payload: concat(head, chosen === 1 ? list : listDigest), listDigest };
}

// ---- Phil's control codec v1 frames ----
const header = (tag: number, length: number) => concat(Uint8Array.of(0x50, 0x48, 0x49, 0x4c, 1, tag), u16be(length));
export const helloFrame = (versions: number[]) => concat(header(1, 2 + 2 * versions.length), u16be(versions.length), ...versions.map(u16be));
export function beginFrame(length: number, kind: string, digest: Uint8Array): Uint8Array {
  const k = utf8(kind);
  return concat(header(2, 42 + k.length), u64be(length), Uint8Array.of(k.length), k, Uint8Array.of(1), digest);
}

export interface Upload { versions?: number[]; kind?: string; declaredLength?: number; declaredDigest?: Uint8Array; cancel?: boolean }
/** The instruction data: which instruction, then the whole client side of the conversation. */
export function uploadData(op: number, payload: Uint8Array, u: Upload = {}): Uint8Array {
  return concat(Uint8Array.of(op), helloFrame(u.versions ?? [1]),
    beginFrame(u.declaredLength ?? payload.length, u.kind ?? KIND, u.declaredDigest ?? sha256(payload)),
    Uint8Array.of(u.cancel ? 0 : 1), u.cancel ? new Uint8Array(0) : payload);
}

// ---- the draw account ----
export interface Draw {
  state: "empty" | "locked" | "drawn" | "expired"; kind: 1 | 2; winners: number; count: number; delay: number; payloadLength: number;
  lockSlot: number; lockTime: number; targetSlot: number; payloadDigest: Uint8Array; listDigest: Uint8Array;
  hashSlot: number; slotHash: Uint8Array; randomness: Uint8Array; winner: number; title: string;
}
export const DRAW_SIZE = 256;
export function decodeDraw(d: Uint8Array): Draw | null {
  if (d.length < DRAW_SIZE || new TextDecoder().decode(d.slice(0, 8)) !== "PHILDRAW") return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u64 = (at: number) => Number(v.getBigUint64(at, true));
  return {
    state: (["empty", "locked", "drawn", "expired"] as const)[d[8]] ?? "empty", kind: d[9] as 1 | 2, winners: d[10], count: v.getUint32(12, true), delay: v.getUint32(16, true), payloadLength: v.getUint32(20, true),
    lockSlot: u64(24), lockTime: u64(32), targetSlot: u64(40), payloadDigest: d.slice(48, 80), listDigest: d.slice(80, 112),
    hashSlot: u64(112), slotHash: d.slice(120, 152), randomness: d.slice(152, 184), winner: u64(184), title: new TextDecoder().decode(d.slice(192, 192 + d[11])),
  };
}

// ---- the draw itself, recomputed off chain ----
export const randomnessOf = (payloadDigest: Uint8Array, slotHash: Uint8Array, drawKey: Uint8Array) => sha256(concat(payloadDigest, slotHash, drawKey));
/** Winner j is sha256(randomness, j) as a number, modulo the entry count; repeats are skipped. */
export function pickWinners(randomness: Uint8Array, count: number, winners: number): number[] {
  const out: number[] = [];
  for (let j = 0; out.length < winners && j < winners + 10000; j++) {
    const h = sha256(concat(randomness, u32le(j)));
    const index = Number(new DataView(h.buffer).getBigUint64(0, true) % BigInt(count));
    if (!out.includes(index)) out.push(index);
  }
  return out;
}

// ---- reading the program's log ----
export interface Verdict { accepted: boolean; steps: string[]; why: string }
const WHY: [RegExp, string][] = [
  [/ACCEPTED/, "Phil accepted it."],
  [/do not match the declared digest/, "Phil rejected it: the bytes are not the ones that were declared."],
  [/fewer bytes arrived/, "Phil stopped: fewer bytes arrived than were declared."],
  [/REJECTED by policy/, "Phil rejected it by policy before reading any payload."],
  [/no protocol version in common/, "Phil refused: no protocol version in common."],
  [/frame was not recognized/, "Phil refused: a frame was malformed."],
  [/client cancelled/, "The upload was cancelled."],
  [/could not be stored/, "Phil validated the upload, but it is not the giveaway that is locked."],
  [/bytes left over/, "Refused: there were bytes left over after the upload."],
];
export function readVerdict(logs: string[]): Verdict {
  const steps = logs.map((l) => /Program log: (Phil[^]*)/.exec(l)?.[1] ?? /^LOG (Phil[^]*)/.exec(l)?.[1] ?? "").filter(Boolean);
  const joined = steps.join("\n");
  const accepted = /Phil: ACCEPTED/.test(joined) && !/bytes left over/.test(joined);
  const why = (accepted ? WHY[0] : WHY.slice(1).find(([re]) => re.test(joined)))?.[1] ?? "The program did not finish.";
  return { accepted, steps, why };
}
