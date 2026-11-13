// The mutation analysis page: aggregates only.
import { MUTATION as M } from "./mutation-data";
import { esc } from "./shared";
import { wireFooter } from "./foot";

const $ = (id: string) => document.getElementById(id)!;
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "–");
if (M) {
  $("facts").innerHTML = [
    [String(M.total.mutants), `broken versions of Phil's module (${M.server.mutants} in the server, ${M.client.mutants} in the client)`, ""],
    [`${M.server.oursKills} of ${M.server.mutants}`, "broken servers caught by our checking runtime and tests", "good"],
    [`${M.total.eitherKills} of ${M.total.mutants}`, "caught by Phil's integrated test or ours", ""],
  ].map(([v, l, c]) => `<div><b class="${c}">${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
  $("when").innerHTML = `Run on ${esc(M.day)} against <code>${esc(M.module)}</code> as emitted at Phil <a href="https://github.com/abiggerhammer/phil/commit/${esc(M.philCommit)}" rel="noopener">${esc(M.philCommit.slice(0, 10))}</a>, with Phil's runtime and test at <a href="https://github.com/abiggerhammer/phil/commit/${esc(M.philRuntimeCommit)}" rel="noopener">${esc(M.philRuntimeCommit.slice(0, 10))}</a>. ${M.generated} changes were generated; ${M.malformed} produced a malformed module and were discarded.`;
  $("ops").querySelector("tbody")!.innerHTML = M.byOperator.map((o: any) => `<tr><td>${esc(o.name)}</td><td class="n">${o.mutants}</td><td class="n">${o.eitherKills} (${pct(o.eitherKills, o.mutants)})</td></tr>`).join("");
  $("blocks").querySelector("tbody")!.innerHTML = M.serverByBlock.map((b: any) => `<tr><td><code>${esc(b.name)}</code></td><td class="n">${b.mutants}</td><td class="n"><span class="bar" style="width:${Math.round((60 * b.oursKills) / b.mutants)}px"></span>${b.oursKills}</td></tr>`).join("");
  $("two").textContent = `Of the ${M.total.mutants} mutants, Phil's integrated native upload test catches ${M.total.philKills} and our suites catch ${M.total.oursKills}; together they catch ${M.total.eitherKills}. Our suites do not run the client at all, so every one of the ${M.client.philKills} client mutants that is caught is caught by Phil's test alone.`;
} else $("facts").innerHTML = "<div><b>–</b><span>No run has been recorded yet.</span></div>";
wireFooter();
