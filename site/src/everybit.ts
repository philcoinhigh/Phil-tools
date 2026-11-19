// "Every bit": what Solana answered to each of 1,000 uploads, and the means to ask again.
import data from "../../everybit/data.json";
import { PROGRAM, IMAGE } from "./chains-data";
import { esc } from "./shared";
import { wireFooter } from "./foot";
import { hex } from "./draw";
import { runImage } from "./rv64";
import { explainCode } from "./chains";
import { buildCall, simulate } from "./solana-call";
import { cases, fields, fieldOf, honest } from "./everybit-core";

const $ = (id: string) => document.getElementById(id)!;
const RPC = "https://api.devnet.solana.com", num = (n: number) => n.toLocaleString("en-US");
const all = cases(), good = honest(), results = data.results as [number | null, string | null][];
const image = IMAGE ? Uint8Array.from(atob(IMAGE), (c) => c.charCodeAt(0)) : null;
const live = data.cluster === "devnet", program = data.program || PROGRAM?.programId || "";

// Sixteen answers, seven kinds of reason.
const family = (code: number | null): [string, string] =>
  code === null ? ["r-none", "did not land"] : code === 0 ? ["r-yes", "accepted"] : code === 1201 ? ["r-digest", "the bytes do not match their digest"]
  : code >= 1400 && code < 1500 ? ["r-policy", "refused by the server's policy"] : code >= 1600 && code < 1700 ? ["r-frame", "not a frame the protocol knows"]
  : code === 1300 ? ["r-version", "no protocol version in common"] : code === 1900 ? ["r-end", "fewer bytes than were declared"] : code === 1500 ? ["r-cancel", "read as a cancelled upload"] : ["r-instr", "not an instruction of this program"];
const answer = (code: number | null) => (code === null ? "no answer recorded" : `${code}: ${explainCode(code)}`);

const attacks = results.slice(1), landed = results.filter((r) => r[0] !== null).length, through = attacks.filter((r) => r[0] === 0).length;
const reasons = new Map<number, number>();
for (const [code] of attacks) if (code !== null && code !== 0) reasons.set(code, (reasons.get(code) ?? 0) + 1);
$("tally").innerHTML = [
  ["", num(results.length), live ? "transactions on Solana devnet" : "uploads, run here"],
  ["", num(attacks.length), `attacks: ${num(good.length * 8)} single bits, ${num(good.length)} cuts`],
  [through === 0 ? "zero" : "", num(through), "got through"],
  ["", num(reasons.size), "different reasons it gave for saying no"],
].map(([cls, v, l]) => `<div class="${cls}"><b>${v}</b><span>${esc(l!)}</span></div>`).join("");
const state = $("state");
if (live && data.ok) state.innerHTML = `Sent on ${esc(data.day)} to program <a href="https://explorer.solana.com/address/${esc(program)}?cluster=devnet">${esc(program)}</a>. All ${num(landed)} landed. The honest upload was accepted, and every answer matches what the same code gives off chain.`;
else if (live) { state.classList.add("warn"); state.textContent = `Sent on ${data.day}: ${num(landed)} of ${num(results.length)} landed, ${num(data.differs)} answers differ from the run off chain. Squares with no answer are shown empty. This run is not complete.`; }
else state.innerHTML = `These answers come from running the program's own code off chain, on two different machines that agree on all ${num(results.length)}. The same program is live on Solana devnet at <a href="https://explorer.solana.com/address/${esc(program)}?cluster=devnet">${esc(program)}</a>: pick any square and press "Ask devnet" to put that exact attack to the chain yourself.`;
$("how").textContent = live ? "Each attempt is its own public transaction." : "That is 999 attacks, and you can put any one of them to the chain from this page.";

// ---- the map ----
const cls = (i: number) => family(results[i]![0])[0];
$("map").innerHTML = fields(good.length).map((f) => `<div class="field"><span>${esc(f.name)}</span><div class="bytes">`
  + Array.from({ length: f.to - f.from }, (_, k) => { const byte = f.from + k; return `<div class="byte">` + Array.from({ length: 8 }, (_, b) => { const bit = byte * 8 + (7 - b), i = 1 + bit; return `<button class="bit ${cls(i)}" data-i="${i}" aria-label="byte ${byte}, bit ${7 - b}"></button>`; }).join("") + `</div>`; }).join("")
  + `</div></div>`).join("");
$("cuts").innerHTML = Array.from({ length: good.length }, (_, n) => { const i = 1 + good.length * 8 + n; return `<button class="cut ${cls(i)}" data-i="${i}" aria-label="cut to ${n} bytes"></button>`; }).join("");
const fams = new Map<string, [string, number]>();
for (const [code] of attacks) { const [c, words] = family(code); fams.set(c, [words, (fams.get(c)?.[1] ?? 0) + 1]); }
$("legend").innerHTML = [...fams].sort((a, b) => b[1][1] - a[1][1]).map(([c, [words, n]]) => `<span class="${c}"><i></i><b>${num(n)}</b> ${esc(words)}</span>`).join("");

