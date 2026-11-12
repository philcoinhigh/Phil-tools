// One compiler worker with a per-input time limit. A hang kills the worker and starts a fresh one.
import { Worker } from "worker_threads";
import * as path from "path";

export interface Outcome { exit: number; stdout: string; stderr: string; ms: number; hung: boolean }
export class Compiler {
  private worker?: Worker;
  private seq = 0;
  constructor(private wasm: string, private limitMs: number, private workerFile = path.join(__dirname, "fuzz-worker.js")) {}
  private start(): Promise<Worker> {
    return new Promise((resolve, reject) => {
      const w = new Worker(this.workerFile, { workerData: { wasm: this.wasm }, resourceLimits: { maxOldGenerationSizeMb: 2048 } });
      w.once("message", () => resolve(w));
      w.once("error", reject);
    });
  }
  async run(bytes: Uint8Array, target: string): Promise<Outcome> {
    const w = (this.worker ??= await this.start());
    const id = ++this.seq;
    return new Promise<Outcome>((resolve) => {
      const done = (o: Outcome) => { clearTimeout(timer); w.off("message", onMsg); w.off("error", onErr); w.off("exit", onExit); resolve(o); };
      const kill = (o: Outcome) => { this.worker = undefined; void w.terminate(); done(o); };
      const timer = setTimeout(() => kill({ exit: -2, stdout: "", stderr: "", ms: this.limitMs, hung: true }), this.limitMs);
      const onMsg = (m: { id: number; exit: number; stdout: string; stderr: string; ms: number }) => { if (m.id === id) done({ ...m, hung: false }); };
      const onErr = (e: Error) => kill({ exit: -3, stdout: "", stderr: "worker failed: " + String(e.message ?? e), ms: 0, hung: false });
      const onExit = () => { this.worker = undefined; done({ exit: -3, stdout: "", stderr: "worker exited", ms: 0, hung: false }); };
      w.on("message", onMsg); w.once("error", onErr); w.once("exit", onExit);
      w.postMessage({ id, bytes, target });
    });
  }
  async close(): Promise<void> { await this.worker?.terminate(); this.worker = undefined; }
}
