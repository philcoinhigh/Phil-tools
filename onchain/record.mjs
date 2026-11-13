// Writes onchain/deployment.json and appends to onchain/history.json after a run.
// Reads the run's outputs from onchain/out and the previous record, so a night on which devnet
// could not be reached does not erase what is known about the deployment.
import fs from "fs";
import crypto from "crypto";

const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const good = (r) => (r && r.returned != null ? r : null);
const env = process.env;
const prev = read("onchain/deployment.json") ?? {};
const day = new Date().toISOString().slice(0, 10);
const so = fs.existsSync("onchain/out/phil_first.so") ? fs.readFileSync("onchain/out/phil_first.so") : null;
const sha = so ? crypto.createHash("sha256").update(so).digest("hex") : null;
const local = good(read("onchain/out/local.json"));
const devnet = good(read("onchain/out/devnet.json"));
const browserCall = read("onchain/out/simulate.json");
const redeployed = env.REDEPLOYED === "true";
const phil = read("philc/build.json")?.commit ?? "unknown";
const was = prev.devnet ?? {};

const record = {
  day, philCommit: phil, solana: env.SOLANA_VERSION || prev.solana || "unknown",
  programBytes: so ? so.length : prev.programBytes ?? 0, programSha256: sha,
  local: { ok: !!local, run: local },
  devnet: {
    ok: !!devnet,
    programId: env.PROGRAM || was.programId || "", wallet: env.WALLET || was.wallet || "",
    run: devnet ?? was.run ?? null,
    runDay: devnet ? day : was.runDay ?? prev.day ?? null,
    deployedSha256: devnet ? (redeployed || !was.deployedSha256 ? sha : was.deployedSha256) : was.deployedSha256 ?? null,
    deployedOn: redeployed && devnet ? day : was.deployedOn ?? prev.day ?? null,
    deployedPhil: redeployed && devnet ? phil : was.deployedPhil ?? prev.philCommit ?? null,
    browserCall: browserCall ? { ok: !!browserCall.ok, returned: browserCall.returned ?? null, units: browserCall.units ?? null, cors: browserCall.cors ?? null, error: browserCall.error ?? null } : null,
  },
};
fs.writeFileSync("onchain/deployment.json", JSON.stringify(record, null, 1) + "\n");

const history = (read("onchain/history.json") ?? []).filter((h) => h.day !== day);
history.push({ day, phil: phil.slice(0, 10), ok: !!devnet, local: !!local, returned: devnet?.returned ?? null, units: devnet?.unitsConsumed ?? null, signature: devnet?.signature ?? null, redeployed: redeployed && !!devnet });
fs.writeFileSync("onchain/history.json", JSON.stringify(history.slice(-90), null, 1) + "\n");
console.log(JSON.stringify(record, null, 1));
