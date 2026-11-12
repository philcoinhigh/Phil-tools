// Runs Phil's compiler on one input at a time. Lives in a worker so the parent can stop it if it hangs.
import { parentPort, workerData } from "worker_threads";
import * as fs from "fs";
import { runPhilc } from "../playground/src/philc";

(async () => {
  const module = await WebAssembly.compile(fs.readFileSync(workerData.wasm));
  parentPort!.postMessage({ ready: true });
  parentPort!.on("message", async (m: { id: number; bytes: Uint8Array; target: string }) => {
    const r = await runPhilc(module, m.bytes, m.target);
    parentPort!.postMessage({ id: m.id, exit: r.exit, stdout: r.stdout, stderr: r.stderr, ms: r.ms });
  });
})();
