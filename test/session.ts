// A whole Phil upload session with compiler-generated code at both ends: Phil's emitted client
// (WebAssembly, as the website runs it) talking to Phil's emitted server (the Solana program,
// run natively here).
import { execFileSync, execSync } from "child_process";
import * as fs from "fs";
import { hex, unhex, utf8, concat, uploadData, sha256 } from "../site/src/draw";
import { runClient, hopeful, answersFrom, serverSteps, timeline, Session, OP_NOTE, KIND_NOTE } from "../site/src/phil-client";

let fails = 0;
const check = (name: string, ok: boolean, info = "") => { if (!ok) { fails++; console.log("FAIL", name, info); } else console.log("ok  ", name); };
const BIN = "out/phil-draw-native";
execSync(`giveaway/native/build.sh ${BIN}`, { stdio: "inherit" });
const PROGRAM = "11".repeat(32);
function server(wire: Uint8Array) {
  const out = execFileSync(BIN, { input: ["slot 9000", `program ${PROGRAM}`, `ix ${hex(concat(Uint8Array.of(OP_NOTE), wire))}`, ""].join("\n") }).toString().split("\n");
  const ret = Number(/RET (\d+)/.exec(out.find((l) => l.startsWith("RET ")) ?? "")?.[1] ?? -1);
  return { logs: out.filter((l) => l.startsWith("LOG ")), ret };
}
/** The client runs hoping for the best, its bytes go to the server, and it is run again with the real answers. */
async function session(module: WebAssembly.Module, s: Session, inTransit: (w: Uint8Array) => Uint8Array = (w) => w) {
  const first = await runClient(module, s, hopeful(s));
  const srv = server(inTransit(first.wire));
  const second = await runClient(module, s, answersFrom(srv.logs, srv.ret));
  return { first, srv, second };
}

(async () => {
  const module = await WebAssembly.compile(fs.readFileSync("giveaway/phil_client.wasm"));
  const imports = WebAssembly.Module.imports(module).map((i) => i.name);
  check("the client module is Phil's UploadClient and asks for exactly the client half of the interface", WebAssembly.Module.exports(module).some((e) => e.name === "UploadClient") && imports.length === 16 && imports.every((n) => /^phil_/.test(n)) && !imports.some((n) => /recognize|store|digest_validate/.test(n)));
  if (process.env.PHIL_CLIENT_REBUILD !== "0") {
    try { execSync("giveaway/build-client.sh out/phil_client.check.wasm", { stdio: "pipe" }); check("the committed client is what the build produces from Phil's module", hex(fs.readFileSync("out/phil_client.check.wasm")) === hex(fs.readFileSync("giveaway/phil_client.wasm"))); }
    catch { console.log("skip rebuild check (no wasm toolchain here)"); }
  }

  const message = utf8("Phil client to Phil server, over Solana.");
  const ok = await session(module, { payload: message });
  check("Phil's client produces, byte for byte, the upload our hand-written encoder produces", hex(ok.first.wire) === hex(uploadData(OP_NOTE, message, { kind: KIND_NOTE }).slice(1)));
  check("Phil's server accepts what Phil's client sent", ok.srv.ret === 0 && /Phil: ACCEPTED/.test(ok.srv.logs.join()) && /note: received and validated/.test(ok.srv.logs.join()));
  check("the client, given the server's real answers, ends in accepted and returns 0", ok.second.ending === "accepted" && ok.second.returned === 0 && hex(ok.second.wire) === hex(ok.first.wire));
  const t = timeline(ok.second.steps, serverSteps(ok.srv.logs));
  const order = ["sends Hello", "Hello recognized", "version agreed", "is told: version 1", "sends Begin", "Begin recognized", "policy passed", "is told: proceed", "payload follows", "sends exactly", "payload received", "SHA-256 matches", "ACCEPTED", "is told: accepted", "records the upload"];
  check("merged, the two logs read as one conversation in protocol order", order.every((s, i) => { const at = t.findIndex((x) => x.text.includes(s)); return at >= 0 && (i === 0 || at > t.findIndex((x) => x.text.includes(order[i - 1]))); }), t.map((x) => x.text).join(" | "));

  const flipped = await session(module, { payload: message }, (w) => { const c = w.slice(); c[c.length - 1] ^= 1; return c; });
  check("a byte changed in transit: the server rejects, and the client ends in rejected", flipped.srv.ret === 1201 && flipped.second.ending === "rejected" && flipped.second.steps.some((s) => s.text === "is told: rejected"));
  const old = await session(module, { payload: message, versions: [7] });
  check("a client offering only a version the server lacks: both sides end at no common version", old.srv.ret === 1300 && old.second.ending === "no common version" && !old.second.steps.some((s) => /sends Begin/.test(s.text)) && old.second.steps.some((s) => s.text === "releases its payload"));
  const cancelled = await session(module, { payload: message, cancel: true });
  check("a client that cancels sends no payload, and the server stops cleanly", cancelled.srv.ret === 1500 && cancelled.second.ending === "cancelled" && !cancelled.second.steps.some((s) => /sends exactly/.test(s.text)) && hex(cancelled.first.wire).endsWith("00"));
  const big = await session(module, { payload: new Uint8Array(941) });
  check("an upload over the size limit: the server's policy refuses, and the client stops before sending the payload again", big.srv.ret === 1401 && big.second.ending === "refused by policy" && !big.second.steps.some((s) => /sends exactly/.test(s.text)) && big.second.steps.some((s) => /reason 1/.test(s.text)));
  const wrongKind = await session(module, { payload: message, kind: "something/else" });
  check("an upload of a kind the server does not take is refused by policy", wrongKind.srv.ret === 1402 && wrongKind.second.ending === "refused by policy");
  const garbled = await session(module, { payload: message }, (w) => { const c = w.slice(); c[0] = 0x51; return c; });
  check("a garbled first frame: the server refuses and the client is left with no answer", garbled.srv.ret === 1653 && garbled.second.ending === "no answer" && garbled.second.steps.some((s) => /never answered/.test(s.text)));
  const several = await session(module, { payload: message, versions: [1, 2, 9] });
  check("a client offering several versions is given the common one", several.srv.ret === 0 && several.second.ending === "accepted");
  check("an empty payload is a valid upload", (await session(module, { payload: new Uint8Array(0) })).second.ending === "accepted");
  check("every session's bytes came from Phil's client: none were built by hand", [ok, flipped, old, cancelled, big].every((x) => x.first.wire.length > 0 && x.first.steps.filter((s) => s.sends).length >= 1));
  void sha256; void unhex;
  console.log(fails ? `\n${fails} FAILED` : "\nAll session checks passed.");
  process.exit(fails ? 1 : 0);
})();
