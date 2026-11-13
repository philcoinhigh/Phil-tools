// Runs the same wallet-free call the website makes, from the command line, so the nightly run
// proves the page's button works against a real node. Also reports whether the node lets a
// browser on another site call it (CORS).
// Usage: node simulate.js <rpc url> <payer address> <program id>
import { callProgram } from "../site/src/solana-call";

(async () => {
  const [url, payer, program] = process.argv.slice(2);
  const r = await callProgram(url, payer, program);
  let cors: string | null = null;
  try {
    const h = await fetch(url, { method: "POST", headers: { "content-type": "application/json", origin: "https://philcoinhigh.github.io" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }) });
    cors = h.headers.get("access-control-allow-origin");
  } catch { /* recorded as null */ }
  console.log(JSON.stringify({ ...r, cors }, null, 1));
  if (!r.ok) process.exit(1);
})();
