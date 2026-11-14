// Builds the site pages into docs/: home, learn/ and otc/. The playground has its own build.
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const css = fs.readFileSync("site/src/base.css", "utf8");
const dog = fs.readFileSync("playground/src/dogmark.svg", "utf8").trim();
const REPO = "https://github.com/philcoinhigh/Phil-tools";
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Martian+Mono:wght@500;600&display=swap" rel="stylesheet">';

// Every page, grouped the way the home page groups them. The same list feeds the header, the menu and the footer.
const GROUPS = [
  ["start", "Learn", [["tour", "tour/", "The tour, runnable"], ["learn", "learn/", "Learn Phil"], ["playground", "playground/", "Playground"], ["hacks", "hacks/", "Famous hacks"]]],
  ["chain", "On chain", [["session", "session/", "Phil at both ends"], ["giveaway", "giveaway/", "Giveaways"], ["burnvault", "burn/", "Burn vault"], ["onchain", "onchain/", "Phil on Solana"]]],
  ["build", "Build", [["library", "library/", "Token utilities"], ["otc", "otc/", "OTC desk"]]],
  ["lab", "Lab", [["mutation", "mutation/", "Mutation analysis"], ["fuzz", "fuzz/", "Compiler fuzzer"], ["conformance", "conformance/", "Conformance report"], ["changelog", "changelog/", "What changed in Phil"]]],
];
function header(root, active) {
  const groups = GROUPS.map(([id, label, pages]) => `<a href="${root || "./"}#${id}"${pages.some(([p]) => p === active) ? ' aria-current="true"' : ""}>${label}</a>`).join("");
  const all = GROUPS.map(([, label, pages]) => `<div><h4>${label}</h4>${pages.map(([id, href, name]) => `<a href="${root + href}"${active === id ? ' aria-current="page"' : ""}>${name}</a>`).join("")}</div>`).join("");
  return `<header class="site"><div class="wrap">
  <a class="mark" href="${root || "./"}" aria-label="Philcoin tools for Phil: home">${dog}<span class="wordmark">philcoin <span>tools for Phil</span></span></a>
  <nav class="full" aria-label="Sections">${groups}</nav>
  <details class="menu"><summary>All pages</summary><nav aria-label="All pages">${all}<div><h4>Elsewhere</h4><a href="${REPO}">Source on GitHub</a><a href="https://github.com/abiggerhammer/phil">Phil itself</a></div></nav></details>
</div></header>`;
}
const footer = (root) => `<footer class="foot"><div class="wrap">
  <div class="foot-top"><a class="mark" href="${root || "./"}">${dog}<span class="wordmark">philcoin <span>tools for Phil</span></span></a>
    <div class="foot-ca"><span class="ca">$philcoin <span id="ca"></span></span><button type="button" id="copy-ca">Copy address</button></div></div>
  <nav class="foot-nav" aria-label="All pages">${GROUPS.map(([, label, pages]) => `<div><h4>${label}</h4>${pages.map(([, href, name]) => `<a href="${root + href}">${name}</a>`).join("")}</div>`).join("")}</nav>
  <p class="foot-note">Built by the Philcoin community. Independent of the Phil project and of Solana. Nothing here is token-gated, and nothing here is financial advice. <a href="${REPO}">Source (Apache-2.0)</a></p>
</div></footer>`;

function page(name, out, root, active) {
  const js = esbuild.buildSync({ entryPoints: [`site/src/${name}.ts`], bundle: true, minify: true, format: "iife", target: "es2020", write: false })
    .outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const html = fs.readFileSync(`site/src/${name}.html`, "utf8")
    .replace("__FONTS__", () => FONTS)
    .replace("/*__CSS__*/", () => css)
    .replace("__HEADER__", () => header(root, active))
    .replace("__FOOTER__", () => footer(root))
    .replace("__MARK__", () => dog)
    .replace(/__REPO__/g, REPO)
    .replace("/*__BUNDLE__*/", () => js);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(out, (html.length / 1024).toFixed(1), "KiB");
}

page("home", "docs/index.html", "", "home");
page("learn", "docs/learn/index.html", "../", "learn");
page("tour", "docs/tour/index.html", "../", "tour");
page("otc", "docs/otc/index.html", "../", "otc");
page("conformance", "docs/conformance/index.html", "../", "conformance");
page("library", "docs/library/index.html", "../", "library");
page("hacks", "docs/hacks/index.html", "../", "hacks");
page("changelog", "docs/changelog/index.html", "../", "changelog");
page("fuzz", "docs/fuzz/index.html", "../", "fuzz");
page("mutation", "docs/mutation/index.html", "../", "mutation");
page("onchain", "docs/onchain/index.html", "../", "onchain");
page("session", "docs/session/index.html", "../", "session");
page("giveaway", "docs/giveaway/index.html", "../", "giveaway");
page("burnvault", "docs/burn/index.html", "../", "burnvault");
