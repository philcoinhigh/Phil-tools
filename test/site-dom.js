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
  check("home: links to all three pages", ["playground/", "learn/", "hacks/", "otc/", "library/", "changelog/", "conformance/"].every((h) => p.d.querySelector(`.rows a[href="${h}"]`)));
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
  check("otc: default listing sells out in three fills", /Sold out/.test(res()) && /sold out · 3 fills/.test(res()) && /over 3 rounds/.test(res()) && hold() === "0,1980,0,20,1000,3000", res().slice(0, 160) + " | " + hold());
  check("otc: every coin is accounted for", (() => { const h = hold().split(",").map(Number); return h[0] + h[2] + h[4] === 1000 && h[1] + h[3] + h[5] === 5000; })(), hold());
  p.d.querySelector('[data-preset="dry"]').click();
  check("otc: wallet runs dry, listing expires part-filled", /Expired part-filled/.test(res()) && hold() === "600,792,0,8,400,200", res().slice(0, 160) + " | " + hold());
  p.d.querySelector('[data-preset="cancel"]').click();
  check("otc: maker cancels after one fill", /Cancelled by the maker/.test(res()) && /· 1 fill,/.test(res()) && /over 1 round\./.test(res()) && hold() === "600,792,0,8,400,4200", res().slice(0, 160) + " | " + hold());
  p.d.querySelector('[data-preset="expire"]').click();
  check("otc: expires part-filled after two rounds", /Expired part-filled/.test(res()) && hold() === "200,1584,0,16,800,3400", hold());
  type(p.w, p.d.getElementById("t-wallet"), "0"); p.d.getElementById("trade").click();
  check("otc: no money means no fills and all tokens back", /Expired with no fills/.test(res()) && hold() === "1000,0,0,0,0,0", hold());
  p.d.querySelector('[data-preset="sold"]').click();
  type(p.w, p.d.getElementById("t-fee"), "5000"); p.d.getElementById("trade").click();
  check("otc: an excessive fee is refused", /terms are refused/.test(res()), res().slice(0, 200));
  type(p.w, p.d.getElementById("t-fee"), "abc"); p.d.getElementById("trade").click();
  check("otc: nonsense input is refused without a crash", /terms are refused/.test(res()), res().slice(0, 200));
  type(p.w, p.d.getElementById("t-expires"), "100"); type(p.w, p.d.getElementById("t-wallet"), "0"); type(p.w, p.d.getElementById("t-fee"), "100"); p.d.getElementById("trade").click();
  check("otc: a long run is shown in part", /more steps not shown/.test(res()) && p.d.querySelectorAll(".steps li").length === 81, String(p.d.querySelectorAll(".steps li").length) + res().slice(0, 120));
  p.d.querySelector('[data-preset="sold"]').click();
  p.d.getElementById("hunt").click(); await wait(3500);
  check("otc: hunt finds nothing", /runs, no failure found/.test(p.d.getElementById("hunt-out").textContent), p.d.getElementById("hunt-out").textContent);
  // Order book
  p.d.getElementById("mode-book").click();
  const cash = () => { const h = hold().split(",").map(Number); return { tokens: h.filter((_, i) => i % 2 === 0), cash: h.filter((_, i) => i % 2 === 1) }; };
  check("book: switching shows the book form and program", p.d.getElementById("terms-single").hidden && !p.d.getElementById("terms-book").hidden && p.d.getElementById("src").textContent.includes("component Book") && p.d.getElementById("pg-link").getAttribute("href") === "../playground/#otc-book");
  check("book: cheaper listing fills first", /Listing B: sold out · 2 fills, maker received 990/.test(res()) && /Listing A: expired part-filled · 1 fill, maker received 891 and got 300 tokens back/.test(res()), res().slice(0, 300));
  check("book: holdings for all six parties", hold() === "300,891,0,990,0,9,0,10,600,500,200,500", hold());
  check("book: every coin is accounted for", cash().tokens.reduce((a, b) => a + b) === 1100 && cash().cash.reduce((a, b) => a + b) === 2900, hold());
  check("book: steps name whose turn it is", /Round 1 · Taker X's turn/.test(res()) && /Book quotes 500 tokens at 2 each/.test(res()) && /Maker B receives 594 cash for listing B/.test(res()), res().slice(300, 900));
  p.d.querySelector('[data-preset="b-deep"]').click();
  check("book: deep wallets sell out both", /Both listings sold out/.test(res()) && hold() === "0,1782,0,990,0,18,0,10,600,98500,500,98700", hold());
  p.d.querySelector('[data-preset="b-cancel"]').click();
  check("book: both makers cancel", /Listing A: cancelled by the maker/.test(res()) && /Listing B: cancelled by the maker/.test(res()), res().slice(0, 300));
  p.d.getElementById("hunt").click(); await wait(4200);
  check("book: hunt finds nothing", /runs, no failure found/.test(p.d.getElementById("hunt-out").textContent), p.d.getElementById("hunt-out").textContent);
  p.d.getElementById("mode-single").click();
  check("book: switching back restores the single listing", /Sold out/.test(res()) && !p.d.getElementById("terms-single").hidden);
  check("otc: source is shown", p.d.getElementById("src").textContent.includes("protocol Listing"));
  check("otc: no script errors", p.errors.length === 0, p.errors.join("|"));

  // Conformance report
  p = load("docs/conformance/index.html", "https://example.test/conformance/");
  const cdata = JSON.parse(fs.readFileSync("conformance/data.json", "utf8"));
  check("report: names the Phil commit", p.d.getElementById("against").textContent.includes(cdata.phil.commit));
  check("report: grammar figures match the data", p.d.querySelectorAll("#grammar .fig .n")[0].textContent.startsWith(String(cdata.grammar.accept.agree)) && p.d.querySelectorAll("#grammar .fig .n")[1].textContent.startsWith(String(cdata.grammar.reject.agree)));
  check("report: grammar agreement is complete", cdata.grammar.accept.agree === cdata.grammar.accept.files && cdata.grammar.reject.agree === cdata.grammar.reject.files, JSON.stringify(cdata.grammar));
  check("report: one table row per suite", p.d.querySelectorAll("#suites tbody tr").length === cdata.suites.length);
  check("report: published data does not identify files under review", !JSON.stringify(cdata).includes("review\":1") && cdata.suites.every((s) => !("review" in s)) && !fs.readFileSync("docs/conformance/index.html", "utf8").includes("restricted-source-transfer-v1/accepted"));
  check("report: lists the rejections we miss", p.d.querySelectorAll("#missed li").length === cdata.missed.length && cdata.missed.length === cdata.behaviour.reject.missed);
  check("report: no script errors", p.errors.length === 0, p.errors.join("|"));

  // Contract library
  p = load("docs/library/index.html", "https://example.test/library/");
  const lres = () => p.d.getElementById("result").textContent;
  check("library: four contracts, vesting first", p.d.querySelectorAll("#picker button").length === 4 && p.d.getElementById("c-title").textContent === "Vesting with revocation" && /beneficiary holds 1000/.test(lres()), lres());
  p.d.querySelector('[data-scenario="1"]').click();
  check("library: a scenario button reruns", /grantor revoked after 1 periods/.test(lres()) && /beneficiary holds 250/.test(lres()) && /hands Grantor 750 tokens/.test(lres()), lres());
  p.d.querySelector('[data-id="multisig"]').click();
  check("library: treasury pays with two approvals", /approvals: 2 of 3/.test(lres()) && /payee received 300/.test(lres()) && p.d.getElementById("f-alice_approves").checked && !p.d.getElementById("f-carol_approves").checked, lres());
  p.d.getElementById("f-bob_approves").checked = false; p.d.getElementById("run").click();
  check("library: unticking a signer denies the payment", /approvals: 1 of 3/.test(lres()) && /payment denied/.test(lres()), lres());
  p.d.querySelector('[data-id="auction"]').click();
  check("library: auction moves the item once", /won the item for 150/.test(lres()) && (lres().match(/the item/g) || []).length >= 2, lres());
  type(p.w, p.d.getElementById("f-reserve"), "500"); p.d.getElementById("run").click();
  check("library: reserve not met returns everything", /no sale/.test(lres()) && /refunded 150/.test(lres()) && /refunded 120/.test(lres()), lres());
  p.d.querySelector('[data-id="launch"]').click();
  check("library: launch graduates", /graduated with a reserve of 509500/.test(lres()) && p.d.getElementById("pg-link").getAttribute("href") === "../playground/#launch" && p.d.getElementById("gh-link").href.endsWith("/blob/main/contracts/launch.phil"), lres() + p.d.getElementById("gh-link").href);
  type(p.w, p.d.getElementById("f-slope"), "99999"); p.d.getElementById("run").click();
  check("library: an out-of-range input is refused", /violates the refinement/.test(lres()), lres());
  p.d.querySelector('[data-scenario="0"]').click();
  p.d.getElementById("hunt").click(); await wait(3600);
  check("library: hunt finds nothing", /runs, no failure found/.test(p.d.getElementById("hunt-out").textContent), p.d.getElementById("hunt-out").textContent);
  check("library: no script errors", p.errors.length === 0, p.errors.join("|"));

  // Hacks
  p = load("docs/hacks/index.html", "https://example.test/hacks/");
  const says = (id) => p.d.querySelector(`#demo-${id} .says`).textContent;
  check("hacks: four exhibits, each refused", p.d.querySelectorAll(".hack").length === 4 && /Ownership error, line 17/.test(says("dao")) && /Arithmetic error/.test(says("bec")) && /A promise was broken/.test(says("wormhole")) && /Ownership error/.test(says("akutars")), ["dao", "bec", "wormhole", "akutars"].map(says).join(" | "));
  check("hacks: the offending code is marked", p.d.querySelectorAll(".hack .errmark").length >= 4);
  p.d.querySelector('[data-flip="wormhole"]').click();
  check("hacks: the working version runs", /Ran to completion/.test(says("wormhole")) && /120000/.test(says("wormhole")) && /Ownership error/.test(says("dao")), says("wormhole"));
  p.d.querySelector('[data-flip="wormhole"]').click();
  check("hacks: flipping back shows the mistake", /A promise was broken/.test(says("wormhole")));
  check("hacks: every exhibit links its sources and the limits are stated", p.d.querySelectorAll(".hack .src a").length === 8 && p.d.querySelectorAll("#limits li").length === 4);
  check("hacks: no script errors", p.errors.length === 0, p.errors.join("|"));

  // Changelog
  p = load("docs/changelog/index.html", "https://example.test/changelog/");
  const ch = JSON.parse(fs.readFileSync("changelog/data.json", "utf8"));
  check("changelog: one entry per active day", p.d.querySelectorAll(".day").length === ch.days.length && ch.days.length > 0);
  check("changelog: names the Phil commit", p.d.getElementById("against").textContent.includes(ch.phil.commit));
  check("changelog: the grammar line matches the data", /grammar/.test(p.d.getElementById("grammar").textContent) && p.d.getElementById("grammar").classList.contains("changed") === ch.days.some((d) => d.grammar.length > 0));
  check("changelog: commit subjects link to Phil's commits", [...p.d.querySelectorAll(".words a")].every((a) => a.href.startsWith("https://github.com/abiggerhammer/phil/commit/")) && p.d.querySelectorAll(".words a").length > 0);
  check("changelog: history table has a row per run", p.d.querySelectorAll("#history tbody tr").length === ch.history.length);
  check("changelog: days are newest first and dates are well formed", ch.days.every((d, i) => /^\d{4}-\d\d-\d\d$/.test(d.date) && (i === 0 || d.date < ch.days[i - 1].date)));
  check("changelog: no script errors", p.errors.length === 0, p.errors.join("|"));

  // Old shared links to the root still reach the playground
  check("home: forwards old playground links", fs.readFileSync("site/src/home.ts", "utf8").includes('location.replace("playground/" + location.hash)'));
  console.log(fails ? `${fails} failed` : "site: all passed");
  process.exit(fails ? 1 : 0);
})();
