// The Line, refereed on Solana by Phil's upload server: byte formats, the match account, and the
// rules. The rules here mirror line/runtime.c and are checked against it in test/line.ts.
// Rules "duels-1" are from github.com/HigherMaestro/highwire (MIT).
import { concat, sha256, utf8, uploadData, Upload } from "./draw";

export const OP_OPEN = 1, OP_JOIN = 2, OP_COMMIT = 3, OP_REVEAL = 4, OP_TIMEOUT = 5;
export const KIND_OPEN = "phil-line/open", KIND_JOIN = "phil-line/join", KIND_COMMIT = "phil-line/commit", KIND_REVEAL = "phil-line/reveal";
export const MATCH_SIZE = 320;
export const PLACES = 7, MIDDLE = 3, START_ENERGY = 30, REGAIN = 2, ROUNDS = 15, MIN_WINDOW = 20, MAX_WINDOW = 86400;
export type Side = 0 | 1;

// ---- what is uploaded ----
export function openRecord(windowSeconds: number, invited?: Uint8Array): Uint8Array {
  const r = new Uint8Array(42);
  r.set(utf8("LINE1")); new DataView(r.buffer).setUint32(5, windowSeconds, true);
  if (invited) { r[9] = 1; r.set(invited, 10); }
  return r;
}
export const joinRecord = () => utf8("JOIN1");
export const commitRecord = (round: number, hash: Uint8Array) => concat(utf8("LCOM1"), Uint8Array.of(round), hash);
/** Exactly what is hashed to commit, and uploaded to reveal: match, round, side, pull, nonce. 67 bytes. */
export const moveBytes = (match: Uint8Array, round: number, side: Side, pull: number, nonce: Uint8Array) => concat(match, Uint8Array.of(round, side, pull), nonce);
export const commitment = (match: Uint8Array, round: number, side: Side, pull: number, nonce: Uint8Array) => sha256(moveBytes(match, round, side, pull, nonce));

export const openData = (windowSeconds: number, invited?: Uint8Array, u: Upload = {}) => uploadData(OP_OPEN, openRecord(windowSeconds, invited), { kind: KIND_OPEN, ...u });
export const joinData = (u: Upload = {}) => uploadData(OP_JOIN, joinRecord(), { kind: KIND_JOIN, ...u });
export const commitData = (round: number, hash: Uint8Array, u: Upload = {}) => uploadData(OP_COMMIT, commitRecord(round, hash), { kind: KIND_COMMIT, ...u });
/** A reveal declares the committed hash as its digest, so Phil's server checks the revealed bytes against it. */
export const revealData = (match: Uint8Array, round: number, side: Side, pull: number, nonce: Uint8Array, u: Upload = {}) =>
  uploadData(OP_REVEAL, moveBytes(match, round, side, pull, nonce), { kind: KIND_REVEAL, ...u });
export const timeoutData = () => Uint8Array.of(OP_TIMEOUT);

// ---- the match account ----
export type Phase = "empty" | "waiting" | "committing" | "revealing" | "over";
export type Result = "none" | "a" | "b" | "drawn" | "void";
export type How = "none" | "reached-end" | "fifteen-rounds" | "no-reveal" | "no-commit" | "nobody-moved";
export interface Match {
  phase: Phase; round: number; node: number; result: Result; how: How; energy: [number, number];
  committed: [boolean, boolean]; revealed: [boolean, boolean]; pulls: [number, number];
  phaseStart: number; openedTime: number; endedTime: number; window: number; invited: boolean;
  players: [Uint8Array, Uint8Array]; owners: [Uint8Array, Uint8Array]; commits: [Uint8Array, Uint8Array];
  /** Every round that has been played: A's pull, B's pull. */
  history: [number, number][];
}
const PHASES: Phase[] = ["empty", "waiting", "committing", "revealing", "over"];
const RESULTS: Result[] = ["none", "a", "b", "drawn", "void"];
const HOWS: How[] = ["none", "reached-end", "fifteen-rounds", "no-reveal", "no-commit", "nobody-moved"];
export function decodeMatch(d: Uint8Array): Match | null {
  if (d.length < MATCH_SIZE) return null;
  if (d.every((x) => x === 0)) return null;
  if (new TextDecoder().decode(d.slice(0, 8)) !== "PHILLINE" || d[8] >= PHASES.length) return null;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength), phase = PHASES[d[8]];
  const time = (at: number) => Number(v.getBigInt64(at, true)), key = (at: number) => d.slice(at, at + 32);
  // The round counter stays on the last round when the match ends there; rounds played is what the history holds.
  const played = phase === "over" && (d[12] === 1 || d[12] === 2) ? d[9] : Math.max(0, d[9] - 1);
  return {
    phase, round: d[9], node: d[10], result: RESULTS[d[11]] ?? "none", how: HOWS[d[12]] ?? "none", energy: [d[13], d[14]],
    committed: [!!(d[15] & 1), !!(d[15] & 2)], revealed: [!!(d[15] & 4), !!(d[15] & 8)], pulls: [d[48], d[49]],
    phaseStart: time(16), openedTime: time(24), endedTime: time(32), window: v.getUint32(40, true), invited: d[44] === 1,
    players: [key(64), key(96)], owners: [key(128), key(160)], commits: [key(192), key(224)],
    history: Array.from({ length: played }, (_, i) => [d[256 + 2 * i], d[257 + 2 * i]] as [number, number]),
  };
}