// ---- one attack, up close ----
const bitsOf = (b: number) => b.toString(2).padStart(8, "0");
function show(i: number) {
  document.querySelectorAll(".on").forEach((e) => e.classList.remove("on"));
  document.querySelector(`[data-i="${i}"]`)?.classList.add("on");
  const c = all[i]!, [code, sig] = results[i]!;
  let title: string, what: string, diff = "";
  if (c.kind === "flip") {
    const byte = c.at >> 3, bit = c.at & 7, f = fieldOf(byte), was = good[byte]!, now = c.data[byte]!, pos = 7 - bit;
    title = `Bit ${bit} of byte ${byte}, in "${f.name}"`;
    what = `This field says ${f.says}. The attack changes one bit in it and leaves the other ${num(good.length * 8 - 1)} alone.`;
    const mark = (s: string) => s.slice(0, pos) + `<mark>${s[pos]}</mark>` + s.slice(pos + 1);
    diff = `byte ${byte} was ${mark(bitsOf(was))} (0x${hex(Uint8Array.of(was))}), sent as ${mark(bitsOf(now))} (0x${hex(Uint8Array.of(now))})`;
  } else if (c.kind === "cut") {
    title = c.at === 0 ? "Cut to nothing" : `Cut to the first ${c.at} byte${c.at === 1 ? "" : "s"}`;
    what = c.at === 0 ? "A transaction with no upload in it at all." : `The upload stops inside "${fieldOf(c.at - 1).name}"${c.at < good.length ? `, and the other ${good.length - c.at} bytes never arrive` : ""}.`;
  } else { title = "The honest upload"; what = "All 111 bytes, as written."; }
  $("detail").innerHTML = `<h3>${esc(title)}</h3><p>${esc(what)}</p>${diff ? `<p class="diff">${diff}</p>` : ""}
    <p class="answer ${family(code)[0]}">${live ? "Solana answered" : "The program answers"} ${esc(answer(code))}</p>
    <div class="acts">${sig ? `<a href="https://explorer.solana.com/tx/${esc(sig)}?cluster=devnet" target="_blank" rel="noopener">Open the transaction</a>` : ""}
      ${image ? `<button id="here">Run it in this browser</button>` : ""}${program ? `<button id="ask">${live ? "Ask devnet again" : "Ask devnet"}</button>` : ""}<span class="said" id="said"></span></div>`;
  const said = $("said");
  document.getElementById("here")?.addEventListener("click", () => { const r = runImage(image!, c.data); said.textContent = `this browser, running the same code as a RISC-V image: ${answer(r.code)} (${num(r.steps)} steps)`; });
  document.getElementById("ask")?.addEventListener("click", async () => {
    said.textContent = "asking a devnet node…";
    try {
      // A simulation: the node runs the program on these bytes against the chain as it is now. Nothing is signed or recorded.
      const s = await simulate(RPC, buildCall(data.wallet || "11111111111111111111111111111111", program, [], c.data));
      const got = s.ok ? 0 : s.programError ?? null;
      said.textContent = got === null ? `the node could not run it: ${s.error ?? "no answer"}` : `devnet, just now: ${answer(got)}`;
    } catch (e: any) { said.textContent = `the node did not answer: ${String(e?.message ?? e)}`; }
  });
}
document.addEventListener("click", (e) => { const i = (e.target as HTMLElement).dataset?.i; if (i) show(Number(i)); });
// Open on a square in the declared digest: the commonest kind of refusal.
show(1 + 60 * 8 + 3);

// ---- all of them, here ----
$("all").addEventListener("click", () => {
  if (!image) { $("all-said").textContent = "The RISC-V image is not in this build of the page."; return; }
  const t = performance.now();
  let same = 0, known = 0, yes = 0;
  all.forEach((c, i) => { const got = runImage(image, c.data).code; if (i > 0 && got === 0) yes++; if (results[i]![0] !== null) { known++; if (results[i]![0] === got) same++; } });
  $("all-said").textContent = `${num(all.length)} runs in ${Math.round(performance.now() - t)} ms. ${num(same)} of ${num(known)} give the answer ${live ? "Solana gave" : "recorded"}. Attacks accepted here: ${yes}.`;
});

$("reasons").innerHTML = `<thead><tr><th>Answer</th><th>What it means</th><th>Attacks</th></tr></thead><tbody>`
  + [...reasons].sort((a, b) => b[1] - a[1]).map(([code, n]) => `<tr><td class="${family(code)[0]}"><i></i>${code}</td><td>${esc(explainCode(code))}</td><td>${num(n)}</td></tr>`).join("") + `</tbody>`;
wireFooter();
