// Builds the site pages into docs/: home, learn/ and otc/. The playground has its own build.
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const css = fs.readFileSync("site/src/base.css", "utf8");
const dog = fs.readFileSync("playground/src/dogmark.svg", "utf8").trim();
const REPO = "https://github.com/philcoinhigh/Phil-tools";
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Martian+Mono:wght@500;600&display=swap" rel="stylesheet">';

// Every page, in the order a newcomer would want them. The same list feeds the menu on small screens.
const PAGES = [
  ["learn", "learn/", "Learn"], ["playground", "playground/", "Playground"], ["hacks", "hacks/", "Hacks"],
  ["library", "library/", "Utilities"], ["otc", "otc/", "OTC desk"], ["changelog", "changelog/", "Changes"],
  ["fuzz", "fuzz/", "Fuzzer"], ["conformance", "conformance/", "Report"],
];
function header(root, active) {
  const link = ([id, href, label]) => `<a href="${root + href}"${active === id ? ' aria-current="page"' : ""}>${label}</a>`;
  const links = PAGES.map(link).join("") + `<a href="${REPO}">GitHub</a>`;
  return `<header class="site"><div class="wrap">
  <a class="mark" href="${root || "./"}" aria-label="Phil tools home">${dog}<span class="wordmark">phil <span>tools</span></span></a>
  <nav class="full" aria-label="Site">${links}</nav>
  <details class="menu"><summary>Menu</summary><nav aria-label="Site">${links}</nav></details>
</div></header>`;
}
const footer = `<footer class="foot"><div class="wrap"><span>Built by the Philcoin community. Independent of the Phil project.</span><span class="ca">CA <span id="ca"></span></span><button type="button" id="copy-ca">Copy CA</button><a href="${REPO}">Source (Apache-2.0)</a></div></footer>`;

function page(name, out, root, active) {
  const js = esbuild.buildSync({ entryPoints: [`site/src/${name}.ts`], bundle: true, minify: true, format: "iife", target: "es2020", write: false })
    .outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const html = fs.readFileSync(`site/src/${name}.html`, "utf8")
    .replace("__FONTS__", () => FONTS)
    .replace("/*__CSS__*/", () => css)
    .replace("__HEADER__", () => header(root, active))
    .replace("__FOOTER__", () => footer)
    .replace(/__REPO__/g, REPO)
    .replace("/*__BUNDLE__*/", () => js);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(out, (html.length / 1024).toFixed(1), "KiB");
}

page("home", "docs/index.html", "", "home");
page("learn", "docs/learn/index.html", "../", "learn");
page("otc", "docs/otc/index.html", "../", "otc");
page("conformance", "docs/conformance/index.html", "../", "conformance");
page("library", "docs/library/index.html", "../", "library");
page("hacks", "docs/hacks/index.html", "../", "hacks");
page("changelog", "docs/changelog/index.html", "../", "changelog");
page("fuzz", "docs/fuzz/index.html", "../", "fuzz");
