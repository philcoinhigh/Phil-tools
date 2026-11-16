// Builds The Line's transactions. The website and the workflow script both use exactly this, so
// what is proven on a validator is what a visitor sends.
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction, Keypair } from "@solana/web3.js";
import { openData, joinData, commitData, revealData, timeoutData, MATCH_SIZE, Side } from "./line";

const ix = (program: PublicKey, data: Uint8Array, keys: [PublicKey, boolean, boolean][]) =>
  new TransactionInstruction({ programId: program, data: Buffer.from(data), keys: keys.map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })) });

export interface OpenTerms { program: PublicKey; payer: PublicKey; player: PublicKey; owner: PublicKey; windowSeconds: number; invited?: PublicKey; rentLamports: number }
/** One transaction: make the match account and open it, seating player A. The new account, the player key and the owner all sign. */
export function openInstructions(t: OpenTerms, match: Keypair = Keypair.generate(), data?: Uint8Array): { match: Keypair; instructions: TransactionInstruction[] } {
  return { match, instructions: [
    SystemProgram.createAccount({ fromPubkey: t.payer, newAccountPubkey: match.publicKey, lamports: t.rentLamports, space: MATCH_SIZE, programId: t.program }),
    ix(t.program, data ?? openData(t.windowSeconds, t.invited?.toBytes()), [[match.publicKey, false, true], [t.player, true, false], [t.owner, true, false]]),
  ] };
}
export const joinInstruction = (program: PublicKey, match: PublicKey, player: PublicKey, owner: PublicKey, data?: Uint8Array) =>
  ix(program, data ?? joinData(), [[match, false, true], [player, true, false], [owner, true, false]]);
export const commitInstruction = (program: PublicKey, match: PublicKey, player: PublicKey, round: number, hash: Uint8Array, data?: Uint8Array) =>
  ix(program, data ?? commitData(round, hash), [[match, false, true], [player, true, false]]);
export interface Move { round: number; side: Side; pull: number; nonce: Uint8Array }
export const revealInstruction = (program: PublicKey, match: PublicKey, player: PublicKey, m: Move, data?: Uint8Array) =>
  ix(program, data ?? revealData(match.toBytes(), m.round, m.side, m.pull, m.nonce), [[match, false, true], [player, true, false]]);
export const timeoutInstruction = (program: PublicKey, match: PublicKey) => ix(program, timeoutData(), [[match, false, true]]);
