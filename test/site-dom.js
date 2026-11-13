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
  check("home: every page is linked from the body", ["learn/", "hacks/", "playground/", "onchain/", "session/", "giveaway/", "burn/", "otc/", "otc/#book", "changelog/", "conformance/", "fuzz/"].every((h) => hrefs.includes(h)), hrefs.join(" "));
  check("home: every utility has its own link", ["locker", "hooks", "launchhooks", "stockrewards", "vesting", "multisig", "auction", "launch"].every((id) => hrefs.includes("library/#" + id)) && p.d.querySelectorAll("#made a").length === 10);
  check("home: daily figures are filled in from the data", /^\d/.test(p.d.getElementById("s-changes").textContent) && p.d.getElementById("s-grammar").textContent.startsWith("64 of 64") && /^[\d,]+$/.test(p.d.getElementById("s-fuzz").textContent) && /MB, built from commit/.test(p.d.getElementById("s-philc-l").textContent), [p.d.getElementById("s-changes").textContent, p.d.getElementById("s-grammar").textContent, p.d.getElementById("s-fuzz").textContent].join(" | "));
  check("home: the menu lists every page", p.d.querySelectorAll(".site .menu nav a").length === 14 && p.d.querySelectorAll(".site nav.full a").length === 14);
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
