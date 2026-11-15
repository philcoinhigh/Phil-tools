// Builds the giveaway's transactions. The website (signed by a wallet) and the workflow script
// (signed by a key) both use exactly this, so what is proven on a validator is what a visitor sends.
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction, Keypair } from "@solana/web3.js";
import { uploadData, OP_LOCK, OP_DRAW, DRAW_SIZE } from "./draw";

/** Where Solana keeps the hashes of its recent blocks. */
export const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");
/** Solana keeps a block's hash for 512 slots. A giveaway nobody draws in that time expires with no winner. */
export const DRAW_WINDOW_SLOTS = 512;

export const lockInstruction = (program: PublicKey, account: PublicKey, data: Uint8Array) =>
  new TransactionInstruction({ programId: program, keys: [{ pubkey: account, isSigner: false, isWritable: true }], data: Buffer.from(data) });
export const drawInstruction = (program: PublicKey, account: PublicKey) =>
  new TransactionInstruction({ programId: program, data: Buffer.from([OP_DRAW]), keys: [{ pubkey: account, isSigner: false, isWritable: true }, { pubkey: SLOT_HASHES, isSigner: false, isWritable: false }] });

export interface GiveawayTerms { program: PublicKey; payer: PublicKey; payload: Uint8Array; rentLamports: number }
/** One transaction: make the giveaway's account and lock it, so nobody else can lock something into it first. */
export function lockGiveawayInstructions(t: GiveawayTerms, account: Keypair = Keypair.generate()): { account: Keypair; instructions: TransactionInstruction[] } {
  return { account, instructions: [
    SystemProgram.createAccount({ fromPubkey: t.payer, newAccountPubkey: account.publicKey, lamports: t.rentLamports, space: DRAW_SIZE, programId: t.program }),
    lockInstruction(t.program, account.publicKey, uploadData(OP_LOCK, t.payload)),
  ] };
}
/** The most a locked record may be for the lock to fit in one Solana transaction with the account's creation. */
export const MAX_ONE_TX_PAYLOAD = 760;
