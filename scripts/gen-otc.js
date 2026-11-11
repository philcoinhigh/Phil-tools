// Embeds otc/otc.phil as a TypeScript string so every bundle can import it.
const fs = require("fs");
const src = fs.readFileSync("otc/otc.phil", "utf8");
fs.writeFileSync("core/src/sim/otc-source.ts", "// Generated from otc/otc.phil by scripts/gen-otc.js. Do not edit.\nexport const OTC_SOURCE = " + JSON.stringify(src) + ";\n");
