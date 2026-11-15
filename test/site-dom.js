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
  const hrefs = [...p.d.querySelectorAll("main a")].map((a) => a.getAttribute("href"));
  check("home: every page is linked from the body", ["tour/", "learn/", "hacks/", "playground/", "onchain/", "coin/", "session/", "giveaway/", "locker/", "burn/", "mutation/", "otc/", "otc/#book", "changelog/", "conformance/", "fuzz/"].every((h) => hrefs.includes(h)), hrefs.join(" "));
  check("home: every utility has its own link", ["locker", "hooks", "launchhooks", "stockrewards", "vesting", "multisig", "auction", "launch"].every((id) => hrefs.includes("library/#" + id)) && p.d.querySelectorAll("#made a").length === 10);
  check("home: daily figures are filled in from the data", /^\d/.test(p.d.getElementById("s-changes").textContent) && p.d.getElementById("s-grammar").textContent.startsWith("64 of 64") && /^[\d,]+$/.test(p.d.getElementById("s-fuzz").textContent) && /MB, built from commit/.test(p.d.getElementById("s-philc-l").textContent), [p.d.getElementById("s-changes").textContent, p.d.getElementById("s-grammar").textContent, p.d.getElementById("s-fuzz").textContent].join(" | "));
  {
    const menu = [...p.d.querySelectorAll(".site .menu nav a")].map((a) => a.getAttribute("href"));
    const pages = ["tour/", "learn/", "playground/", "hacks/", "coin/", "session/", "giveaway/", "locker/", "burn/", "onchain/", "library/", "otc/", "mutation/", "fuzz/", "conformance/", "changelog/"];
    check("home: the menu lists every page, in four groups", pages.every((h) => menu.includes(h)) && p.d.querySelectorAll(".site .menu h4").length === 5 && [...p.d.querySelectorAll(".site nav.full a")].map((a) => a.getAttribute("href")).join() === "./#start,./#chain,./#build,./#lab");
    check("home: the footer lists every page too", pages.every((h) => [...p.d.querySelectorAll(".foot-nav a")].some((a) => a.getAttribute("href") === h)));
    check("home: each section the header points at exists", ["start", "chain", "build", "lab", "coin"].every((id) => p.d.getElementById(id)));
    check("home: the coin's address is shown in the hero and the footer", p.d.getElementById("ca-hero").textContent === "Ea5dBrJZN58yV1nm1Q4DybJNYKeTvwpb2GEkXyW64bUH" && p.d.getElementById("ca").textContent === "Ea5dBrJZN58yV1nm1Q4DybJNYKeTvwpb2GEkXyW64bUH");
    check("home: figures for the tour and the mutation analysis are filled in", p.d.getElementById("n-tour").textContent === "20" && /^\d+\/\d+$/.test(p.d.getElementById("mu-val").textContent) && /^\d+$/.test(p.d.getElementById("mu-all").textContent));
    check("home: the hero carries our own mark, and none of Phil's mascot art is used anywhere", !!p.d.querySelector(".emblem-coin svg") && p.d.querySelectorAll("img").length === 0 && !/mascots\/[^"\s]*\.(png|jpe?g|webp)/.test(fs.readFileSync("docs/index.html", "utf8")));
    check("home: nothing stays hidden where sections cannot ease in", [...p.d.querySelectorAll(".rv")].every((el) => el.classList.contains("in")) && p.d.querySelectorAll(".rv").length > 15);
    check("home: the page says what Philcoin is and is not", /community token/.test(p.d.getElementById("coin").textContent) && /not the Phil project/.test(p.d.getElementById("coin").textContent) && /financial advice/.test(p.d.getElementById("coin").textContent));
  }
  {
    const sub = load("docs/giveaway/index.html", "https://example.test/giveaway/");
    check("a page inside a group marks its group and itself in the header", sub.d.querySelector('.site nav.full a[aria-current]').textContent === "On chain" && sub.d.querySelector('.site .menu a[aria-current="page"]').getAttribute("href") === "../giveaway/" && sub.d.querySelector(".site nav.full a").getAttribute("href") === "../#start");
  }
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
  p.d.getElementById("trade").click();
  check("otc: pressing Run shows that it ran, and the hunt result sits under the buttons", /^Ran just now/.test(p.d.getElementById("ran").textContent) && p.d.getElementById("result").classList.contains("flash") && p.d.querySelector(".go").nextElementSibling.id === "hunt-out");
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
  check("library: eight utilities, the locker first", p.d.querySelectorAll("#picker button").length === 8 && p.d.getElementById("c-title").textContent === "Token locker" && /recipient holds 1200/.test(lres()) && p.d.querySelectorAll("#c-port li").length === 3, lres());
  p.d.querySelector('[data-scenario="1"]').click();
  check("library: locker cancelled half way splits the lock", /sender got back 600/.test(lres()) && /recipient holds 600/.test(lres()) && /hands Sender 600 tokens/.test(lres()), lres());
  p.d.getElementById("f-cancelable").checked = false; p.d.getElementById("run").click();
  check("library: a lock that is not cancelable refuses the cancel", /cancel refused/.test(lres()) && /recipient holds 1200/.test(lres()), lres());
  p.d.querySelector('[data-id="hooks"]').click();
  check("library: hooks take a 1% fee", /fee hook: kept 10/.test(lres()) && /received 990/.test(lres()), lres());
  type(p.w, p.d.getElementById("f-amount"), "9000"); p.d.getElementById("run").click();
  check("library: the limit hook blocks and everything comes back", /tokens returned: 9000/.test(lres()) && /nothing arrived/.test(lres()), lres());
  p.d.querySelector('[data-id="launchhooks"]').click();
  check("library: launch hooks split the fee and flag the sniper", /creator 0 platform 250 pool 250/.test(lres()) && /buy in block 1 flagged/.test(lres()) && /holder reward 500/.test(lres()) && /burned 69300 locked 29700/.test(lres()), lres());
  check("library: launch hooks say what they are modelled on", !p.d.getElementById("c-basis").hidden && p.d.querySelector("#c-basis a").href === "https://higher.fun/docs" && /not higher.fun's code/.test(p.d.getElementById("c-basis").textContent));
  p.d.getElementById("f-creator_keeps").checked = true; type(p.w, p.d.getElementById("f-sniper_window"), "0"); p.d.getElementById("run").click();
  check("library: creator keeping their share changes the split", /creator 250 platform 250 pool 250/.test(lres()) && /holder reward 100/.test(lres()) && /holder reward 150/.test(lres()), lres());
  p.d.querySelector('[data-id="stockrewards"]').click();
  check("library: stock rewards buy and split by holdings", /sold 20 units for 4800/.test(lres()) && /received 12 units/.test(lres()) && /received 8 units/.test(lres()) && /hands Stock desk 4800 cash/.test(lres()) && /hands First holder 12 units of stock/.test(lres()), lres());
  type(p.w, p.d.getElementById("f-stock_price"), "340"); p.d.getElementById("run").click();
  check("library: stock rewards refuse a price above the limit", /above the limit of 300/.test(lres()) && /carried to next round 5000/.test(lres()), lres());
  p.d.querySelector('[data-id="vesting"]').click();
  check("library: a utility without porting notes hides that box", p.d.getElementById("port-box").hidden && p.d.getElementById("c-basis").hidden && /beneficiary holds 1000/.test(lres()));
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
  p.d.getElementById("run").click();
  check("library: pressing Run shows that it ran", /^Ran just now \(run \d+\)$/.test(p.d.getElementById("ran").textContent) && p.d.getElementById("result").classList.contains("flash"), p.d.getElementById("ran").textContent);
  check("library: the bug-hunt result sits right under the buttons", p.d.querySelector(".go").nextElementSibling.id === "hunt-out" && p.d.getElementById("hunt").textContent === "Try to break it" && !p.d.getElementById("hunt").classList.contains("busy"));
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

  // Fuzzing page
  p = load("docs/fuzz/index.html", "https://example.test/fuzz/");
  const fz = JSON.parse(fs.readFileSync("fuzz/data.json", "utf8"));
  check("fuzz: shows the five kinds with their counts", p.d.querySelectorAll("#kinds li").length === 5 && p.d.querySelector("#kinds .n").textContent === String(fz.findings.disagreement));
  check("fuzz: names the commit and the seed", p.d.getElementById("against").textContent.includes(fz.phil.commit) && p.d.getElementById("against").textContent.includes(String(fz.seed)));
  check("fuzz: publishes no inputs", !/component main|bytes \(hex\)/.test(fs.readFileSync("docs/fuzz/index.html", "utf8").replace(/<style[\s\S]*?<\/style>/, "").split("<script>")[0]) && !fs.readFileSync("fuzz/data.json", "utf8").includes("main.phil"));
  check("fuzz: no script errors", p.errors.length === 0, p.errors.join("|"));

  // On chain
  p = load("docs/onchain/index.html", "https://example.test/onchain/");
  const oc = JSON.parse(fs.readFileSync("onchain/deployment.json", "utf8"));
  check("onchain: shows what the program returned", p.d.querySelector("#facts b").textContent === String((oc.devnet.run || oc.local.run).returned));
  check("onchain: links the program and the transaction on the explorer when deployed", !oc.devnet.run || ([...p.d.querySelectorAll("#addr a")].some((a) => a.href === `https://explorer.solana.com/address/${oc.devnet.programId}?cluster=devnet`) && [...p.d.querySelectorAll("#addr a")].some((a) => a.href.includes("/tx/" + oc.devnet.run.signature))));
  check("onchain: shows the log, the Phil source and philc's LLVM", /Phil main returned/.test(p.d.getElementById("log").textContent) && /component main provides U32/.test(p.d.getElementById("src-phil").textContent) && /define i32 @main\(\)/.test(p.d.getElementById("src-ll").textContent) && /phil_main/.test(p.d.getElementById("src-c").textContent));
  check("onchain: no key material is published", !/\[\s*\d+\s*,\s*\d+\s*,\s*\d+|seed phrase|^([a-z]+ ){11}[a-z]+$/m.test(fs.readFileSync("onchain/deployment.json", "utf8") + fs.readFileSync("onchain/build.tail.log", "utf8")));
  {
    // The button builds a transaction by hand and asks a node to simulate it. Stand in for the node.
    let asked = null;
    p.w.fetch = async (url, init) => { asked = { url, body: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ result: { context: { slot: 123456 }, value: { err: null, unitsConsumed: 217, logs: oc.devnet.run.logs } } }) }; };
    p.d.getElementById("call").click(); await wait(30);
    const tx = Buffer.from(asked.body.params[0], "base64");
    const web3 = require("@solana/web3.js");
    const want = new web3.Transaction({ feePayer: new web3.PublicKey(oc.devnet.wallet), recentBlockhash: "11111111111111111111111111111111" }).add(new web3.TransactionInstruction({ programId: new web3.PublicKey(oc.devnet.programId), keys: [], data: Buffer.alloc(0) })).serialize({ requireAllSignatures: false, verifySignatures: false });
    check("onchain: the button asks devnet to simulate, unsigned", asked.url === "https://api.devnet.solana.com" && asked.body.method === "simulateTransaction" && asked.body.params[1].sigVerify === false && asked.body.params[1].replaceRecentBlockhash === true);
    check("onchain: the hand-built transaction is byte-for-byte what Solana's own library builds", want.equals(tx), `${tx.length} vs ${want.length}`);
    check("onchain: the answer is shown with the value, the units and the log", !p.d.getElementById("call-out").hidden && /returned 42 using 217 compute units, at slot 123,456/.test(p.d.getElementById("call-verdict").textContent) && /Phil main returned/.test(p.d.getElementById("call-log").textContent) && /call 1/.test(p.d.getElementById("call-note").textContent) && p.d.getElementById("call").textContent === "Call it again");
    p.w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ result: { context: { slot: 1 }, value: { err: "ProgramAccountNotFound", logs: [] } } }) });
    p.d.getElementById("call").click(); await wait(30);
    check("onchain: a missing program is explained, not shown as a result", /not on devnet right now/.test(p.d.getElementById("call-verdict").textContent) && p.d.getElementById("call-verdict").classList.contains("bad"));
    p.w.fetch = async () => { throw new Error("offline"); };
    p.d.getElementById("call").click(); await wait(30);
    check("onchain: being offline is explained", /Could not reach Solana devnet/.test(p.d.getElementById("call-verdict").textContent));
    check("onchain: the nightly record lists each night with its transaction", p.d.querySelectorAll("#nights li").length === JSON.parse(fs.readFileSync("onchain/history.json", "utf8")).length && /nights? passed/.test(p.d.getElementById("night-lead").textContent));
  }
  check("onchain: no script errors", p.errors.length === 0, p.errors.join("|"));

  // The tour
  p = load("docs/tour/index.html", "https://example.test/tour/");
  {
    const parts = [...p.d.querySelectorAll(".part")];
    check("tour: twenty sections, each linked to Phil's own tour, with a program wherever the tour has code", p.d.querySelectorAll(".stop").length === 20 && parts.length === 20 && p.d.querySelectorAll("#jump a").length === 20 && [...p.d.querySelectorAll(".stop a.orig")].every((a) => a.href.startsWith("https://github.com/abiggerhammer/phil/blob/main/docs/tutorials/tour-phase1.md#")) && p.d.querySelector(".stop a.orig").href.endsWith("#1-a-first-phil-component"));
    const runPart = (key) => { const el = parts.find((x) => x.dataset.key === key); el.querySelector(".run").click(); return el; };
    let el = runPart("1.0");
    check("tour: a program runs in the page and shows what it printed", /Ran to completion/.test(el.querySelector(".out").textContent) && /a Phil component ran/.test(el.querySelector(".out").textContent) && /Ran just now \(1\)/.test(el.querySelector(".note").textContent));
    el = runPart("5.0");
    check("tour: declarations are checked and said to be valid", /Valid Phil/.test(el.querySelector(".out").textContent) && el.querySelector(".run").textContent === "Check it");
    el = runPart("14.0");
    check("tour: a program Phil refuses shows the refusal as the point", /Ownership error/.test(el.querySelector(".out").textContent) && /Phil refuses it/.test(el.querySelector(".out").textContent));
    el = parts.find((x) => x.dataset.key === "13.0");
    el.querySelector(".run").click();
    const refused = /promise was broken/.test(el.querySelector(".out").textContent);
    type(p.w, el.querySelector(".inputs input"), "5"); el.querySelector(".run").click();
    check("tour: inputs can be changed, and a value that meets the type's condition is let in", refused && /Ran to completion/.test(el.querySelector(".out").textContent) && /hands back 5/.test(el.querySelector(".out").textContent));
    check("tour: the one place we differ from the tour is said out loud", /difference from the tour/.test(parts.find((x) => x.dataset.key === "3.2").textContent) && /gt\(i, 1\)/.test(parts.find((x) => x.dataset.key === "3.2").textContent));
    check("tour: finished sections are marked in the strip", p.d.querySelector('#jump a[data-n="1"]').classList.contains("ran") && !p.d.querySelector('#jump a[data-n="2"]').classList.contains("ran"));
    check("tour: no script errors", p.errors.length === 0, p.errors.join("|"));
  }
  check("playground: offers the release package's examples and a link that opens them", /data-rel="scalar"/.test(fs.readFileSync("docs/playground/index.html", "utf8")) && /No Mac\? No install\./.test(fs.readFileSync("docs/playground/index.html", "utf8")));

  // Phil at both ends
  p = load("docs/session/index.html", "https://example.test/session/");
  {
    const web3 = require("@solana/web3.js");
    const program = JSON.parse(fs.readFileSync("giveaway/program.json", "utf8"));
    const sent = [];
    const node = (logs, err = null) => async (url, init) => { const q = JSON.parse(init.body); sent.push(web3.Transaction.from(Buffer.from(q.params[0], "base64")).instructions[0]); return { ok: true, status: 200, json: async () => ({ result: { context: { slot: 77 }, value: { err, unitsConsumed: 4321, logs: logs.map((l) => "Program log: " + l) } } }) }; };
    const OK = ["Phil: UploadServer started", "Phil: Hello recognized", "Phil: version agreed", "Phil: Begin recognized", "Phil: policy passed, proceed", "Phil: payload received, exactly the declared length", "Phil: SHA-256 matches the declared digest", "Phil note: received and validated. Its length:", "Phil: ACCEPTED"];
    const run = async (mode, logs, err) => { p.w.fetch = node(logs, err); if (mode) p.d.querySelector(`#modes button[data-mode="${mode}"]`).click(); p.d.getElementById("go").click(); for (let i = 0; i < 40 && (p.d.getElementById("go").classList.contains("busy") || p.d.getElementById("out").hidden); i++) await wait(25); await wait(25); };
    p.d.getElementById("msg").value = "hello from the test";
    await run(null, OK);
    const data = sent[0].data, text = Buffer.from("hello from the test");
    const digest = require("crypto").createHash("sha256").update(text).digest();
    const expected = Buffer.concat([Buffer.from([4]), Buffer.from("5048494c0101000400010001", "hex"), Buffer.from("5048494c01020035", "hex"), Buffer.from("0000000000000013", "hex"), Buffer.from([11]), Buffer.from("phil-note/1"), Buffer.from([1]), digest, Buffer.from([1]), text]);
    check("session: Phil's client, running in the page, produces a correct upload and it is sent to the giveaway program", sent[0].programId.toBase58() === program.programId && sent[0].keys.length === 0 && data.equals(expected), data.toString("hex"));
    check("session: both sides' steps are shown as one conversation, ending in accepted", /Session complete/.test(p.d.getElementById("verdict").textContent) && p.d.querySelectorAll("#talk li.client").length >= 8 && p.d.querySelectorAll("#talk li.server").length === OK.length && p.d.querySelectorAll("#talk li.wire").length === 1 && /4321 compute units/.test(p.d.getElementById("go-note").textContent) && [...p.d.querySelectorAll("#talk li")].map((li) => li.className.split(" ")[0])[0] === "client", p.d.getElementById("verdict").textContent);
    await run("tamper", OK.slice(0, 6).concat("Phil: REJECTED, the bytes do not match the declared digest"), { InstructionError: [0, { Custom: 1201 }] });
    check("session: a byte changed on the way is really changed, and both sides end in rejected", sent[1].data.length === data.length && sent[1].data[data.length - 1] === (data[data.length - 1] ^ 1) && sent[1].data.subarray(0, -1).equals(data.subarray(0, -1)) && /rejected the upload/.test(p.d.getElementById("verdict").textContent) && [...p.d.querySelectorAll("#talk li.client")].some((li) => /is told: rejected/.test(li.textContent)));
    await run("version", ["Phil: UploadServer started", "Phil: Hello recognized", "Phil: no protocol version in common"], { InstructionError: [0, { Custom: 1300 }] });
    check("session: a client that only speaks version 7 offers 7, and ends at no common version", sent[2].data.subarray(1, 13).toString("hex") === "5048494c0101000400010007" && /no protocol version in common/.test(p.d.getElementById("verdict").textContent) && ![...p.d.querySelectorAll("#talk li.client")].some((li) => /sends Begin/.test(li.textContent)));
    await run("cancel", OK.slice(0, 5).concat("Phil: the client cancelled"), { InstructionError: [0, { Custom: 1500 }] });
    check("session: a client that cancels sends the cancel byte and no payload", sent[3].data[sent[3].data.length - 1] === 0 && sent[3].data.length === data.length - text.length && /cancelled/.test(p.d.getElementById("verdict").textContent));
    p.w.fetch = async () => { throw new Error("offline"); };
    p.d.getElementById("go").click(); await wait(120);
    check("session: being offline is explained", /Could not reach Solana devnet/.test(p.d.getElementById("verdict").textContent));
    check("session: no script errors", p.errors.length === 0, p.errors.join("|"));
  }

  // Giveaways
  p = load("docs/giveaway/index.html", "https://example.test/giveaway/");
  check("giveaway: the page loads and says where Phil is", /UploadServer/.test(p.d.getElementById("phil-lead").textContent) && /46 signatures/.test(p.d.getElementById("p-facts").textContent) && p.errors.length === 0, p.errors.join("|"));
  {
    const dir = "giveaway/draws";
    const draws = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => f.endsWith(".json") && !f.endsWith(".pending.json")).map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"))).sort((a, b) => b.lock.time - a.lock.time);
    const g = draws.find((x) => x.winners.length > 0);
    if (!g) check("giveaway: with no draws the page says so", !p.d.getElementById("none").hidden && p.d.getElementById("card").hidden);
    else {
      const web3 = require("@solana/web3.js");
      check("giveaway: shows the latest draw, its winners and the entries", p.d.getElementById("g-title").textContent === draws[0].title && (draws[0] !== g || (p.d.querySelectorAll("#g-winners b").length === g.winners.length && p.d.querySelector("#g-winners b").textContent === g.winners[0].entry && p.d.querySelectorAll("#entries li").length === g.entries.length && p.d.querySelectorAll("#entries li.won").length === g.winners.length)));
      if (draws[0] !== g) { const b = [...p.d.querySelectorAll("#pick button")].find((x) => x.dataset.id === g.id); b.click(); }
      check("giveaway: links the account and both transactions on the explorer", [g.account, g.lock.signature, g.draw.signature].every((id) => [...p.d.querySelectorAll("#g-facts a")].some((a) => a.href.includes(id) && a.href.endsWith("?cluster=devnet"))));
      // Stand in for the Solana node: the account as the chain holds it, and a simulation answer.
      const account = Buffer.alloc(256);
      account.write("PHILDRAW", 0); account[8] = 2; account[9] = g.kind; account[10] = g.winnerCount; account[11] = Buffer.byteLength(g.title);
      account.writeUInt32LE(g.entries.length, 12); account.writeUInt32LE(g.delaySlots, 16); account.writeUInt32LE(g.payloadLength, 20);
      account.writeBigUInt64LE(BigInt(g.lock.slot), 24); account.writeBigUInt64LE(BigInt(g.lock.time), 32); account.writeBigUInt64LE(BigInt(g.draw.targetSlot), 40);
      Buffer.from(g.payloadDigest, "hex").copy(account, 48); Buffer.from(g.listDigest, "hex").copy(account, 80);
      account.writeBigUInt64LE(BigInt(g.draw.hashSlot), 112); Buffer.from(g.draw.slotHash, "hex").copy(account, 120); Buffer.from(g.draw.randomness, "hex").copy(account, 152);
      account.writeBigUInt64LE(BigInt(g.winners[0].index), 184); account.write(g.title, 192);
      const asked = [];
      const node = (data, logs, err = null) => async (url, init) => {
        const q = JSON.parse(init.body); asked.push(q);
        if (q.method === "getAccountInfo") return { ok: true, status: 200, json: async () => ({ result: { context: { slot: 9 }, value: { data: [data.toString("base64"), "base64"], owner: g.program } } }) };
        return { ok: true, status: 200, json: async () => ({ result: { context: { slot: 9 }, value: { err, unitsConsumed: 2109, logs } } }) };
      };
      const accepted = ["Program log: Phil: UploadServer started", "Program log: Phil: SHA-256 matches the declared digest", "Program log: Phil draw: this is byte for byte the giveaway that is locked", "Program log: Phil: ACCEPTED"];
      const rejected = ["Program log: Phil: UploadServer started", "Program log: Phil: payload received, exactly the declared length", "Program log: Phil: REJECTED, the bytes do not match the declared digest"];
      p.w.fetch = node(account, accepted);
      p.d.getElementById("verify").click(); await wait(60);
      check("giveaway: checking reads the account, redoes the draw and asks Phil; every check passes", p.d.querySelectorAll("#checks li").length === 8 && p.d.querySelectorAll("#checks li.no").length === 0 && /won fairly/.test(p.d.getElementById("verify-verdict").textContent) && asked[0].method === "getAccountInfo" && asked[0].params[0] === g.account, p.d.getElementById("checks").textContent);
      const sim = asked.find((q) => q.method === "simulateTransaction");
      const tx = web3.Transaction.from(Buffer.from(sim.params[0], "base64"));
      check("giveaway: the question to Phil is a well-formed call to the giveaway program about this account", tx.instructions.length === 1 && tx.instructions[0].programId.toBase58() === g.program && tx.instructions[0].keys[0].pubkey.toBase58() === g.account && !tx.instructions[0].keys[0].isWritable && tx.instructions[0].data[0] === 3 && tx.instructions[0].data.slice(1, 5).toString() === "PHIL");
      const forged = Buffer.from(account); forged.writeBigUInt64LE(BigInt((g.winners[0].index + 1) % g.entries.length), 184);
      p.w.fetch = node(forged, accepted);
      p.d.getElementById("verify").click(); await wait(60);
      check("giveaway: a record that names a different winner from the chain's arithmetic is called out", p.d.querySelectorAll("#checks li.no").length >= 1 && /Do not trust/.test(p.d.getElementById("verify-verdict").textContent));
      p.w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ result: { context: { slot: 9 }, value: null } }) });
      p.d.getElementById("verify").click(); await wait(60);
      check("giveaway: a missing account is explained", /not on devnet/.test(p.d.getElementById("checks").textContent));
      // Try to cheat.
      const ta = p.d.getElementById("tamper");
      check("giveaway: the cheat box starts with the locked list", ta.value === g.entries.join("\n"));
      asked.length = 0; p.w.fetch = node(account, rejected, { InstructionError: [0, { Custom: 1201 }] });
      ta.value = [...g.entries.slice(0, -1), "@me_instead"].join("\n");
      p.d.getElementById("ask").click(); await wait(60);
      const cheat = web3.Transaction.from(Buffer.from(asked[0].params[0], "base64")).instructions[0].data;
      check("giveaway: an altered list is sent under the locked fingerprint, and Phil's refusal is shown step by step", cheat.includes(Buffer.from(g.payloadDigest, "hex")) && cheat.includes(Buffer.from("@me_instead")) && /not the ones that were declared/.test(p.d.getElementById("ask-verdict").textContent) && p.d.querySelectorAll("#ask-steps li.bad").length === 1 && p.d.getElementById("ask-verdict").classList.contains("bad"));
      p.w.fetch = node(account, accepted);
      p.d.getElementById("reset").click(); p.d.getElementById("ask").click(); await wait(60);
      check("giveaway: the real list is accepted", /real list, unchanged/.test(p.d.getElementById("ask-verdict").textContent) && p.d.getElementById("ask-verdict").classList.contains("good"));
      type(p.w, p.d.getElementById("find"), g.entries[1].slice(1, 4));
      check("giveaway: the entries can be searched", [...p.d.querySelectorAll("#entries li")].filter((li) => !li.hidden).length >= 1 && [...p.d.querySelectorAll("#entries li")].filter((li) => !li.hidden).length < g.entries.length);
      check("giveaway: no script errors", p.errors.length === 0, p.errors.join("|"));
    }
  }

  // Token locker
  p = load("docs/locker/index.html", "https://example.test/locker/");
  check("locker: the page loads and is plain about its limits", /has not been audited/.test(p.d.getElementById("limits").textContent) && /can still be replaced/.test(p.d.getElementById("upgrade-note").textContent) && /no third/i.test(p.d.getElementById("p-facts").textContent) && p.errors.length === 0, p.errors.join("|"));
  if (fs.existsSync("locker/program.json")) {
    const web3 = require("@solana/web3.js");
    const program = JSON.parse(fs.readFileSync("locker/program.json", "utf8")).programId;
    const me = web3.Keypair.generate(), mint = web3.Keypair.generate().publicKey, friend = web3.Keypair.generate().publicKey;
    const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", now = Math.floor(Date.now() / 1000);
    const mintData = Buffer.alloc(82); mintData.writeBigUInt64LE(1000000000000000n, 36); mintData[44] = 6; mintData[45] = 1;
    const lockBytes = (o) => { const d = Buffer.alloc(320); d.write("PHILLOCK", 0); d[8] = o.state; d[9] = 254; d[10] = 6; d[11] = Buffer.byteLength(o.label); d.writeBigUInt64LE(o.amount, 16); d.writeBigInt64LE(BigInt(o.unlock), 24); d.writeBigUInt64LE(BigInt(now - 86400), 40);
      mint.toBuffer().copy(d, 64); o.escrow.toBuffer().copy(d, 96); o.to.toBuffer().copy(d, 128); me.publicKey.toBuffer().copy(d, 160); new web3.PublicKey(TOKEN).toBuffer().copy(d, 192); d.write(o.label, 256); return d; };
    const ready = { key: web3.Keypair.generate().publicKey, escrow: web3.Keypair.generate().publicKey };
    const rows = [{ pubkey: web3.Keypair.generate().publicKey.toBase58(), account: { data: [lockBytes({ state: 1, label: "Team tokens", amount: 200000000000000n, unlock: now + 90 * 86400, escrow: web3.Keypair.generate().publicKey, to: me.publicKey }).toString("base64"), "base64"] } },
      { pubkey: ready.key.toBase58(), account: { data: [lockBytes({ state: 1, label: "Marketing", amount: 50000000000000n, unlock: now - 60, escrow: ready.escrow, to: friend }).toString("base64"), "base64"] } }];
    const calls = [];
    p.w.fetch = async (url, init) => {
      const q = JSON.parse(init.body); calls.push(q);
      const result = { getAccountInfo: { value: { data: [mintData.toString("base64"), "base64"], owner: TOKEN } }, getProgramAccounts: rows, getTokenAccountBalance: { value: { amount: "400000000000000" } }, getLatestBlockhash: { value: { blockhash: web3.Keypair.generate().publicKey.toBase58() } },
        getMinimumBalanceForRentExemption: 3118080, sendTransaction: "5".repeat(88), getSignatureStatuses: { value: [{ confirmationStatus: "confirmed", err: null }] } }[q.method];
      return { ok: true, status: 200, json: async () => ({ result }) };
    };
    const settle = async (el) => { for (let i = 0; i < 60 && el.classList.contains("busy"); i++) await wait(25); await wait(40); };
    p.d.getElementById("coin").value = mint.toBase58(); p.d.getElementById("find").click(); await settle(p.d.getElementById("find"));
    const gpa = calls.find((q) => q.method === "getProgramAccounts");
    check("locker: checking a coin asks Solana for this program's locks of that coin, with no wallet", gpa.params[0] === program && gpa.params[1].filters[0].dataSize === 320 && gpa.params[1].filters[1].memcmp.offset === 64 && gpa.params[1].filters[1].memcmp.bytes === mint.toBase58());
    check("locker: each lock shows amount, share of supply, date, and where it goes", p.d.querySelectorAll("#locks .lock").length === 2 && /250,000,000/.test(p.d.getElementById("summary").textContent) && /25% of its supply/.test(p.d.getElementById("summary").textContent) && /20% of supply/.test(p.d.querySelector("#locks .lock").textContent) && /Team tokens/.test(p.d.querySelector("#locks .lock").textContent) && /in 89 days|in 90 days/.test(p.d.querySelector("#locks .lock .count").textContent) && p.d.querySelectorAll("#locks .st.ready").length === 1 && p.d.querySelectorAll("#locks button.release").length === 1);
    // Locking, with a stand-in wallet that signs like a real one.
    p.w.phantom = { solana: { connect: async () => ({ publicKey: me.publicKey }), signTransaction: async (tx) => { tx.partialSign(me); return tx; } } };
    p.d.getElementById("connect").click(); await wait(80);
    check("locker: connecting a wallet opens the form, with the wallet as the receiver and its balance shown", !p.d.getElementById("form").hidden && p.d.getElementById("m-to").value === me.publicKey.toBase58() && /holds 400,000,000/.test(p.d.getElementById("m-have").textContent));
    const set = (id, v) => { p.d.getElementById(id).value = v; };
    set("m-amount", "999,999,999,999"); p.d.getElementById("review-go").click(); await wait(60);
    check("locker: more than the wallet holds is refused before anything is signed", p.d.getElementById("review").classList.contains("bad") && /less than that/.test(p.d.getElementById("review").textContent) && p.d.getElementById("lock-go").hidden);
    set("m-amount", "1,500,000.5"); set("m-label", "Test lock"); p.d.querySelector('#quick button[data-d="30"]').click(); p.d.getElementById("review-go").click(); await wait(60);
    check("locker: the review says what will happen in plain words and needs a tick before the button works", /1,500,000\.5/.test(p.d.getElementById("review").textContent) && /your own wallet/.test(p.d.getElementById("review").textContent) && !p.d.getElementById("lock-go").hidden && p.d.getElementById("lock-go").disabled);
    p.d.getElementById("agree").checked = true; p.d.getElementById("agree").dispatchEvent(new p.w.Event("change"));
    p.d.getElementById("lock-go").click(); for (let i = 0; i < 80 && !calls.some((q) => q.method === "getSignatureStatuses"); i++) await wait(25); await wait(120);
    const sent = web3.Transaction.from(Buffer.from(calls.find((q) => q.method === "sendTransaction").params[0], "base64"));
    const lockIx = sent.instructions[2], lockKey = sent.instructions[0].keys[1].pubkey;
    const [authority, bump] = web3.PublicKey.findProgramAddressSync([Buffer.from("lock"), lockKey.toBuffer()], new web3.PublicKey(program));
    const rec = lockIx.data.subarray(lockIx.data.length - (55 + 9));
    check("locker: the transaction makes the lock account, its escrow, and the lock, and is fully signed", sent.instructions.length === 3 && sent.instructions[0].programId.equals(web3.SystemProgram.programId) && sent.instructions[1].programId.toBase58() === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" && sent.instructions[1].keys[2].pubkey.equals(authority) && lockIx.programId.toBase58() === program && sent.verifySignatures() && sent.signatures.length === 2 && sent.feePayer.equals(me.publicKey));
    check("locker: the terms sent are the terms reviewed", lockIx.data[0] === 1 && rec.subarray(0, 5).toString() === "LOCK1" && rec.readBigUInt64LE(5) === 1500000500000n && Math.abs(Number(rec.readBigInt64LE(13)) - (now + 30 * 86400)) < 120 && rec.subarray(21, 53).equals(me.publicKey.toBuffer()) && rec[53] === bump && rec.subarray(55).toString() === "Test lock" && lockIx.keys[4].pubkey.equals(me.publicKey) && lockIx.keys[4].isSigner && lockIx.keys[1].pubkey.equals(mint));
    check("locker: after Solana confirms, the page gives a proof link for the coin", /Locked\./.test(p.d.getElementById("done").textContent) && p.d.querySelector("#done a[href*='?coin=']").getAttribute("href").endsWith("?coin=" + mint.toBase58()));
    // Releasing the lock that is ready.
    calls.length = 0; p.d.querySelector("#locks button.release").click(); for (let i = 0; i < 80 && !calls.some((q) => q.method === "getSignatureStatuses"); i++) await wait(25); await wait(80);
    const rel = web3.Transaction.from(Buffer.from(calls.find((q) => q.method === "sendTransaction").params[0], "base64"));
    const relIx = rel.instructions[1];
    check("locker: releasing sends the coins only to the named receiver's own token account", rel.instructions.length === 2 && rel.instructions[0].keys[2].pubkey.equals(friend) && relIx.programId.toBase58() === program && relIx.data[0] === 2 && relIx.keys[0].pubkey.equals(ready.key) && relIx.keys[2].pubkey.equals(ready.escrow) && relIx.keys[3].pubkey.equals(rel.instructions[0].keys[1].pubkey) && rel.verifySignatures());
    check("locker: no script errors", p.errors.length === 0, p.errors.join("|"));
  }

  // My coin: the launch kit, and a giveaway page read from Solana alone
  p = load("docs/coin/index.html", "https://example.test/coin/");
  check("my coin: the page loads, is plain about its limits and names the three programs", /has not been audited/.test(p.d.getElementById("limits").textContent) && /Anyone can open a vault for any coin/.test(p.d.getElementById("limits").textContent) && /does not hold or send a prize/.test(p.d.getElementById("limits").textContent) && p.d.querySelectorAll("#p-facts li").length === 4 && p.d.getElementById("kit").hidden && p.errors.length === 0, p.errors.join("|"));
  if (["locker", "burn", "giveaway"].every((d) => fs.existsSync(d + "/program.json"))) {
    const web3 = require("@solana/web3.js"), crypto = require("crypto"), bs58 = require("bs58");
    const b58 = (b) => (bs58.default ?? bs58).encode(b);
    const sha = (...parts) => crypto.createHash("sha256").update(Buffer.concat(parts)).digest();
    const P = Object.fromEntries(["locker", "burn", "giveaway"].map((d) => [d, JSON.parse(fs.readFileSync(d + "/program.json", "utf8")).programId]));
    const me = web3.Keypair.generate(), mint = web3.Keypair.generate().publicKey;
    const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", now = Math.floor(Date.now() / 1000);
    const mintData = Buffer.alloc(82); mintData.writeBigUInt64LE(1000000000000000n, 36); mintData[44] = 6; mintData[45] = 1;
    const lockBytes = (o) => { const d = Buffer.alloc(320); d.write("PHILLOCK", 0); d[8] = 1; d[9] = 254; d[10] = 6; d[11] = Buffer.byteLength(o.label); d.writeBigUInt64LE(o.amount, 16); d.writeBigInt64LE(BigInt(o.unlock), 24); d.writeBigUInt64LE(BigInt(now - 86400), 40);
      mint.toBuffer().copy(d, 64); me.publicKey.toBuffer().copy(d, 128); me.publicKey.toBuffer().copy(d, 160); d.write(o.label, 256); return d; };
    const vaultBytes = (o) => { const d = Buffer.alloc(256); d.write("PHILBURN", 0); d[8] = 1; d[9] = Buffer.byteLength(o.label); d.writeBigUInt64LE(o.threshold, 16); d.writeBigUInt64LE(2672640n, 24); mint.toBuffer().copy(d, 32);
      d.writeBigUInt64LE(BigInt(o.burns), 80); d.writeBigUInt64LE(BigInt(o.burns) * o.threshold, 88); d.writeBigUInt64LE(o.paid, 96); d.write(o.label, 160); return d; };
    const vaultKey = web3.Keypair.generate().publicKey;
    const lockRows = [{ pubkey: web3.Keypair.generate().publicKey.toBase58(), account: { data: [lockBytes({ label: "Team tokens", amount: 250000000000000n, unlock: now + 90 * 86400 }).toString("base64"), "base64"], lamports: 3118080 } }];
    const vaultRows = [{ pubkey: vaultKey.toBase58(), account: { data: [vaultBytes({ label: "Creator fees", threshold: 1000000000000n, burns: 3, paid: 30000000n }).toString("base64"), "base64"], lamports: 2672640 + 250000000 } }];
    const drawState = { bytes: null, slot: 1000 };
    const calls = []; let held = "400000000000000";
    const node = (extra = {}) => async (url, init) => {
      const q = JSON.parse(init.body); calls.push(q);
      const table = { getProgramAccounts: () => (q.params[0] === P.locker ? lockRows : q.params[0] === P.burn ? vaultRows : []),
        getAccountInfo: () => (q.params[0] === mint.toBase58() ? { value: { data: [mintData.toString("base64"), "base64"], owner: TOKEN } } : { value: drawState.bytes ? { data: [drawState.bytes.toString("base64"), "base64"], owner: P.giveaway } : null }),
        getTokenAccountBalance: () => ({ value: { amount: held } }), getLatestBlockhash: () => ({ value: { blockhash: web3.Keypair.generate().publicKey.toBase58() } }),
        getMinimumBalanceForRentExemption: () => 2672640, sendTransaction: () => "5".repeat(88), getSignatureStatuses: () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }), getSlot: () => drawState.slot, ...extra };
      const result = table[q.method] ? table[q.method](q) : null;
      return { ok: true, status: 200, json: async () => ({ result }) };
    };
    p.w.fetch = node();
    const el = (id) => p.d.getElementById(id), set = (id, v) => { el(id).value = v; };
    const settle = async (b) => { for (let i = 0; i < 80 && b.classList.contains("busy"); i++) await wait(25); await wait(60); };
    const sentAfter = async (from) => { for (let i = 0; i < 120 && !calls.slice(from).some((q) => q.method === "getSignatureStatuses"); i++) await wait(25); await wait(160); return web3.Transaction.from(Buffer.from(calls.slice(from).find((q) => q.method === "sendTransaction").params[0], "base64")); };
    set("coin", mint.toBase58()); el("open").click(); await settle(el("open"));
    const gpa = calls.filter((q) => q.method === "getProgramAccounts");
    check("my coin: opening a coin reads its locks and its vaults from Solana, with no wallet", gpa.length === 2 && gpa[0].params[0] === P.locker && gpa[0].params[1].filters[0].dataSize === 320 && gpa[0].params[1].filters[1].memcmp.offset === 64 && gpa[1].params[0] === P.burn && gpa[1].params[1].filters[0].dataSize === 256 && gpa[1].params[1].filters[1].memcmp.offset === 32 && gpa[1].params[1].filters[1].memcmp.bytes === mint.toBase58());
    check("my coin: three numbers sum the coin up", !el("kit").hidden && el("t-locked").textContent === "25%" && /250,000,000 in 1 lock/.test(el("t-locked-sub").textContent) && el("t-pot").textContent === "0.25 SOL" && el("t-burned").textContent === "3,000,000" && /3 burns, paid 0.03 SOL/.test(el("t-burned-sub").textContent), [el("t-locked").textContent, el("t-locked-sub").textContent, el("t-pot").textContent, el("t-burned").textContent, el("t-burned-sub").textContent].join(" / "));
    check("my coin: the vault's rule and fee address are shown, and the link carries the coin", /burn 1,000,000 coins \(0.1% of supply\)/.test(el("vaults").textContent) && el("vaults").textContent.includes(vaultKey.toBase58()) && p.w.location.search === "?coin=" + mint.toBase58() && el("locks-link").getAttribute("href").endsWith("locker/?coin=" + mint.toBase58()), el("vaults").textContent);
    check("my coin: without a wallet there is nothing to sign", [...p.d.querySelectorAll("#kit [data-form]")].every((f) => f.hidden) && [...p.d.querySelectorAll("#kit [data-need]")].every((f) => !f.hidden) && !p.d.querySelector("#vaults button.burn"));
    p.w.phantom = { solana: { connect: async () => ({ publicKey: me.publicKey }), signTransaction: async (tx) => { tx.partialSign(me); return tx; } } };
    el("connect").click(); await wait(120);
    check("my coin: connecting a wallet opens the forms", [...p.d.querySelectorAll("#kit [data-form]")].every((f) => !f.hidden) && el("l-to").value === me.publicKey.toBase58() && /holds 400,000,000/.test(el("l-have").textContent) && !!p.d.querySelector("#vaults button.burn"));

    // Lock
    set("l-amount", "1,000,000"); set("l-label", "Kit lock"); p.d.querySelector('#l-quick button[data-d="30"]').click(); el("lock-review").click(); await wait(60);
    check("my coin: a lock is reviewed in words and needs a tick", /1,000,000/.test(el("lock-say").textContent) && /0.1% of supply/.test(el("lock-say").textContent) && !el("lock-go").hidden && el("lock-go").disabled);
    el("lock-agree").checked = true; el("lock-agree").dispatchEvent(new p.w.Event("change"));
    let from = calls.length; el("lock-go").click(); let tx = await sentAfter(from);
    check("my coin: the lock is the locker's own three-step transaction, fully signed", tx.instructions.length === 3 && tx.instructions[2].programId.toBase58() === P.locker && tx.instructions[2].data[0] === 1 && tx.verifySignatures() && tx.signatures.length === 2 && /Locked\./.test(el("lock-done").textContent));

    // Open a vault
    set("v-threshold", "5,000,000"); el("v-threshold").dispatchEvent(new p.w.Event("input")); set("v-label", "Kit vault");
    check("my coin: the burn amount is shown as a share of supply while typing", /0.5% of the supply/.test(el("v-pct").textContent));
    set("v-threshold", "2,000,000,000"); el("vault-review").click(); await wait(60);
    check("my coin: a rule nobody could ever meet is refused", el("vault-say").classList.contains("bad") && /more than the coin's whole supply/.test(el("vault-say").textContent) && el("vault-go").hidden);
    set("v-threshold", "5,000,000"); el("vault-review").click(); await wait(60);
    check("my coin: opening a vault says plainly that nothing can be withdrawn", /Nobody, including you, can change the rule or withdraw/.test(el("vault-say").textContent) && el("vault-go").disabled);
    el("vault-agree").checked = true; el("vault-agree").dispatchEvent(new p.w.Event("change"));
    from = calls.length; el("vault-go").click(); tx = await sentAfter(from);
    let ix = tx.instructions[1], rec = ix.data.subarray(ix.data.length - (5 + 32 + 8 + 1 + 9));
    check("my coin: the vault is made and opened in one transaction, with the reviewed rule", tx.instructions.length === 2 && tx.instructions[0].programId.equals(web3.SystemProgram.programId) && ix.programId.toBase58() === P.burn && ix.data[0] === 1 && ix.keys.length === 1 && ix.keys[0].pubkey.equals(tx.instructions[0].keys[1].pubkey) && rec.subarray(0, 5).toString() === "BURN1" && rec.subarray(5, 37).equals(mint.toBuffer()) && rec.readBigUInt64LE(37) === 5000000000000n && rec.subarray(46).toString() === "Kit vault" && tx.verifySignatures() && tx.signatures.length === 2);
    check("my coin: afterwards the page gives the new vault's fee address", el("vault-done").textContent.includes(tx.instructions[0].keys[1].pubkey.toBase58()));

    // Burn for the pot
    held = "500000000000"; await (async () => { set("coin", mint.toBase58()); el("open").click(); await settle(el("open")); })();
    p.d.querySelector("#vaults button.burn").click(); await wait(200);
    check("my coin: burning with too few coins is refused before anything is signed", el("burn-say").classList.contains("bad") && /Your wallet holds 500,000/.test(el("burn-say").textContent) && el("burn-go").hidden, el("burn-say").textContent);
    held = "400000000000000"; p.d.querySelector("#vaults button.burn").click(); await wait(200);
    check("my coin: the burn is reviewed: what is destroyed and what is received", /burn 1,000,000/.test(el("burn-say").textContent) && /0.25 SOL/.test(el("burn-say").textContent) && el("burn-go").disabled, el("burn-say").textContent);
    el("burn-agree").checked = true; el("burn-agree").dispatchEvent(new p.w.Event("change"));
    from = calls.length; el("burn-go").click(); tx = await sentAfter(from); ix = tx.instructions[0];
    const ata = web3.PublicKey.findProgramAddressSync([me.publicKey.toBuffer(), new web3.PublicKey(TOKEN).toBuffer(), mint.toBuffer()], new web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))[0];
    rec = ix.data.subarray(ix.data.length - 13);
    check("my coin: the burn names the vault, the coin, the wallet's own coins, and the least it accepts", tx.instructions.length === 1 && ix.programId.toBase58() === P.burn && ix.data[0] === 2 && ix.keys[0].pubkey.equals(vaultKey) && ix.keys[1].pubkey.equals(mint) && ix.keys[2].pubkey.equals(ata) && ix.keys[3].pubkey.equals(me.publicKey) && ix.keys[3].isSigner && ix.keys[4].pubkey.toBase58() === TOKEN && rec.subarray(0, 5).toString() === "BOFF1" && rec.readBigUInt64LE(5) === 250000000n && tx.verifySignatures());

    // Giveaway: lock, wait for the block, draw
    const names = ["@ana", "@bo", "@cy", "@di", "@ed"];
    set("g-title", "Kit giveaway"); set("g-entries", names.join("\n") + "\n@ANA\n"); set("g-winners", "2"); el("give-review").click(); await wait(60);
    check("my coin: a giveaway is reviewed: entries, repeats removed, winners", /5 entries \(1 repeat removed\)/.test(el("give-say").textContent.replace(/\s+/g, " ")) && /2 winners/.test(el("give-say").textContent) && /whole list goes on Solana/.test(el("give-say").textContent) && !el("give-go").hidden && !el("give-go").disabled, el("give-say").textContent);
    // The stand-in node plays the program: after the lock it holds a locked account, after the draw a drawn one.
    const payloadOf = (data) => { let at = 1; for (let i = 0; i < 2; i++) at += 8 + data.readUInt16BE(at + 6); return data.subarray(at + 1); };
    const drawBytes = (account, payload, state) => { const d = Buffer.alloc(256); d.write("PHILDRAW", 0); d[8] = state; d[9] = payload[5]; d[10] = payload[10]; d[11] = payload[15]; d.writeUInt32LE(payload.readUInt32LE(6), 12); d.writeUInt32LE(payload.readUInt32LE(11), 16); d.writeUInt32LE(payload.length, 20);
      d.writeBigUInt64LE(1000n, 24); d.writeBigUInt64LE(BigInt(now), 32); d.writeBigUInt64LE(1150n, 40); sha(payload).copy(d, 48); (payload[5] === 1 ? sha(payload.subarray(16 + payload[15])) : payload.subarray(16 + payload[15])).copy(d, 80); payload.subarray(16, 16 + payload[15]).copy(d, 192);
      if (state === 2) { const slotHash = sha(Buffer.from("a block")); d.writeBigUInt64LE(1151n, 112); slotHash.copy(d, 120); sha(sha(payload), slotHash, account.toBuffer()).copy(d, 152); }
      return d; };
    const expected = (d, count, winners) => { const out = []; for (let j = 0; out.length < winners; j++) { const k = Buffer.alloc(4); k.writeUInt32LE(j); const i = Number(sha(d.subarray(152, 184), k).readBigUInt64LE(0) % BigInt(count)); if (!out.includes(i)) out.push(i); } return out; };
    let account = null, payload = null, sends = 0;
    p.w.fetch = node({ sendTransaction: (q) => { const t = web3.Transaction.from(Buffer.from(q.params[0], "base64")); sends++;
      if (t.instructions.length === 2) { account = t.instructions[0].keys[1].pubkey; payload = Buffer.from(payloadOf(t.instructions[1].data)); drawState.bytes = drawBytes(account, payload, 1); drawState.slot = 1100; }
      else { drawState.bytes = drawBytes(account, payload, 2); }
      return "5".repeat(88); } });
    from = calls.length; el("give-go").click(); tx = await sentAfter(from); ix = tx.instructions[1];
    check("my coin: the giveaway's account is made and locked in one transaction, and the locked list is the cleaned one", tx.instructions.length === 2 && tx.instructions[0].programId.equals(web3.SystemProgram.programId) && ix.programId.toBase58() === P.giveaway && ix.data[0] === 1 && payload.subarray(0, 5).toString() === "DRAW1" && payload[5] === 1 && payload[10] === 2 && payload.readUInt32LE(11) === 150 && payload.subarray(16 + payload[15]).toString() === names.join("\n") && tx.verifySignatures() && tx.signatures.length === 2);
    await wait(300);
    check("my coin: after locking, the page counts down to the block and gives the link to share first", !el("g-run").hidden && /slot 1,150/.test(el("g-status").textContent) && el("g-draw").disabled && el("give-done").querySelector("a[href*='giveaway/?draw=']").getAttribute("href").endsWith("giveaway/?draw=" + account.toBase58()) && /before the draw/.test(el("give-done").textContent), el("g-status").textContent);
    drawState.slot = 1155; from = calls.length;
    for (let i = 0; i < 200 && sends < 2; i++) await wait(50); await wait(400);
    const drawTx = web3.Transaction.from(Buffer.from(calls.slice(from).find((q) => q.method === "sendTransaction").params[0], "base64"));
    const won = expected(drawState.bytes, 5, 2).map((i) => names[i]);
    check("my coin: once the block exists the page asks the wallet to draw, with the program's draw instruction", drawTx.instructions.length === 1 && drawTx.instructions[0].programId.toBase58() === P.giveaway && drawTx.instructions[0].data.length === 1 && drawTx.instructions[0].data[0] === 2 && drawTx.instructions[0].keys[0].pubkey.equals(account) && drawTx.instructions[0].keys[1].pubkey.toBase58() === "SysvarS1otHashes111111111111111111111111111" && drawTx.verifySignatures());
    check("my coin: the winners shown are the ones the block picked", [...p.d.querySelectorAll("#g-won b")].map((b) => b.textContent).join() === won.join() && /Drawn by the block at slot 1,151/.test(el("g-status").textContent) && !el("mine-wrap").hidden && /Kit giveaway/.test(el("mine").textContent), [...p.d.querySelectorAll("#g-won b")].map((b) => b.textContent).join() + " vs " + won.join());
    check("my coin: no script errors", p.errors.length === 0, p.errors.join("|"));

    // The giveaway's own page, made from Solana alone
    const lockTx = { meta: { logMessages: ["Program log: Phil: ACCEPTED"] }, transaction: { message: { accountKeys: [me.publicKey.toBase58(), account.toBase58(), "11111111111111111111111111111111", P.giveaway], instructions: [{ programIdIndex: 2, data: b58(Buffer.from([0])) }, { programIdIndex: 3, data: b58(tx.instructions[1].data) }] } } };
    const drawnTx = { meta: { logMessages: ["Program log: Phil draw: DRAWN. Block slot, then the winning entry's position (counting from 0):"] }, transaction: { message: { accountKeys: [me.publicKey.toBase58(), account.toBase58(), P.giveaway], instructions: [{ programIdIndex: 2, data: b58(Buffer.from([2])) }] } } };
    const chainNode = (bytes, txs) => async (url, init) => { const q = JSON.parse(init.body);
      const result = { getAccountInfo: { value: { data: [bytes.toString("base64"), "base64"], owner: P.giveaway } }, getSignaturesForAddress: Object.keys(txs).map((signature) => ({ signature, err: null })), getTransaction: txs[q.params[0]], getSlot: 1155 }[q.method];
      return { ok: true, status: 200, json: async () => ({ result }) }; };
    // jsdom runs the page's script before fetch can be replaced, so each page is loaded with the stand-in already in place.
    const loadWith = (url, fetcher) => { const errors = []; const dom = new JSDOM(fs.readFileSync("docs/giveaway/index.html", "utf8"), { runScripts: "dangerously", url, pretendToBeVisual: true, beforeParse(w) { w.addEventListener("error", (e) => errors.push(e.message)); w.scrollTo = () => {}; w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }); w.fetch = fetcher; } }); return { w: dom.window, d: dom.window.document, errors }; };
    let g = loadWith("https://example.test/giveaway/?draw=" + account.toBase58(), chainNode(drawState.bytes, { L: lockTx, D: drawnTx })); await wait(300);
    check("giveaway: a giveaway run from the website gets a page from its address alone", g.d.getElementById("g-title").textContent === "Kit giveaway" && [...g.d.querySelectorAll("#g-winners b")].map((b) => b.textContent).join() === won.join() && g.d.querySelectorAll("#entries li").length === 5 && /community giveaway/i.test(g.d.getElementById("community").textContent) && /not run by the maintainers/.test(g.d.getElementById("community").textContent) && g.d.getElementById("pick").hidden, g.d.getElementById("community").textContent);
    check("giveaway: it names the wallet that ran it and links both transactions", /Run by/.test(g.d.getElementById("g-facts").textContent) && !!g.d.querySelector("#g-facts a[href*='/tx/L']") && !!g.d.querySelector("#g-facts a[href*='/tx/D']") && g.d.getElementById("draw-wrap").hidden && g.d.getElementById("need-list").hidden && !g.d.getElementById("verify").closest("section").hidden);
    g = loadWith("https://example.test/giveaway/?draw=" + account.toBase58(), chainNode(drawBytes(account, payload, 1), { L: lockTx })); await wait(300);
    check("giveaway: before the draw the page says so and offers the draw to anyone", /Not drawn yet/.test(g.d.getElementById("g-winners").textContent) && !g.d.getElementById("draw-wrap").hidden && /slot 1,150/.test(g.d.getElementById("draw-lead").textContent) && g.d.getElementById("verify").closest("section").hidden);
    // A list too long for Solana: only its fingerprint is locked, and the page asks for the list.
    const longList = Array.from({ length: 4 }, (_, i) => "@long" + i), listBuf = Buffer.from(longList.join("\n"));
    const head = Buffer.from(payload.subarray(0, 16 + payload[15])); head[5] = 2; head.writeUInt32LE(4, 6);
    const p2 = Buffer.concat([head, sha(listBuf)]);
    const data2 = Buffer.concat([tx.instructions[1].data.subarray(0, 1), tx.instructions[1].data.subarray(1, 13), (() => { const b = Buffer.from(tx.instructions[1].data.subarray(13, 13 + 8 + tx.instructions[1].data.readUInt16BE(13 + 6))); return b; })(), Buffer.from([1]), p2]);
    const lock2 = { ...lockTx, transaction: { message: { ...lockTx.transaction.message, instructions: [{ programIdIndex: 3, data: b58(data2) }] } } };
    g = loadWith("https://example.test/giveaway/?draw=" + account.toBase58(), chainNode(drawBytes(account, p2, 2), { L: lock2, D: drawnTx })); await wait(300);
    check("giveaway: with only a fingerprint on Solana, winners are numbered and the list is asked for", !g.d.getElementById("need-list").hidden && g.d.getElementById("e-wrap").hidden && /Entry number \d/.test(g.d.getElementById("g-winners").textContent), g.d.getElementById("community").textContent + g.d.getElementById("g-winners").textContent);
    g.d.getElementById("list-in").value = longList.slice(0, 3).concat("@mallory").join("\n"); g.d.getElementById("list-go").click(); await wait(40);
    check("giveaway: a list that is not the locked one is refused", /not the locked list/.test(g.d.getElementById("list-note").textContent) && !g.d.getElementById("need-list").hidden);
    g.d.getElementById("list-in").value = longList.join("\n"); g.d.getElementById("list-go").click(); await wait(40);
    check("giveaway: the real list is recognised and the names appear", g.d.getElementById("need-list").hidden && /@long\d/.test(g.d.getElementById("g-winners").textContent) && g.d.querySelectorAll("#entries li").length === 4);
    g = loadWith("https://example.test/giveaway/?draw=not-an-address", chainNode(drawState.bytes, {})); await wait(120);
    check("giveaway: a bad address is explained, and nothing else is shown", /not a valid giveaway address/.test(g.d.getElementById("community").textContent) && g.d.getElementById("card").hidden && g.errors.length === 0, g.errors.join("|"));
  }

  // Burn vault
  p = load("docs/burn/index.html", "https://example.test/burn/");
  check("burn: the page loads, states the rule's limits and says where Phil is", /UploadServer/.test(p.d.body.textContent) && /has not been audited/.test(p.d.body.textContent) && /no third/.test(p.d.getElementById("p-facts").textContent) && p.errors.length === 0, p.errors.join("|"));
  {
    const demo = fs.existsSync("burn/demo.json") ? JSON.parse(fs.readFileSync("burn/demo.json", "utf8")) : null;
    if (!demo) check("burn: with no vault the page says so", !p.d.getElementById("none").hidden && p.d.getElementById("card").hidden);
    else {
      const whole = (u) => Number(BigInt(u) / 10n ** BigInt(demo.decimals)).toLocaleString("en-GB");
      check("burn: shows the demonstration vault's rule, totals and every burn", /take everything in the vault/.test(p.d.getElementById("v-rule").textContent) && p.d.getElementById("s-burned").textContent === whole(demo.totals.burned) && p.d.getElementById("s-burns").textContent === String(demo.totals.burns) && p.d.querySelectorAll("#history li").length === demo.history.length && [...p.d.querySelectorAll("#history a")].every((a) => a.href.endsWith("?cluster=devnet")));
      // Stand in for the node: the vault as the chain holds it, three burns in, with a pot waiting.
      const acct = Buffer.alloc(256);
      acct.write("PHILBURN", 0); acct[8] = 1; acct[9] = 4; acct.writeBigUInt64LE(BigInt(demo.threshold), 16); acct.writeBigUInt64LE(2672640n, 24);
      acct.writeBigUInt64LE(3n, 80); acct.writeBigUInt64LE(3n * BigInt(demo.threshold), 88); acct.writeBigUInt64LE(30000000n, 96); acct.write("Demo", 160);
      const node = (owner) => async (url, init) => {
        const q = JSON.parse(init.body);
        if (q.method === "getTokenSupply") return { ok: true, status: 200, json: async () => ({ result: { value: { amount: "999997000000000", decimals: 6 } } }) };
        return { ok: true, status: 200, json: async () => ({ result: { context: { slot: 4242 }, value: { data: [acct.toString("base64"), "base64"], owner, lamports: 2672640 + 12345678 } } }) };
      };
      p.w.fetch = node(demo.program);
      p.d.getElementById("refresh").click(); await wait(60);
      check("burn: reading from Solana shows the chain's own totals and the pot waiting in the vault", p.d.getElementById("s-burns").textContent === "3" && p.d.getElementById("s-burned").textContent === whole(3n * BigInt(demo.threshold)) && p.d.getElementById("s-paid").textContent === "0.03" && p.d.getElementById("s-pot").textContent === "0.012346" && /slot 4,242/.test(p.d.getElementById("refresh-note").textContent) && p.d.getElementById("v-supply").textContent === "999,997,000", p.d.getElementById("s-pot").textContent + " " + p.d.getElementById("refresh-note").textContent);
      p.w.fetch = node("11111111111111111111111111111111");
      p.d.getElementById("refresh").click(); await wait(60);
      check("burn: an account that is not the program's is called out", /Do not trust/.test(p.d.getElementById("refresh-note").textContent));
      p.w.fetch = async () => { throw new Error("offline"); };
      p.d.getElementById("refresh").click(); await wait(60);
      check("burn: being offline is explained", /Could not reach Solana devnet/.test(p.d.getElementById("refresh-note").textContent));
      check("burn: no script errors", p.errors.length === 0, p.errors.join("|"));
    }
  }

  // Mutation analysis
  p = load("docs/mutation/index.html", "https://example.test/mutation/");
  {
    const m = JSON.parse(fs.readFileSync("mutation/data.json", "utf8"));
    check("mutation: shows the totals, every kind of change and every server block", p.d.querySelectorAll("#facts b").length === 3 && p.d.querySelector("#facts b").textContent === String(m.total.mutants) && p.d.querySelectorAll("#ops tbody tr").length === m.byOperator.length && p.d.querySelectorAll("#blocks tbody tr").length === m.serverByBlock.length && p.errors.length === 0, p.errors.join("|"));
    check("mutation: the page gives aggregates for Phil's own test, not its step-by-step results", !/philKills/.test(fs.readFileSync("site/src/mutation-data.ts", "utf8").split("serverByBlock")[1]) && !/server_hello_policy_failure<\/code><\/td><td class="n">\d+<\/td><td class="n">0/.test(p.d.getElementById("blocks").innerHTML));
    check("mutation: our suites catch nearly every broken server", m.server.oursKills >= m.server.mutants - 4 && m.server.mutants > 200);
  }

  // Old shared links to the root still reach the playground
  check("home: forwards old playground links", fs.readFileSync("site/src/home.ts", "utf8").includes('location.replace("playground/" + location.hash)'));
  console.log(fails ? `${fails} failed` : "site: all passed");
  process.exit(fails ? 1 : 0);
})();
