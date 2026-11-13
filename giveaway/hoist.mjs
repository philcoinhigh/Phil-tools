// Moves every `alloca` line in a function to the top of that function, and changes nothing else.
// Phil's module reserves some stack slots in the middle of a function. Each such block runs at
// most once, so reserving the slot at the top instead means the same thing; Solana's code
// generator only supports the top. Used by build.sh only if the unmodified module does not compile.
// Usage: node hoist.mjs <in.ll> <out.ll>
import fs from "fs";
const [src, dst] = process.argv.slice(2);
const out = [];
let entryAt = -1, moved = 0, block = 0;
for (const line of fs.readFileSync(src, "utf8").split("\n")) {
  if (/^define /.test(line)) { out.push(line); entryAt = -1; block = 0; continue; }
  if (/^[A-Za-z0-9_.]+:/.test(line)) { out.push(line); block++; if (block === 1) entryAt = out.length; continue; }
  if (/^}/.test(line)) { entryAt = -1; out.push(line); continue; }
  if (entryAt >= 0 && block > 1 && /^\s+%\S+ = alloca /.test(line)) { out.splice(entryAt++, 0, line); moved++; continue; }
  out.push(line);
}
fs.writeFileSync(dst, out.join("\n"));
console.log(`moved ${moved} stack slots to the top of their functions`);
