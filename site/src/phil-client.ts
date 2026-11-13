// Runs Phil's emitted upload client. The client is `UploadClient` from the same module the
// Solana programs are built from, compiled to WebAssembly (giveaway/build-client.sh). It decides
// what to do and in what order; like the server, it calls a runtime for every step. This file
// is that runtime for a browser: sends are appended to a buffer in Phil's control codec v1
// format, and receives are answered with what the server said.
import { helloFrame, beginFrame, sha256, concat, hex } from "./draw";

export const KIND_NOTE = "phil-note/1";
export const OP_NOTE = 4;
export interface Session { payload: Uint8Array; kind?: string; versions?: number[]; cancel?: boolean }
/** What the server answered at each point the client waits. Undefined: the server never got that far. */
export interface Answers { version?: number | null; policy?: "proceed" | number; final?: "accepted" | "rejected" }
export type Ending = "accepted" | "rejected" | "cancelled" | "refused by policy" | "no common version" | "version check failed" | "no answer";
export interface ClientStep { text: string; phase: number; sends?: boolean }
export interface ClientRun { wire: Uint8Array; steps: ClientStep[]; ending: Ending; returned: number | null }

/** The answers a client hopes for. Its messages must all be sent before any real answer exists. */
export const hopeful = (s: Session): Answers => ({ version: Math.max(...(s.versions ?? [1])), policy: "proceed", final: "accepted" });

const TRANSPORT = 101, PAYLOAD = 102, VERSIONS = 103, DIGEST = 104, KIND = 105, UPLOAD_ID = 106;
class NoAnswer extends Error {}

export async function runClient(module: WebAssembly.Module, session: Session, answers: Answers): Promise<ClientRun> {
  const versions = session.versions ?? [1], kind = session.kind ?? KIND_NOTE;
  const sent: Uint8Array[] = [];
  const steps: ClientStep[] = [];
  let phase = 0, ending: Ending | null = null, memory!: WebAssembly.Memory;
  const say = (text: string, sends = false) => steps.push({ text, phase, sends });
  const must = (ok: boolean, what: string) => { if (!ok) throw new Error(`Phil's client broke its interface: ${what}`); };
  const view = () => new DataView(memory.buffer);
  const wait = <T>(what: string, answer: T | undefined): T => { if (answer === undefined) { say(`waits for ${what}; the server never answered`); ending = "no answer"; throw new NoAnswer(); } return answer; };
  const env: Record<string, Function> = {
    phil_runtime_supported_versions: () => VERSIONS,
    phil_runtime_send_hello: (t: number, v: number) => { must(t === TRANSPORT && v === VERSIONS, "send_hello"); sent.push(helloFrame(versions)); say(`sends Hello, offering version${versions.length > 1 ? "s" : ""} ${versions.join(", ")}`, true); },
    phil_runtime_receive_version_choice: (t: number, out: number) => {
      must(t === TRANSPORT, "receive_version_choice");
      const v = wait("the version choice", answers.version); phase = 1;
      if (v === null) { say("is told: no version in common"); ending = "no common version"; return 0; }
      view().setUint16(out, v, true); say(`is told: version ${v}`); return 1;
    },
    phil_runtime_refine_selected_version_with_set: (t: number, v: number, selected: number) => { must(t === TRANSPORT && v === VERSIONS, "refine_selected_version"); const ok = versions.includes(selected); say(ok ? "checks the chosen version is one it offered" : "finds the chosen version is not one it offered, and stops"); if (!ok) ending = "version check failed"; return ok ? 1 : 0; },
    phil_runtime_sha256: (p: number) => { must(p === PAYLOAD, "sha256"); say(`computes the SHA-256 of its ${session.payload.length} bytes: ${hex(sha256(session.payload)).slice(0, 16)}…`); return DIGEST; },
    phil_runtime_payload_length: (p: number) => { must(p === PAYLOAD, "payload_length"); return BigInt(session.payload.length); },
    phil_runtime_payload_kind: (p: number) => { must(p === PAYLOAD, "payload_kind"); return KIND; },
    phil_runtime_send_begin_sha256: (t: number, length: bigint, k: number, d: number) => { must(t === TRANSPORT && k === KIND && d === DIGEST && length === BigInt(session.payload.length), "send_begin"); sent.push(beginFrame(session.payload.length, kind, sha256(session.payload))); say(`sends Begin: ${session.payload.length} bytes of kind ${kind}, with that digest`, true); },
    phil_runtime_receive_begin_policy_choice: (t: number, out: number) => {
      must(t === TRANSPORT, "receive_begin_policy_choice");
      const p = wait("the policy answer", answers.policy); phase = 2;
      if (p === "proceed") { say("is told: proceed"); return 1; }
      view().setUint8(out, p); say(`is told: refused by policy (reason ${p})`); ending = "refused by policy"; return 0;
    },
    phil_call_should_cancel_upload: () => {},
    phil_branch_condition: () => { say(session.cancel ? "decides to cancel" : "decides to go ahead"); return session.cancel ? 1 : 0; },
    phil_runtime_select_payload_cancel: (t: number, choice: number) => { must(t === TRANSPORT && (choice === 0 || choice === 1), "select_payload_cancel"); sent.push(Uint8Array.of(choice)); if (choice === 0) ending = "cancelled"; say(choice === 1 ? "tells the server: payload follows" : "tells the server: cancelled", true); },
    phil_runtime_send_exact: (t: number, p: number) => { must(t === TRANSPORT && p === PAYLOAD, "send_exact"); sent.push(session.payload); say(`sends exactly ${session.payload.length} bytes`, true); },
    phil_runtime_receive_final_response: (t: number, out: number) => {
      must(t === TRANSPORT, "receive_final_response");
      const f = wait("the final answer", answers.final); phase = 3;
      if (f === "accepted") { view().setUint32(out, UPLOAD_ID, true); say("is told: accepted"); return 1; }
      say("is told: rejected"); ending = "rejected"; return 0;
    },
    phil_runtime_record_upload_id: (id: number) => { must(id === UPLOAD_ID, "record_upload_id"); ending = "accepted"; say("records the upload as accepted"); },
    phil_cleanup: () => { say("releases its payload"); },
  };
  const instance = await WebAssembly.instantiate(module, { env } as any);
  memory = instance.exports.memory as WebAssembly.Memory;
  let returned: number | null = null;
  try { returned = (instance.exports.UploadClient as Function)(TRANSPORT, PAYLOAD); } catch (e) { if (!(e instanceof NoAnswer)) throw e; }
  return { wire: concat(...sent), steps, ending: ending ?? "no answer", returned };
}

