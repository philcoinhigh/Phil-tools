// Builds Clip Bounties' transactions. The website and the workflow script both use exactly this.
import { Buffer } from "buffer";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { postData, enterData, BOUNTY_SIZE, ENTRY_SIZE, OP_AWARD, OP_ARM, OP_DRAW, OP_CLAIM, OP_REFUND } from "./bounty";
import { createTokenAccount, transferChecked, tokenAccountOf } from "./qvault-tx";

export const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");
const meta = (pubkey: PublicKey, isWritable: boolean, isSigner = false) => ({ pubkey, isSigner, isWritable });
export interface Coin { mint: PublicKey; tokenProgram: PublicKey; decimals: number }

/** The address that is the authority of a bounty's token account. Only the bounty program can sign for it. */
export function tokenAuthority(program: PublicKey, bounty: PublicKey): { address: PublicKey; bump: number } {
  const [address, bump] = PublicKey.findProgramAddressSync([Buffer.from("cb"), bounty.toBuffer()], program);
  return { address, bump };
}
/** Where a bounty holds a token prize. */
export const prizeAccount = (program: PublicKey, bounty: PublicKey, c: Coin) => tokenAccountOf(tokenAuthority(program, bounty).address, c.mint, c.tokenProgram);
/** The four accounts a token payment adds. */
const tokenKeys = (program: PublicKey, bounty: PublicKey, c: Coin) => [meta(prizeAccount(program, bounty, c), true), meta(c.mint, false), meta(tokenAuthority(program, bounty).address, false), meta(c.tokenProgram, false)];
/** Where a wallet receives the bounty's coin: itself for SOL, its token account for a token. */
export const receiving = (wallet: PublicKey, c?: Coin) => (c ? tokenAccountOf(wallet, c.mint, c.tokenProgram) : wallet);

export interface PostTerms { program: PublicKey; sponsor: PublicKey; text: string; deadline: number; graceSeconds: number; prize: bigint; rentLamports: number; coin?: Coin }
/** One transaction: make the bounty's account, put the prize in, and post the challenge. Posting is refused unless the prize is there. */
export function postInstructions(t: PostTerms, bounty: Keypair = Keypair.generate()): { bounty: Keypair; instructions: TransactionInstruction[] } {
  const { address: authority, bump } = tokenAuthority(t.program, bounty.publicKey);
  const instructions = [SystemProgram.createAccount({ fromPubkey: t.sponsor, newAccountPubkey: bounty.publicKey, lamports: Number(BigInt(t.rentLamports) + (t.coin ? 0n : t.prize)), space: BOUNTY_SIZE, programId: t.program })];
  const keys = [meta(bounty.publicKey, true), meta(t.sponsor, false, true)];
  if (t.coin) {
    instructions.push(createTokenAccount(t.sponsor, authority, t.coin.mint, t.coin.tokenProgram),
      transferChecked(tokenAccountOf(t.sponsor, t.coin.mint, t.coin.tokenProgram), t.coin.mint, tokenAccountOf(authority, t.coin.mint, t.coin.tokenProgram), t.sponsor, t.prize, t.coin.decimals, t.coin.tokenProgram));
    keys.push(meta(tokenAccountOf(authority, t.coin.mint, t.coin.tokenProgram), false), meta(t.coin.mint, false));
  }
  instructions.push(new TransactionInstruction({ programId: t.program, data: Buffer.from(postData({ bump, deadline: t.deadline, graceSeconds: t.graceSeconds, prize: t.prize, text: t.text })), keys }));
  return { bounty, instructions };
}
/** Enter with a link. The entrant pays the small rent of their own entry. */
export function enterInstructions(program: PublicKey, bounty: PublicKey, entrant: PublicKey, link: string, rentLamports: number, entry: Keypair = Keypair.generate()): { entry: Keypair; instructions: TransactionInstruction[] } {
  return { entry, instructions: [
    SystemProgram.createAccount({ fromPubkey: entrant, newAccountPubkey: entry.publicKey, lamports: rentLamports, space: ENTRY_SIZE, programId: program }),
    new TransactionInstruction({ programId: program, data: Buffer.from(enterData(link)), keys: [meta(bounty, true), meta(entry.publicKey, true), meta(entrant, false, true)] }) ] };
}
/** The sponsor picks an entry. `winner` is the wallet that made it. For a token, the winner's token account is made first if needed. */
export function awardInstructions(program: PublicKey, bounty: PublicKey, sponsor: PublicKey, entry: PublicKey, winner: PublicKey, c?: Coin): TransactionInstruction[] {
  const ix = new TransactionInstruction({ programId: program, data: Buffer.from([OP_AWARD]), keys: [meta(bounty, true), meta(sponsor, false, true), meta(entry, false), meta(receiving(winner, c), true), ...(c ? tokenKeys(program, bounty, c) : [])] });
  return c ? [createTokenAccount(sponsor, winner, c.mint, c.tokenProgram), ix] : [ix];
}
/** Anyone, once the sponsor's time to pick has run out: names the block that will draw. */
export const armInstruction = (program: PublicKey, bounty: PublicKey) => new TransactionInstruction({ programId: program, data: Buffer.from([OP_ARM]), keys: [meta(bounty, true)] });
/** Anyone, once that block exists: its hash picks an entry number. */
export const drawInstruction = (program: PublicKey, bounty: PublicKey) => new TransactionInstruction({ programId: program, data: Buffer.from([OP_DRAW]), keys: [meta(bounty, true), meta(SLOT_HASHES, false)] });
/** Anyone: pays the prize to the entry that was drawn. `payer` covers the winner's token account if it has to be made. */
export function claimInstructions(program: PublicKey, bounty: PublicKey, entry: PublicKey, winner: PublicKey, payer: PublicKey, c?: Coin): TransactionInstruction[] {
  const ix = new TransactionInstruction({ programId: program, data: Buffer.from([OP_CLAIM]), keys: [meta(bounty, true), meta(entry, false), meta(receiving(winner, c), true), ...(c ? tokenKeys(program, bounty, c) : [])] });
  return c ? [createTokenAccount(payer, winner, c.mint, c.tokenProgram), ix] : [ix];
}
/** Only when nobody entered before the deadline: the prize goes back to the sponsor. */
export const refundInstruction = (program: PublicKey, bounty: PublicKey, sponsor: PublicKey, c?: Coin) =>
  new TransactionInstruction({ programId: program, data: Buffer.from([OP_REFUND]), keys: [meta(bounty, true), meta(receiving(sponsor, c), true), ...(c ? tokenKeys(program, bounty, c) : [])] });
