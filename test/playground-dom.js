// Drives dist/playground.html in jsdom like a user would.
const { JSDOM } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync("dist/playground.html", "utf8");
const { EXAMPLES } = require("../out/examples.cjs");

function load(width, hash = "#token") {
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", url: "https://example.test/" + hash, pretendToBeVisual: true,
    beforeParse(w) {
      w.addEventListener("error", (e) => errors.push(e.message));
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.matchMedia = (q) => ({ matches: /max-width: 860px/.test(q) ? width <= 860 : false, addEventListener() {}, removeEventListener() {} });
      w.innerWidth = width;
      Object.defineProperty(w.navigator, "clipboard", { value: { writeText: async (t) => { w.__copied = t; } } });
    },
  });
  return { dom, w: dom.window, d: dom.window.document, errors };
}

let fails = 0;
const check = (n, ok, info = "") => { if (!ok) { fails++; console.log("FAIL", n, info); } else console.log("ok  ", n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ------------------------------------------------ desktop
  let { w, d, errors } = load(1360);
  await wait(200);
  const summary = () => d.getElementById("summary").textContent.replace(/\s+/g, " ").trim();
  const good = () => !!d.querySelector("#summary .verdict.good");
  check("no script errors", errors.length === 0, errors.join("; "));
  check("token example ran on load", good(), summary());
  check("sequence drawn with coin message", d.querySelector("#sequence svg")?.textContent.includes("Coin { amount = 30 }"));
  check("paw marks for finished processes", d.querySelectorAll("#sequence .paw").length === 2);
  check("three entry inputs", d.querySelectorAll("#inputs input").length === 3);
  check("credit footer", d.querySelector(".credit").textContent.includes("Built by the Philcoin community"));
  check("full contract in About", d.getElementById("ca-full").textContent === "Ea5dBrJZN58yV1nm1Q4DybJNYKeTvwpb2GEkXyW64bUH");
  d.querySelector(".credit .copy-ca").click(); await wait(20);
  check("copy contract address", w.__copied === "Ea5dBrJZN58yV1nm1Q4DybJNYKeTvwpb2GEkXyW64bUH", w.__copied);
  check("non-affiliation note present", d.getElementById("panel-about").textContent.includes("not part of, or endorsed by, the Phil project"));

  // Replay
  const range = d.getElementById("rp-range");
  check("replay visible", !d.getElementById("replay").hidden && +range.max >= 5, range.max);
  d.getElementById("rp-first").click();
  check("replay first event label", d.getElementById("rp-label").textContent.startsWith("1 /"), d.getElementById("rp-label").textContent);
  check("future events dimmed", d.querySelectorAll("#sequence .future").length >= 4);
  check("source line marked for event", !!d.querySelector("#highlight .ln.now"));
  d.getElementById("rp-next").click();
  check("replay next", d.getElementById("rp-label").textContent.startsWith("2 /"));
  d.getElementById("rp-last").click();
  check("replay last clears marker", !d.querySelector("#highlight .ln.now") && d.querySelectorAll("#sequence .future").length === 0);

  // Every example
  const sel = d.getElementById("example");
  for (const ex of EXAMPLES) {
    sel.value = ex.id; sel.dispatchEvent(new w.Event("change"));
    check(`example ${ex.id} → ${ex.expect}`, ex.expect === "ok" ? good() : !good() && summary().length > 10, summary().slice(0, 140));
  }

  // Entry edit → contract violation; invalid entry flagged
  sel.value = "token"; sel.dispatchEvent(new w.Event("change"));
  const price = d.getElementById("in-price");
  price.value = "abc"; price.dispatchEvent(new w.Event("input"));
  check("invalid entry flagged", price.getAttribute("aria-invalid") === "true");
  price.value = "150"; price.dispatchEvent(new w.Event("input"));
  d.getElementById("run").click();
  check("overspend via entry", summary().includes("Contract violated"), summary().slice(0, 160));
  check("runtime error highlighted", !!d.querySelector("#highlight .rt-err"));

  // Editing: syntax error, quick fix, comment toggle, format
  const code = d.getElementById("code");
  sel.value = "hello"; sel.dispatchEvent(new w.Event("change"));
  code.value = code.value.replace("return answer;", "return answer"); code.dispatchEvent(new w.Event("input"));
  await wait(250);
  check("syntax error counted", d.getElementById("problems-count").textContent.trim() === "1");
  check("status shows error", d.getElementById("syntax-status").textContent.includes("1 syntax error"));
  d.getElementById("run").click();
  check("run blocked by syntax error", summary().includes("Not run"));
  d.querySelector("#problems button.fix").click();
  d.getElementById("run").click();
  check("quick fix repairs and runs", good(), summary());
  d.querySelector('.tab[data-tab="console"]').click();
  check("console output", d.getElementById("console").textContent.includes("The answer is 42"));

  code.focus(); code.setSelectionRange(code.value.indexOf("let x"), code.value.indexOf("let x"));
  code.dispatchEvent(new w.KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true }));
  check("Ctrl+/ comments the line", /\/\/ let x/.test(code.value), code.value.split("\n")[3]);
  code.dispatchEvent(new w.KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true }));
  check("Ctrl+/ uncomments", !/\/\/ let x/.test(code.value));

  code.value = "component main provides U32 {\nlet x = convert 1 to U32;\n      return x;\n}\n"; code.dispatchEvent(new w.Event("input"));
  d.getElementById("format").click();
  check("format re-indents", code.value === "component main provides U32 {\n  let x = convert 1 to U32;\n  return x;\n}\n", JSON.stringify(code.value));

  code.setSelectionRange(code.value.length, code.value.length);
  code.dispatchEvent(new w.KeyboardEvent("keydown", { key: "(", bubbles: true }));
  check("auto-close bracket", code.value.endsWith("()"), JSON.stringify(code.value.slice(-5)));
  code.dispatchEvent(new w.KeyboardEvent("keydown", { key: ")", bubbles: true }));
  check("typing closer skips over", code.value.endsWith("()") && code.selectionStart === code.value.length);

  // Docs
  d.querySelector('.tab[data-tab="docs"]').click();
  const search = d.getElementById("doc-search");
  search.value = "linear"; search.dispatchEvent(new w.Event("input"));
  check("docs search finds linear", d.getElementById("docs").textContent.includes("Structural mode"), d.getElementById("docs").textContent.slice(0, 120));
  search.value = "PHIL-P007"; search.dispatchEvent(new w.Event("input"));
  check("docs search finds error code", d.getElementById("docs").textContent.includes("Missing semicolon"));

  // Scratch pad via file open
  const file = new w.File(["component main provides U32 {\r\n  return convert 7 to U32;\r\n}\r\n"], "seven.phil", { type: "text/plain" });
  const input = d.getElementById("file-input");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new w.Event("change"));
  await wait(100);
  check("file opens into scratch pad", sel.value === "scratch" && code.value.includes("convert 7") && !code.value.includes("\r"));
  d.getElementById("run").click();
  check("opened file runs", good() && summary().includes("returned 7"), summary());

  // Trace click reveals source
  sel.value = "ping"; sel.dispatchEvent(new w.Event("change"));
  d.querySelector('.tab[data-tab="trace"]').click();
  d.querySelector("#trace [data-span]").click();
  check("trace click marks source line", !!d.querySelector("#highlight .ln.now"));

  // Ownership view
  sel.value = "token"; sel.dispatchEvent(new w.Event("change"));
  const hold = () => d.getElementById("holdings").textContent.replace(/\s+/g, " ");
  check("holdings: final state", !d.getElementById("holdings").hidden && /alice owns.*amount = 70.*bob owns.*amount = 530/.test(hold()), hold());
  d.getElementById("rp-first").click();
  check("holdings: coin moved to bob at step 1", /alice owns.*amount = 70.*bob owns.*amount = 30/.test(hold()) && d.querySelectorAll("#holdings .chip.fresh").length >= 1, hold());

  // Bug hunt
  d.getElementById("hunt-run").click();
  const hunt = () => d.getElementById("hunt-out").textContent.replace(/\s+/g, " ");
  check("hunt finds overflow and overspend in token example", /2 ways to fail/.test(hunt()) && hunt().includes("Arithmetic trap") && hunt().includes("Contract violated"), hunt().slice(0, 200));
  check("hunt count badge", d.getElementById("hunt-count").textContent.trim() === "2");
  d.querySelector("#hunt-out button[data-replay]").click();
  check("replaying a finding reproduces the failure", !good() && !!d.querySelector("#summary .verdict.bad"), summary().slice(0, 120));
  sel.value = "ping"; sel.dispatchEvent(new w.Event("change"));
  d.getElementById("hunt-run").click();
  check("hunt: ping has no failures", hunt().includes("No failures found"), hunt().slice(0, 120));
  code.value = "record Coin mode linear { amount : U64 }\ncallable K(c : Coin) -> Unit { outcomes { success Unit }; }\nfn lose(c : Coin) -> Unit satisfies K { return unit; }\n"; code.dispatchEvent(new w.Event("input"));
  d.getElementById("hunt-run").click();
  check("hunt: function mode finds dropped coin", hunt().includes("each function was called") && hunt().includes("never consumed"), hunt().slice(0, 200));

  // Designer
  d.querySelector('.tab[data-tab="design"]').click();
  check("designer renders steps", d.querySelectorAll("#dz-steps .dz-row").length === 3);
  d.getElementById("dz-add").click();
  d.getElementById("dz-repeat").checked = true;
  d.getElementById("dz-go").click();
  check("designer generates a running program", sel.value === "scratch" && code.value.includes("protocol Order") && code.value.includes("recursive Loop") && good(), summary().slice(0, 160));
  d.getElementById("hunt-run").click();
  check("designer output survives a hunt", hunt().includes("No failures found"), hunt().slice(0, 160));

  // Puzzles
  sel.value = "fix-overflow"; sel.dispatchEvent(new w.Event("change"));
  check("puzzle starts broken", !good() && d.getElementById("blurb").textContent.startsWith("Puzzle:"));
  code.value = code.value.replace("convert 250 to U8", "convert 200 to U8"); code.dispatchEvent(new w.Event("input"));
  d.getElementById("run").click();
  check("puzzle solved", summary().includes("Puzzle solved") && sel.querySelector('option[value="fix-overflow"]').textContent.startsWith("✓"), summary().slice(0, 120));

  // ------------------------------------------------ mobile
  ({ w, d, errors } = load(390, "#doublespend"));
  await wait(200);
  const main = d.getElementById("main");
  check("mobile: no script errors", errors.length === 0, errors.join("; "));
  check("mobile: starts on results after auto-run? (code view by default)", main.dataset.view === "code" || main.dataset.view === "results");
  d.getElementById("view-code").click();
  check("mobile: code view", main.dataset.view === "code");
  const mcode = d.getElementById("code");
  mcode.focus(); mcode.setSelectionRange(mcode.value.length, mcode.value.length);
  d.querySelector('#keys button[data-k="5"]').click();
  check("mobile: symbol key inserts ;", mcode.value.endsWith(";"), JSON.stringify(mcode.value.slice(-3)));
  d.getElementById("run-m").click();
  check("mobile: Run switches to results", main.dataset.view === "results");
  d.getElementById("view-code").click(); d.getElementById("hunt-m").click();
  check("mobile: Hunt switches to results", main.dataset.view === "results" && !d.getElementById("panel-hunt").hidden);
  check("mobile: stray ; reported as syntax error", d.getElementById("summary").textContent.includes("Not run"));

  console.log(fails ? `${fails} failures` : "playground DOM test OK");
  process.exit(fails ? 1 : 0);
})();
