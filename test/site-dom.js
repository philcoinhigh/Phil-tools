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
  const hold = () => [...p.d.querySelectorAll(".party dd")].map((e) => e.lastChild.textContent).join(",");
  check("otc: default listing sells out in three fills", /Sold out/.test(res()) && /3 fills over 3 rounds/.test(res()) && hold() === "0,1980,0,20,1000,3000", res().slice(0, 160) + " | " + hold());
  check("otc: every coin is accounted for", (() => { const h = hold().split(",").map(Number); return h[0] + h[2] + h[4] === 1000 && h[1] + h[3] + h[5] === 5000; })(), hold());
  p.d.querySelector('[data-preset="dry"]').click();
  check("otc: wallet runs dry, listing expires part-filled", /Expired part-filled/.test(res()) && hold() === "600,792,0,8,400,200", res().slice(0, 160) + " | " + hold());
  p.d.querySelector('[data-preset="cancel"]').click();
  check("otc: maker cancels after one fill", /Cancelled by the maker/.test(res()) && /1 fill over 1 round/.test(res()) && hold() === "600,792,0,8,400,4200", res().slice(0, 160) + " | " + hold());
  p.d.querySelector('[data-preset="expire"]').click();
  check("otc: expires part-filled after two rounds", /Expired part-filled/.test(res()) && hold() === "200,1584,0,16,800,3400", hold());
  type(p.w, p.d.getElementById("t-wallet"), "0"); p.d.getElementById("trade").click();
  check("otc: no money means no fills and all tokens back", /Expired with no fills/.test(res()) && hold() === "1000,0,0,0,0,0", hold());
  p.d.querySelector('[data-preset="sold"]').click();
  type(p.w, p.d.getElementById("t-fee"), "5000"); p.d.getElementById("trade").click();
  check("otc: an excessive fee is refused", /refuses these terms/.test(res()), res().slice(0, 200));
  type(p.w, p.d.getElementById("t-fee"), "abc"); p.d.getElementById("trade").click();
  check("otc: nonsense input is refused without a crash", /refuses|Stopped|Wiring/.test(res()), res().slice(0, 200));
  type(p.w, p.d.getElementById("t-expires"), "100"); type(p.w, p.d.getElementById("t-wallet"), "0"); type(p.w, p.d.getElementById("t-fee"), "100"); p.d.getElementById("trade").click();
  check("otc: a long run is shown in part", /more steps not shown/.test(res()) && p.d.querySelectorAll(".steps li").length === 81, String(p.d.querySelectorAll(".steps li").length) + res().slice(0, 120));
  p.d.querySelector('[data-preset="sold"]').click();
  p.d.getElementById("hunt").click(); await wait(3500);
  check("otc: hunt finds nothing", /runs, no failure found/.test(p.d.getElementById("hunt-out").textContent), p.d.getElementById("hunt-out").textContent);
  check("otc: source is shown", p.d.getElementById("src").textContent.includes("protocol Listing"));
  check("otc: no script errors", p.errors.length === 0, p.errors.join("|"));

  // Old shared links to the root still reach the playground
  check("home: forwards old playground links", fs.readFileSync("site/src/home.ts", "utf8").includes('location.replace("playground/" + location.hash)'));
  console.log(fails ? `${fails} failed` : "site: all passed");
  process.exit(fails ? 1 : 0);
})();
