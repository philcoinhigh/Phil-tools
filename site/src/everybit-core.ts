// "Every bit": one honest upload, and every way to damage it by a single bit or by cutting it short.
// Shared by the run that sends them to Solana and by the page that shows what came back.
import { noteData } from "./chains";

/** Thirty-one characters, so the whole upload is 111 bytes: 888 bits to flip and 111 places to cut. With the honest one, 1,000 transactions. */
export const NOTE = "every bit of this was attacked.";
export const honest = (): Uint8Array => noteData(NOTE);

export interface Field { from: number; to: number; name: string; says: string }
/** What each byte of the upload is, in order. `to` is one past the last byte. */
export function fields(length = honest().length): Field[] {
  return [
    { from: 0, to: 1, name: "instruction", says: "which of the program's instructions this is" },
    { from: 1, to: 5, name: "hello: magic", says: "the four letters PHIL that open every frame" },
    { from: 5, to: 6, name: "hello: codec version", says: "which version of the framing this is" },
    { from: 6, to: 7, name: "hello: frame type", says: "that this frame is a hello" },
    { from: 7, to: 9, name: "hello: frame length", says: "how many bytes of hello follow" },
    { from: 9, to: 11, name: "hello: version count", says: "how many protocol versions the client offers" },
    { from: 11, to: 13, name: "hello: version offered", says: "the protocol version the client speaks" },
    { from: 13, to: 17, name: "begin: magic", says: "the four letters PHIL again" },
    { from: 17, to: 18, name: "begin: codec version", says: "which version of the framing this is" },
    { from: 18, to: 19, name: "begin: frame type", says: "that this frame begins an upload" },
    { from: 19, to: 21, name: "begin: frame length", says: "how many bytes of begin follow" },
    { from: 21, to: 29, name: "declared length", says: "how many bytes the client promises to send" },
    { from: 29, to: 30, name: "kind: length", says: "how long the kind's name is" },
    { from: 30, to: 46, name: "kind", says: "what sort of upload this is; the server's policy decides whether it takes that sort" },
    { from: 46, to: 47, name: "digest algorithm", says: "that the digest is a SHA-256" },
    { from: 47, to: 79, name: "declared digest", says: "the SHA-256 the client promises the bytes will have" },
    { from: 79, to: 80, name: "proceed or cancel", says: "whether the client goes ahead after the server's answer" },
    { from: 80, to: length, name: "the bytes themselves", says: "the upload: the note" },
  ];
}
export const fieldOf = (byte: number, fs = fields()) => fs.find((f) => byte >= f.from && byte < f.to)!;

export interface Case { kind: "honest" | "flip" | "cut"; at: number; data: Uint8Array }
/** The honest upload, then each bit flipped (bit 0 of byte 0 first), then each shorter length from 0 up. */
export function cases(): Case[] {
  const good = honest(), out: Case[] = [{ kind: "honest", at: 0, data: good }];
  for (let bit = 0; bit < good.length * 8; bit++) { const d = good.slice(); d[bit >> 3] ^= 1 << (bit & 7); out.push({ kind: "flip", at: bit, data: d }); }
  for (let n = 0; n < good.length; n++) out.push({ kind: "cut", at: n, data: good.slice(0, n) });
  return out;
}
