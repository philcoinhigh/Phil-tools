// Embeds the Phil programs in otc/ and contracts/ as TypeScript strings so every bundle can import them.
const fs = require("fs");
const read = (f) => JSON.stringify(fs.readFileSync(f, "utf8"));
const head = (from) => `// Generated from ${from} by scripts/gen-otc.js. Do not edit.\n`;
fs.writeFileSync("core/src/sim/otc-source.ts", head("otc/*.phil")
  + "export const OTC_SOURCE = " + read("otc/otc.phil") + ";\n"
  + "export const BOOK_SOURCE = " + read("otc/book.phil") + ";\n");
fs.writeFileSync("core/src/sim/contracts-source.ts", head("contracts/*.phil")
  + ["locker", "hooks", "launchhooks", "stockrewards", "vesting", "multisig", "auction", "launch"].map((n) => `export const ${n.toUpperCase()}_SOURCE = ${read(`contracts/${n}.phil`)};\n`).join(""));
