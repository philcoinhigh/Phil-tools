// Builds the quantum-safe vault's transactions. The website and the workflow script both use
// exactly this, so what is proven on a validator is what a visitor sends.
import { Buffer } from "buffer";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, Keypair } from "@solana/web3.js";
import { openData, QVAULT_SIZE, OP_SPEND, KIND_SPEND } from "./wots";
import { uploadData } from "./draw";

export interface OpenTerms { program: PublicKey; payer: PublicKey; root: Uint8Array; rentLamports: number; depositLamports: bigint }
/** One transaction: make the vault's account, give it its first key, then put the deposit in. */
export function openVaultInstructions(t: OpenTerms, vault: Keypair = Keypair.generate()): { vault: Keypair; instructions: TransactionInstruction[] } {
  const instructions = [
    SystemProgram.createAccount({ fromPubkey: t.payer, newAccountPubkey: vault.publicKey, lamports: t.rentLamports, space: QVAULT_SIZE, programId: t.program }),
    new TransactionInstruction({ programId: t.program, data: Buffer.from(openData(t.root)), keys: [{ pubkey: vault.publicKey, isSigner: false, isWritable: true }] }),
  ];
  if (t.depositLamports > 0n) instructions.push(SystemProgram.transfer({ fromPubkey: t.payer, toPubkey: vault.publicKey, lamports: t.depositLamports }));
  return { vault, instructions };
}
/**
 * A spend. `record` is the signed record from makeSpend. Nobody signs this but whoever pays the
 * network fee, and they get no say: the record's one-time signature fixes the recipient and amount.
 * Checking the signature takes a few thousand hashes, so the transaction asks for more compute.
 */
export function spendInstructions(program: PublicKey, vault: PublicKey, recipient: PublicKey, record: Uint8Array, data?: Uint8Array): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    new TransactionInstruction({ programId: program, data: Buffer.from(data ?? uploadData(OP_SPEND, record, { kind: KIND_SPEND })), keys: [
      { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: recipient, isSigner: false, isWritable: true }] }),
  ];
}
