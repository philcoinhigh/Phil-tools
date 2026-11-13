// Asks a Solana node to run a program right now, without a wallet and without sending anything.
// It builds the smallest possible transaction by hand (one instruction, no accounts, no data) and
// hands it to the node's `simulateTransaction`, which executes it against the current chain state
// and returns the log. Nothing is signed or recorded, so it is free. No dependencies.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    let carry = ALPHABET.indexOf(ch);
    if (carry < 0) throw new Error(`not base58: ${ch}`);
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 255; carry >>= 8; }
    while (carry) { bytes.push(carry & 255); carry >>= 8; }
  }
  for (const ch of text) { if (ch !== "1") break; bytes.push(0); }
  return Uint8Array.from(bytes.reverse());
}

export function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = "";
  for (const b of bytes) { if (b !== 0) break; out += "1"; }
  return out + digits.reverse().map((d) => ALPHABET[d]).join("");
}

export interface AccountRef { key: string; writable?: boolean }
const shortLength = (n: number) => (n < 128 ? [n] : [(n & 127) | 128, n >> 7]);

/**
 * An unsigned transaction with one instruction: `payer` pays, and `program` is called with the
 * given accounts and data. Accounts are ordered the way Solana's own library orders them.
 */
export function buildCall(payer: string, program: string, accounts: AccountRef[], data: Uint8Array): Uint8Array {
  const order = (a: string, b: string) => a.localeCompare(b, "en", { localeMatcher: "best fit", usage: "sort", sensitivity: "variant", ignorePunctuation: false, numeric: false, caseFirst: "lower" });
  const writable = [...new Set(accounts.filter((a) => a.writable && a.key !== payer).map((a) => a.key))].sort(order);
  const readonly = [...new Set([...accounts.filter((a) => !a.writable).map((a) => a.key), program])].filter((k) => k !== payer && !writable.includes(k)).sort(order);
  const keys = [payer, ...writable, ...readonly];
  const out: number[] = [1, ...new Array(64).fill(0)];          // one signature slot, left empty
  out.push(1, 0, readonly.length, ...shortLength(keys.length));  // one signer; how many are read-only and unsigned
  for (const k of keys) { const b = base58Decode(k); if (b.length !== 32) throw new Error("an address must be 32 bytes"); out.push(...b); }
  out.push(...new Array(32).fill(0));                            // recent blockhash: the node fills it in
  out.push(1, keys.indexOf(program), ...shortLength(accounts.length), ...accounts.map((a) => keys.indexOf(a.key)), ...shortLength(data.length), ...data);
  return Uint8Array.from(out);
}
/** The smallest call: no accounts and no data. */
export const callTransaction = (payer: string, program: string) => buildCall(payer, program, [], new Uint8Array(0));

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export interface CallResult { ok: boolean; returned: number | null; units: number | null; slot: number | null; logs: string[]; ms: number; error?: string }

/** What a Phil `main` returned, read from the log our entry point writes. */
export function returnedFrom(logs: string[]): number | null {
  const at = logs.findIndex((l) => l.includes("Phil main returned"));
  const m = at < 0 ? null : /Program log: 0x0, 0x0, 0x0, 0x0, (0x[0-9a-f]+)/.exec(logs[at + 1] ?? "");
  return m ? parseInt(m[1], 16) : null;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export interface Simulation { ok: boolean; logs: string[]; units: number | null; slot: number | null; ms: number; error?: string; programError?: number }
const NETWORK = "Could not reach Solana devnet from this browser. Check the connection and try again.";

/** Asks the node to run an unsigned transaction now and report what happened. Nothing is recorded. */
export async function simulate(rpc: string, transaction: Uint8Array, fetcher: Fetch = (u, i) => fetch(u, i)): Promise<Simulation> {
  const started = Date.now();
  const fail = (error: string): Simulation => ({ ok: false, logs: [], units: null, slot: null, ms: Date.now() - started, error });
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "simulateTransaction", params: [toBase64(transaction), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }] });
    const res = await fetcher(rpc, { method: "POST", headers: { "content-type": "application/json" }, body });
    if (!res.ok) return fail(res.status === 429 ? "The Solana node is rate-limiting requests. Wait a few seconds and try again." : `The Solana node answered ${res.status}.`);
    const j = await res.json();
    if (j.error) return fail(String(j.error.message ?? "The Solana node refused the request."));
    const v = j.result?.value ?? {};
    const custom = v.err?.InstructionError?.[1]?.Custom;
    return { ok: !v.err, logs: v.logs ?? [], units: v.unitsConsumed ?? null, slot: j.result?.context?.slot ?? null, ms: Date.now() - started,
      error: v.err ? JSON.stringify(v.err) : undefined, programError: typeof custom === "number" ? custom : undefined };
  } catch { return fail(NETWORK); }
}

