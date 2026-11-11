// Drives the home, Learn and OTC pages in jsdom like a user would.
const { JSDOM } = require("jsdom");
const fs = require("fs");

function load(file, url, width = 1200) {
  const errors = [];
  const dom = new JSDOM(fs.readFileSync(file, "utf8"), {
    runScripts: "dangerously", url, pretendToBeVisual: true,
    beforeParse(w) {
      w.addEventListener("error", (e) => errors.push(e.message));
      w.scrollTo = () => {}; w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      w.matchMedia = (q) => ({ matches: /max-width: 820px/.test(q) ? width <= 820 : false, addEventListener() {}, removeEventListener() {} });
    },
  });
  return { w: dom.window, d: dom.window.document, errors };
}
let fails = 0;
const check = (n, ok, info = "") => { if (!ok) { fails++; console.log("FAIL", n, info); } else console.log("ok  ", n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const type = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); };

(async () => {
  // Home
  let p = load("docs/index.html", "https://example.test/");
  check("home: demo reports the double spend", /Ownership error, line 17/.test(p.d.getElementById("demo-says").textContent), p.d.getElementById("demo-says").textContent);
  p.d.getElementById("demo-flip").click();
  check("home: fixed demo runs", /hands back 10/.test(p.d.getElementById("demo-says").textContent), p.d.getElementById("demo-says").textContent);
  check("home: links to all three pages", ["playground/", "learn/", "otc/"].every((h) => p.d.querySelector(`.rows a[href="${h}"]`)));
  check("home: no script errors", p.errors.length === 0, p.errors.join("|"));

  // Learn
  p = load("docs/learn/index.html", "https://example.test/learn/");
  const out = () => p.d.getElementById("out").textContent;
  check("learn: opens on the first lesson", p.d.getElementById("title").textContent === "Your first program");
  check("learn: lists fifteen lessons", p.d.querySelectorAll("#toc-list a").length === 15);
  p.d.getElementById("run").click();
  check("learn: running the untouched starter does not finish the task", /Ran to completion/.test(out()) && !/Task done/.test(out()) && p.d.querySelectorAll("#toc-list .tick:not(:empty)").length === 0, out());
  const ta = p.d.querySelector("#editor textarea");
  type(p.w, ta, ta.value.replace("x + 2", "x + 60"));
  p.d.getElementById("run").click();
  check("learn: a correct edit finishes the task", /Task done/.test(out()) && p.d.querySelectorAll("#toc-list .tick:not(:empty)").length === 1, out());
  type(p.w, ta, ta.value.replace("x + 60", "x + 1"));
  p.d.getElementById("run").click();
  check("learn: a wrong answer says what is missing", /should hand back 100/.test(out()), out());
  p.w.location.hash = "#split"; await wait(50);
  check("learn: hash opens a lesson with inputs", p.d.getElementById("title").textContent === "Splitting a coin" && p.d.querySelector('#inputs input[data-k="price"]').value === "50");
  p.d.getElementById("run").click();
  check("learn: starter shows the broken promise", /A promise was broken/.test(out()), out());
  const ta2 = p.d.querySelector("#editor textarea");
  type(p.w, p.d.querySelector('#inputs input[data-k="price"]'), "5");
  p.d.getElementById("run").click();
  check("learn: passing for one input is not enough when a hunt is required", /bug hunt found a failure/.test(out()) || !/Task done/.test(out()), out());
  check("learn: editor kept the code", ta2.value.includes("split(wallet, price)"));
  p.d.getElementById("solve").click();
  check("learn: the answer passes", /Task done/.test(out()), out());
  check("learn: no script errors", p.errors.length === 0, p.errors.join("|"));
  p = load("docs/learn/index.html", "https://example.test/learn/#otc", 390);
  p.d.getElementById("run").click();
  check("learn: last lesson runs and shows the finish box", /Lesson done/.test(p.d.getElementById("out").textContent) && !p.d.getElementById("finish").hidden);
  check("learn: lesson list is collapsed on a phone", !p.d.getElementById("toc").open);

  // OTC
  p = load("docs/otc/index.html", "https://example.test/otc/");
  const res = () => p.d.getElementById("result").textContent;
  check("otc: default trade fills", /Filled/.test(res()) && /maker received 248 after a desk fee of 2/.test(res()), res().slice(0, 200));
  check("otc: nine steps", p.d.querySelectorAll(".steps li").length === 9);
  type(p.w, p.d.getElementById("t-wallet"), "100"); p.d.getElementById("trade").click();
  check("otc: short wallet means refund", /Not filled/.test(res()) && /tokens back/.test(res()), res().slice(0, 200));
  type(p.w, p.d.getElementById("t-wallet"), "400"); type(p.w, p.d.getElementById("t-fee"), "5000"); p.d.getElementById("trade").click();
  check("otc: an excessive fee is refused", /refuses these terms/.test(res()), res().slice(0, 200));
  type(p.w, p.d.getElementById("t-fee"), "abc"); p.d.getElementById("trade").click();
  check("otc: nonsense input is refused without a crash", /refuses|Stopped|Wiring/.test(res()), res().slice(0, 200));
  type(p.w, p.d.getElementById("t-fee"), "100"); p.d.getElementById("hunt").click(); await wait(3500);
  check("otc: hunt finds nothing", /runs, no failure found/.test(p.d.getElementById("hunt-out").textContent), p.d.getElementById("hunt-out").textContent);
  check("otc: source is shown", p.d.getElementById("src").textContent.includes("protocol Listing"));
  check("otc: no script errors", p.errors.length === 0, p.errors.join("|"));

  // Old shared links to the root still reach the playground
  check("home: forwards old playground links", fs.readFileSync("site/src/home.ts", "utf8").includes('location.replace("playground/" + location.hash)'));
  console.log(fails ? `${fails} failed` : "site: all passed");
  process.exit(fails ? 1 : 0);
})();
