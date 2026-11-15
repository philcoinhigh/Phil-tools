// Builds the burn vault's transactions. The website (signed by a wallet) and the workflow script
// (signed by a key) both use exactly this, so what is proven on a validator is what a visitor sends.
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction, Keypair } from "@solana/web3.js";
import { openData, burnData, VAULT_SIZE } from "./burn";

export const openInstruction = (program: PublicKey, vault: PublicKey, data: Uint8Array) =>
  new TransactionInstruction({ programId: program, keys: [{ pubkey: vault, isSigner: false, isWritable: true }], data: Buffer.from(data) });

export interface VaultTerms { program: PublicKey; payer: PublicKey; mint: PublicKey; threshold: bigint; label: string; rentLamports: number }
/** One transaction: make the vault account and open it, so nothing can arrive in between. The new vault account signs too. */
export function openInstructions(t: VaultTerms, vault: Keypair = Keypair.generate(), data?: Uint8Array): { vault: Keypair; instructions: TransactionInstruction[] } {
  return { vault, instructions: [
    SystemProgram.createAccount({ fromPubkey: t.payer, newAccountPubkey: vault.publicKey, lamports: t.rentLamports, space: VAULT_SIZE, programId: t.program }),
    openInstruction(t.program, vault.publicKey, data ?? openData(t.mint.toBytes(), t.threshold, t.label)),
  ] };
}
export interface BurnTerms { program: PublicKey; vault: PublicKey; mint: PublicKey; tokens: PublicKey; sender: PublicKey; tokenProgram: PublicKey; leastLamports: bigint }
/** Burn the vault's threshold from `tokens` and take the pot, but only if the pot is at least `leastLamports`. */
export const burnInstruction = (t: BurnTerms, data?: Uint8Array) => new TransactionInstruction({ programId: t.program, data: Buffer.from(data ?? burnData(t.leastLamports)), keys: [
  { pubkey: t.vault, isSigner: false, isWritable: true }, { pubkey: t.mint, isSigner: false, isWritable: true }, { pubkey: t.tokens, isSigner: false, isWritable: true },
  { pubkey: t.sender, isSigner: true, isWritable: true }, { pubkey: t.tokenProgram, isSigner: false, isWritable: false }] });