/** An account's bytes, or null when it does not exist. Throws when the node cannot be reached. */
export async function accountData(rpc: string, key: string, fetcher: Fetch = (u, i) => fetch(u, i)): Promise<{ data: Uint8Array; owner: string; slot: number; lamports: number } | null> {
  const res = await fetcher(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [key, { encoding: "base64", commitment: "confirmed" }] }) });
  if (!res.ok) throw new Error(res.status === 429 ? "The Solana node is rate-limiting requests. Wait a few seconds and try again." : `The Solana node answered ${res.status}.`);
  const j = await res.json();
  if (j.error) throw new Error(String(j.error.message));
  const v = j.result?.value;
  if (!v) return null;
  const bin = atob(v.data[0]);
  return { data: Uint8Array.from(bin, (c) => c.charCodeAt(0)), owner: v.owner, slot: j.result.context.slot, lamports: v.lamports ?? 0 };
}

export async function callProgram(rpc: string, payer: string, program: string, fetcher: Fetch = (u, i) => fetch(u, i)): Promise<CallResult> {
  const started = Date.now();
  const fail = (error: string): CallResult => ({ ok: false, returned: null, units: null, slot: null, logs: [], ms: Date.now() - started, error });
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "simulateTransaction",
      params: [toBase64(callTransaction(payer, program)), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }] });
    const res = await fetcher(rpc, { method: "POST", headers: { "content-type": "application/json" }, body });
    if (!res.ok) return fail(res.status === 429 ? "The Solana node is rate-limiting requests. Wait a few seconds and try again." : `The Solana node answered ${res.status}.`);
    const j = await res.json();
    if (j.error) return fail(String(j.error.message ?? "The Solana node refused the request."));
    const v = j.result?.value ?? {};
    const logs: string[] = v.logs ?? [];
    const returned = returnedFrom(logs);
    const base = { returned, units: v.unitsConsumed ?? null, slot: j.result?.context?.slot ?? null, logs, ms: Date.now() - started };
    if (v.err) return { ok: false, ...base, error: /ProgramAccountNotFound|AccountNotFound/.test(JSON.stringify(v.err)) ? "The program is not on devnet right now. Devnet may have been reset; it is redeployed by the nightly run." : `The program did not run: ${JSON.stringify(v.err)}` };
    if (returned === null) return { ok: false, ...base, error: "The program ran but its log was not the one expected." };
    return { ok: true, ...base };
  } catch (e) {
    return fail("Could not reach Solana devnet from this browser. Check the connection and try again.");
  }
}

/** A coin's current total supply, in its smallest units. */
export async function tokenSupply(rpc: string, mint: string, fetcher: Fetch = (u, i) => fetch(u, i)): Promise<{ amount: bigint; decimals: number }> {
  const res = await fetcher(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [mint, { commitment: "confirmed" }] }) });
  if (!res.ok) throw new Error(`The Solana node answered ${res.status}.`);
  const j = await res.json();
  if (j.error) throw new Error(String(j.error.message));
  return { amount: BigInt(j.result.value.amount), decimals: j.result.value.decimals };
}
