// Calls the deployed program once and prints what it wrote to the transaction log.
// Usage: node invoke.mjs <rpc url> <program id> <payer keypair.json> [--airdrop]
import fs from "fs";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";

const [url, programId, payerFile, flag] = process.argv.slice(2);
const conn = new Connection(url, "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerFile, "utf8"))));
if (flag === "--airdrop") {
  const sig = await conn.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
}
const info = await conn.getAccountInfo(new PublicKey(programId));
console.error(`program ${programId}: ${info ? `owner ${info.owner.toBase58()}, executable ${info.executable}, ${info.data.length} bytes` : "account not found"}; payer ${payer.publicKey.toBase58()} has ${await conn.getBalance(payer.publicKey)} lamports`);
const ix = new TransactionInstruction({ programId: new PublicKey(programId), keys: [], data: Buffer.alloc(0) });
let signature;
try { signature = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer], { commitment: "confirmed" }); }
catch (e) { console.error("transaction failed:", e?.message ?? e); console.error(String(e?.stack ?? "").split("\n").slice(0, 8).join("\n")); for (const l of e?.logs ?? e?.transactionLogs ?? []) console.error("  " + l); process.exit(1); }
let tx = null;
for (let i = 0; i < 20 && !tx; i++) { tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }); if (!tx) await new Promise((r) => setTimeout(r, 1500)); }
const logs = tx?.meta?.logMessages ?? [];
const value = logs.map((l) => /Program log: 0x0, 0x0, 0x0, 0x0, (0x[0-9a-f]+)/.exec(l)?.[1]).find(Boolean);
console.log(JSON.stringify({ signature, slot: tx?.slot ?? null, returned: value ? parseInt(value, 16) : null, unitsConsumed: tx?.meta?.computeUnitsConsumed ?? null, logs }, null, 1));
if (!logs.some((l) => l.includes("Phil main returned")) || value === undefined) process.exit(1);
