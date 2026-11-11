// Embeds otc/otc.phil and otc/book.phil as TypeScript strings so every bundle can import them.
const fs = require("fs");
const read = (f) => JSON.stringify(fs.readFileSync(f, "utf8"));
fs.writeFileSync("core/src/sim/otc-source.ts",
  "// Generated from otc/*.phil by scripts/gen-otc.js. Do not edit.\n"
  + "export const OTC_SOURCE = " + read("otc/otc.phil") + ";\n"
  + "export const BOOK_SOURCE = " + read("otc/book.phil") + ";\n");
