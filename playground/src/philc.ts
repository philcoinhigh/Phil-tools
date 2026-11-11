// Runs Phil's own compiler (philc, built to WebAssembly from the Phil repository) in the browser.
// The binary is the unmodified command-line program; this file gives it a tiny in-memory
// file system holding the editor's text and collects what it prints.
import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory } from "@bjorn3/browser_wasi_shim";

export interface PhilcResult { accepted: boolean; exit: number; stdout: string; stderr: string; ms: number }
export const PHILC_TARGETS = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"] as const;

class Exit { constructor(readonly code: number) {} }

export async function runPhilc(module: WebAssembly.Module, source: string, target: string): Promise<PhilcResult> {
  const t0 = Date.now();
  const dec = new TextDecoder();
  let stdout = "", stderr = "";
  const fds = [
    new OpenFile(new File([])),
    new ConsoleStdout((b: Uint8Array) => { stdout += dec.decode(b, { stream: true }); }),
    new ConsoleStdout((b: Uint8Array) => { stderr += dec.decode(b, { stream: true }); }),
    new PreopenDirectory("/", new Map([["main.phil", new File(new TextEncoder().encode(source))]])),
  ];
  const wasi = new WASI(["philc", "emit-llvm", "--target", target, "/main.phil"], [], fds, { debug: false });
  let exit = 0;
  try {
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
    exit = wasi.start(instance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } });
  } catch (e) {
    if (e instanceof Exit) exit = e.code;
    else if (e && typeof (e as { code?: unknown }).code === "number") exit = (e as { code: number }).code;
    else { exit = -1; stderr += (stderr ? "\n" : "") + "philc stopped unexpectedly: " + String((e as Error)?.message ?? e); }
  }
  const tidy = (s: string) => s.replace(/\/main\.phil/g, "main.phil").trimEnd();
  return { accepted: exit === 0, exit, stdout: tidy(stdout), stderr: tidy(stderr), ms: Date.now() - t0 };
}

export interface PhilcBuild { commit: string; date: string; ghc: string; bytes: number }
let cached: Promise<WebAssembly.Module> | undefined;
/** Downloads and compiles the binary once per page. */
export function loadPhilc(url: string): Promise<WebAssembly.Module> {
  cached ??= fetch(url).then(async (r) => {
    if (!r.ok) throw new Error(`could not download the compiler (${r.status})`);
    return WebAssembly.compile(await r.arrayBuffer());
  }).catch((e) => { cached = undefined; throw e; });
  return cached;
}

export interface PhilcMessage { line?: number; col?: number; text: string; expecting?: string }
/** philc prints some errors as Haskell data. Pull the position and message out so they read as a sentence. */
export function readPhilcError(stderr: string): PhilcMessage {
  const pos = /sourcePointLine = (\d+), sourcePointColumn = (\d+)/.exec(stderr);
  const quoted = /(?:parseDiagnosticMessage|surfaceErrorDetail) = "((?:[^"\\]|\\.)*)"/.exec(stderr);
  if (!quoted) return { text: stderr };
  const msg = quoted[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
  const [first, ...rest] = msg.split("\n");
  const expecting = rest.join(" ").replace(/^expecting\s*/, "").trim();
  return { line: pos ? +pos[1] : undefined, col: pos ? +pos[2] : undefined, text: first.replace(/<newline>/g, "⏎"), expecting: expecting || undefined };
}

/** A program inside the part of Phil that philc compiles today. */
export const PHILC_SAMPLE = `// philc compiles a small part of Phil so far: a component called
// main that provides Unit or a U32, built from literals and names.
// It reads Phil's earlier syntax, which has no semicolons.
component main provides U32 {
    let answer = 42
    let same = answer
    return same
}
`;