// ---- the rules, for showing a match and for the practice opponent ----
export interface Board { round: number; node: number; energy: [number, number]; result: Result; how: How }
export const newBoard = (): Board => ({ round: 1, node: MIDDLE, energy: [START_ENERGY, START_ENERGY], result: "none", how: "none" });
/** Plays one round. Both sides pay what they pulled; the bigger pull moves the node one place its way. */
export function playRound(b: Board, a: number, bb: number): Board {
  if (b.result !== "none") return b;
  if (!Number.isInteger(a) || !Number.isInteger(bb) || a < 0 || bb < 0 || a > b.energy[0] || bb > b.energy[1]) throw new Error("A pull must be a whole number from 0 up to that side's energy.");
  const node = b.node + (a > bb ? -1 : bb > a ? 1 : 0), energy: [number, number] = [b.energy[0] - a, b.energy[1] - bb];
  if (node === 0) return { round: b.round, node, energy, result: "a", how: "reached-end" };
  if (node === PLACES - 1) return { round: b.round, node, energy, result: "b", how: "reached-end" };
  if (b.round === ROUNDS) return { round: b.round, node, energy, result: node < MIDDLE ? "a" : node > MIDDLE ? "b" : "drawn", how: "fifteen-rounds" };
  return { round: b.round + 1, node, energy: [Math.min(START_ENERGY, energy[0] + REGAIN), Math.min(START_ENERGY, energy[1] + REGAIN)], result: "none", how: "none" };
}
/** Every position of a match, from the start through each played round. */
export function replay(history: [number, number][]): Board[] {
  const out = [newBoard()];
  for (const [a, b] of history) out.push(playRound(out[out.length - 1], a, b));
  return out;
}
/**
 * The practice opponent. It spends about a third of its energy, more when it is losing ground or the
 * match is nearly over, less when ahead, with some noise so it cannot be read exactly. `random` is in [0, 1).
 */
export function practicePull(b: Board, side: Side, random: () => number): number {
  const energy = b.energy[side], behind = side === 0 ? b.node - MIDDLE : MIDDLE - b.node, left = ROUNDS - b.round + 1;
  if (energy === 0) return 0;
  let share = 0.3 + 0.12 * behind + (left <= 3 ? 0.25 : 0);
  if (behind === 2) share += 0.2;                      // one more place and the match is lost
  const pull = Math.round(energy * Math.min(1, Math.max(0.05, share)) + (random() - 0.5) * 6);
  return Math.min(energy, Math.max(0, pull));
}
export const resultText = (m: { result: Result; how: How }, names: [string, string] = ["A", "B"]): string => {
  const who = m.result === "a" ? names[0] : m.result === "b" ? names[1] : "";
  const other = m.result === "a" ? names[1] : names[0];
  if (m.result === "drawn") return "Drawn: the node ended in the middle after 15 rounds.";
  if (m.result === "void") return "Void: neither side moved in time.";
  if (m.result === "none") return "";
  return m.how === "reached-end" ? `${who} won by pulling the node to their end.` : m.how === "fifteen-rounds" ? `${who} won: the node was on their side after 15 rounds.`
    : m.how === "no-reveal" ? `${who} won: ${other} committed a move and did not reveal it in time.` : `${who} won: ${other} did not move in time.`;
};
