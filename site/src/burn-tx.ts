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

// ---- a launchpad's creator fees, rolled into the vault ----
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** Raydium LaunchLab, which higher.fun launches on. */
export const LAUNCHLAB = { mainnet: new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"), devnet: new PublicKey("DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6") };
/**
 * The address to name as a coin's creator so that its creator fees can only ever reach this vault.
 * Only the vault program can sign for it, and the program signs only to claim the fees into the vault.
 */
export function creatorAddress(program: PublicKey, vault: PublicKey): { address: PublicKey; bump: number } {
  const [address, bump] = PublicKey.findProgramAddressSync([Buffer.from("creator"), vault.toBuffer()], program);
  return { address, bump };
}
/** Where LaunchLab keeps a creator's unclaimed fees, and the authority over it. */
export const creatorFeeVault = (launchlab: PublicKey, creator: PublicKey) => PublicKey.findProgramAddressSync([creator.toBuffer(), WSOL_MINT.toBuffer()], launchlab)[0];
export const creatorFeeAuthority = (launchlab: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("creator_fee_vault_auth_seed")], launchlab)[0];
/** Anyone may send this: it claims the coin's creator fees and puts all of them in the vault. */
export function rollInstruction(program: PublicKey, vault: PublicKey, launchlab: PublicKey): TransactionInstruction {
  const { address: creator, bump } = creatorAddress(program, vault);
  const wsol = PublicKey.findProgramAddressSync([creator.toBuffer(), TOKEN_PROGRAM.toBuffer(), WSOL_MINT.toBuffer()], ATA_PROGRAM)[0];
  const key = (pubkey: PublicKey, isWritable: boolean) => ({ pubkey, isSigner: false, isWritable });
  return new TransactionInstruction({ programId: program, data: Buffer.from([3, bump]), keys: [
    key(vault, true), key(creator, true), key(launchlab, false), key(creatorFeeAuthority(launchlab), false), key(creatorFeeVault(launchlab, creator), true),
    key(wsol, true), key(WSOL_MINT, false), key(TOKEN_PROGRAM, false), key(SystemProgram.programId, false), key(ATA_PROGRAM, false)] });
}