/** What the server's log says it answered, in the client's terms. */
export function answersFrom(logs: string[], programError?: number): Answers {
  const all = logs.join("\n");
  const a: Answers = {};
  if (/Phil: version agreed/.test(all)) a.version = 1; else if (/no protocol version in common/.test(all)) a.version = null;
  if (/policy passed, proceed/.test(all)) a.policy = "proceed"; else if (/REJECTED by policy/.test(all)) a.policy = programError !== undefined && programError >= 1400 && programError < 1500 ? programError - 1400 : 1;
  if (/Phil: ACCEPTED/.test(all)) a.final = "accepted"; else if (/do not match the declared digest/.test(all)) a.final = "rejected";
  return a;
}
/** Server log lines in order, each with the point in the conversation it belongs to. */
export function serverSteps(logs: string[]): ClientStep[] {
  return logs.map((l) => /(?:Program log: |^LOG )(Phil[^]*)/.exec(l)?.[1] ?? "").filter(Boolean).map((text) => ({
    text: text.replace(/^Phil(?: note| draw| runtime)?: /, ""), phase: /UploadServer started|Hello|version/.test(text) ? 0.5 : /Begin|policy/.test(text) ? 1.5 : 2.5 }));
}
/** The two sides merged into the order things happen in. */
export function timeline(client: ClientStep[], server: ClientStep[]): { side: "client" | "server"; text: string; sends?: boolean }[] {
  return [...client.map((s, i) => ({ side: "client" as const, ...s, order: i })), ...server.map((s, i) => ({ side: "server" as const, ...s, order: 1000 + i }))]
    .sort((a, b) => a.phase - b.phase || a.order - b.order).map(({ side, text, sends }) => ({ side, text, sends }));
}
