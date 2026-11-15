// Talking to Solana from a page: reading with no wallet, and signing with one.
// The wallet only ever signs. The page sends the transaction itself, through the node it reads from.
import { PublicKey, Transaction, Keypair } from "@solana/web3.js";
import { esc } from "./shared";
import { readVerdict } from "./draw";

export interface Chain { name: string; rpc(method: string, params: unknown[]): Promise<any>; explorer(kind: string, id: string): string }
export function chain(name = "devnet", url = "https://api.devnet.solana.com"): Chain {
  const cluster = name === "mainnet" ? "" : `?cluster=${name}`;
  return {
    name,
    explorer: (kind, id) => `https://explorer.solana.com/${kind}/${id}${cluster}`,
    async rpc(method, params) {
      let res;
      try { res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); }
      catch { throw new Error(`Could not reach Solana ${name} from this browser. Check the connection and try again.`); }
      if (!res.ok) throw new Error(res.status === 429 ? "The Solana node is busy. Wait a few seconds and try again." : `The Solana node answered ${res.status}.`);
      const j = await res.json();
      if (j.error) { const e: any = new Error(String(j.error.message ?? "The Solana node refused the request.")); e.logs = j.error.data?.logs; throw e; }
      return j.result;
    },
  };
}

export const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
export const when = (t: number) => new Date(t * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
export function key(text: string, what: string): PublicKey { try { return new PublicKey(text); } catch { throw new Error(`That is not a valid ${what}.`); } }

const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
export interface Coin { mint: PublicKey; tokenProgram: PublicKey; decimals: number; supply: bigint }
export async function coinInfo(c: Chain, text: string): Promise<Coin> {
  const mint = key(text, "coin address");
  const info = (await c.rpc("getAccountInfo", [mint.toBase58(), { encoding: "base64", commitment: "confirmed" }])).value;
  if (!info) throw new Error(`No coin with that address exists on ${c.name}.`);
  const d = bytesOf(info.data[0]);
  if (d.length < 82 || !TOKEN_PROGRAMS.includes(info.owner)) throw new Error("That address is not a coin (it is not a token mint).");
  return { mint, tokenProgram: new PublicKey(info.owner), decimals: d[44], supply: new DataView(d.buffer).getBigUint64(36, true) };
}
/** "1,500,000.5" in a coin's smallest units. */
export function units(text: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text.replace(/[,\s_]/g, ""));
  if (!m) throw new Error("Enter the amount as a number, such as 1000000 or 2500.5.");
  if ((m[2]?.length ?? 0) > decimals) throw new Error(`This coin has ${decimals} decimal places.`);
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((m[2] ?? "").padEnd(decimals, "0") || "0");
}

export interface Provider { publicKey?: PublicKey | null; connect(): Promise<{ publicKey: PublicKey }>; signTransaction(tx: Transaction): Promise<Transaction> }
export const provider = (): Provider | null => { const w = window as any; return w.phantom?.solana ?? w.solflare ?? w.backpack ?? w.solana ?? null; };
export async function connectWallet(): Promise<PublicKey> {
  const p = provider();
  if (!p) throw new Error("No wallet found in this browser.");
  const r = await p.connect();
  return new PublicKey((r?.publicKey ?? p.publicKey)!.toString());
}
/** What to tell someone whose wallet did not connect. On a phone, wallets work inside their own browser. */
export function noWalletHtml(c: Chain, e: any): string {
  if (provider()) return esc(String(e?.message ?? "The wallet did not connect."));
  const here = encodeURIComponent(location.href);
  return `No wallet was found in this browser. On a phone, open this page inside your wallet's own browser: <a href="https://phantom.app/ul/browse/${here}?ref=${encodeURIComponent(location.origin)}">open in Phantom</a>. Then set the wallet to ${esc(c.name)}.`;
}
/** Sign with the wallet, send through our own node, and wait until Solana confirms. */
export async function signAndSend(c: Chain, wallet: PublicKey, tx: Transaction, extra: Keypair[], say: (s: string) => void): Promise<string> {
  tx.feePayer = wallet; tx.recentBlockhash = (await c.rpc("getLatestBlockhash", [{ commitment: "confirmed" }])).value.blockhash;
  if (extra.length) tx.partialSign(...extra);
  say("Waiting for your wallet…");
  const signed = await provider()!.signTransaction(tx);
  say("Sending to Solana…");
  const raw = signed.serialize();
  let s = ""; for (const b of raw) s += String.fromCharCode(b);
  const signature: string = await c.rpc("sendTransaction", [btoa(s), { encoding: "base64", preflightCommitment: "confirmed" }]);
  for (let i = 0; i < 40; i++) {
    const st = (await c.rpc("getSignatureStatuses", [[signature]])).value?.[0];
    if (st?.err) throw new Error("Solana rejected the transaction.");
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return signature;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Solana has not confirmed it yet. Read the page again in a minute before trying a second time.");
}
/** Why a transaction did not go through, in words. */
export function explain(e: any): string {
  const v = e?.logs ? readVerdict(e.logs) : null;
  if (v && v.steps.length) return `${v.why} Nothing was moved.`;
  if (/reject|denied|cancel/i.test(String(e?.message))) return "You declined it in the wallet. Nothing was sent.";
  if (/insufficient (funds|lamports)|Attempt to debit/i.test(String(e?.message) + (e?.logs ?? []).join(" "))) return "The wallet does not hold enough SOL for the fee and the account rent. Nothing was moved.";
  return String(e?.message ?? e);
}
