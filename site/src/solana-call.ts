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

/** An unsigned transaction: `payer` pays, and `program` is called with no accounts and no data. */
export function callTransaction(payer: string, program: string): Uint8Array {
  const a = base58Decode(payer), b = base58Decode(program);
  if (a.length !== 32 || b.length !== 32) throw new Error("an address must be 32 bytes");
  const out = new Uint8Array(1 + 64 + 3 + 1 + 64 + 32 + 4);
  let o = 0;
  out[o++] = 1; o += 64;                       // one signature slot, left empty
  out[o++] = 1; out[o++] = 0; out[o++] = 1;    // one signer; the program is read-only and unsigned
  out[o++] = 2; out.set(a, o); o += 32; out.set(b, o); o += 32;
  o += 32;                                     // recent blockhash: the node fills it in
  out[o++] = 1; out[o++] = 1; out[o++] = 0; out[o++] = 0;   // one instruction: program #1, no accounts, no data
  return out;
}

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
