// Builds the quantum-safe vault's transactions. The website and the workflow script both use
// exactly this, so what is proven on a validator is what a visitor sends.
import { Buffer } from "buffer";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, Keypair } from "@solana/web3.js";
import { openData, finishData, cancelData, QVAULT_SIZE, OP_SPEND, KIND_SPEND } from "./wots";
import { uploadData } from "./draw";

export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const meta = (pubkey: PublicKey, isWritable: boolean, isSigner = false) => ({ pubkey, isSigner, isWritable });

/** The address that is the authority of a vault's token accounts. Only the vault program can sign for it. */
export function tokenAuthority(program: PublicKey, vault: PublicKey): { address: PublicKey; bump: number } {
  const [address, bump] = PublicKey.findProgramAddressSync([Buffer.from("qv"), vault.toBuffer()], program);
  return { address, bump };
}
/** The usual token account of an owner for a coin. */
export const tokenAccountOf = (owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey) => PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
/** Where a vault holds a coin. */
export const vaultTokenAccount = (program: PublicKey, vault: PublicKey, mint: PublicKey, tokenProgram: PublicKey) => tokenAccountOf(tokenAuthority(program, vault).address, mint, tokenProgram);
/** Makes an owner's token account for a coin if it is not there yet. Anyone can pay for it. */
export const createTokenAccount = (payer: PublicKey, owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey) => new TransactionInstruction({ programId: ATA_PROGRAM, data: Buffer.from([1]), keys: [
  meta(payer, true, true), meta(tokenAccountOf(owner, mint, tokenProgram), true), meta(owner, false), meta(mint, false), meta(SystemProgram.programId, false), meta(tokenProgram, false)] });
/** An ordinary token transfer signed by a wallet: how coins get into a vault. */
export function transferChecked(from: PublicKey, mint: PublicKey, to: PublicKey, owner: PublicKey, amount: bigint, decimals: number, tokenProgram: PublicKey): TransactionInstruction {
  const data = Buffer.alloc(10); data[0] = 12; data.writeBigUInt64LE(amount, 1); data[9] = decimals;
  return new TransactionInstruction({ programId: tokenProgram, data, keys: [meta(from, true), meta(mint, false), meta(to, true), meta(owner, false, true)] });
}
/** Puts a coin into a vault from a wallet: the vault's token account is made if needed, then the transfer. */
export function depositTokenInstructions(program: PublicKey, vault: PublicKey, payer: PublicKey, mint: PublicKey, tokenProgram: PublicKey, amount: bigint, decimals: number): TransactionInstruction[] {
  const authority = tokenAuthority(program, vault).address;
  return [createTokenAccount(payer, authority, mint, tokenProgram), transferChecked(tokenAccountOf(payer, mint, tokenProgram), mint, tokenAccountOf(authority, mint, tokenProgram), payer, amount, decimals, tokenProgram)];
}

export interface OpenTerms { program: PublicKey; payer: PublicKey; root: Uint8Array; rentLamports: number; depositLamports: bigint; delaySeconds?: number; guardRoot?: Uint8Array }
/** One transaction: make the vault's account, give it its first key (and its waiting time and guard key, if any), then put the deposit in. */
export function openVaultInstructions(t: OpenTerms, vault: Keypair = Keypair.generate()): { vault: Keypair; instructions: TransactionInstruction[] } {
  const terms = { bump: tokenAuthority(t.program, vault.publicKey).bump, delay: BigInt(t.delaySeconds ?? 0), guardRoot: t.guardRoot };
  const instructions = [
    SystemProgram.createAccount({ fromPubkey: t.payer, newAccountPubkey: vault.publicKey, lamports: t.rentLamports, space: QVAULT_SIZE, programId: t.program }),
    new TransactionInstruction({ programId: t.program, data: Buffer.from(openData(t.root, terms)), keys: [meta(vault.publicKey, true)] }),
  ];
  if (t.depositLamports > 0n) instructions.push(SystemProgram.transfer({ fromPubkey: t.payer, toPubkey: vault.publicKey, lamports: t.depositLamports }));
  return { vault, instructions };
}
/** The four accounts a token payment adds after the vault and the recipient's token account. */
const tokenKeys = (program: PublicKey, vault: PublicKey, mint: PublicKey, tokenProgram: PublicKey) => [
  meta(vaultTokenAccount(program, vault, mint, tokenProgram), true), meta(mint, false), meta(tokenAuthority(program, vault).address, false), meta(tokenProgram, false)];
export interface TokenSide { mint: PublicKey; tokenProgram: PublicKey }
/**
 * A spend. `record` is the signed record from makeSpend. Nobody signs this but whoever pays the
 * network fee, and they get no say: the record's one-time signature fixes the recipient, the coin
 * and the amount. For a token, `recipient` is the token account that receives it. In a vault with a
 * waiting time (`delayed`) the spend is only recorded, and finishInstructions completes it later.
 * Checking the signature takes a few thousand hashes, so the transaction asks for more compute.
 */
export function spendInstructions(program: PublicKey, vault: PublicKey, recipient: PublicKey, record: Uint8Array, data?: Uint8Array, token?: TokenSide, delayed = false): TransactionInstruction[] {
  const keys = [meta(vault, true), meta(recipient, !delayed)];
  if (token) keys.push(...(delayed ? [meta(token.mint, false)] : tokenKeys(program, vault, token.mint, token.tokenProgram)));
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    new TransactionInstruction({ programId: program, data: Buffer.from(data ?? uploadData(OP_SPEND, record, { kind: KIND_SPEND })), keys }),
  ];
}
/** Completes a recorded payment once its waiting time has passed. It needs no signature and can only pay what was signed. */
export function finishInstructions(program: PublicKey, vault: PublicKey, recipient: PublicKey, token?: TokenSide, data?: Uint8Array): TransactionInstruction[] {
  return [new TransactionInstruction({ programId: program, data: Buffer.from(data ?? finishData()), keys: [meta(vault, true), meta(recipient, true), ...(token ? tokenKeys(program, vault, token.mint, token.tokenProgram) : [])] })];
}
/** A cancel signed by the guard key (the record from makeCancel): nothing is left waiting and the vault gets a new key. */
export function cancelInstructions(program: PublicKey, vault: PublicKey, record: Uint8Array, data?: Uint8Array): TransactionInstruction[] {
  return [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), new TransactionInstruction({ programId: program, data: Buffer.from(data ?? cancelData(record)), keys: [meta(vault, true)] })];
}

/** Where Solana keeps a program's code and the one key allowed to replace it. */
export const programDataAddress = (program: PublicKey) => PublicKey.findProgramAddressSync([program.toBuffer()], LOADER)[0];
/** Reads that account: who may still replace the program, or null if nobody can. Undefined if it is not a program's data. */
export function upgradeAuthority(programData: Uint8Array): PublicKey | null | undefined {
  if (programData.length < 45 || programData[0] !== 3) return undefined;
  return programData[12] === 0 ? null : new PublicKey(programData.slice(13, 45));
}
