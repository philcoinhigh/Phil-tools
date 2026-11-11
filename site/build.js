// Builds the site pages into docs/: home, learn/ and otc/. The playground has its own build.
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const css = fs.readFileSync("site/src/base.css", "utf8");
const dog = fs.readFileSync("playground/src/dogmark.svg", "utf8").trim();
const REPO = "https://github.com/philcoinhigh/Phil-tools";
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Martian+Mono:wght@500;600&display=swap" rel="stylesheet">';

function header(root, active) {
  const link = (id, href, label, cls = "") => `<a href="${href}"${cls ? ` class="${cls}"` : ""}${active === id ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<header class="site"><div class="wrap">
  <a class="mark" href="${root || "./"}" aria-label="Phil tools home">${dog}<span class="wordmark">phil <span>tools</span></span></a>
  <nav aria-label="Site">${link("playground", root + "playground/", "Playground")}${link("learn", root + "learn/", "Learn")}${link("otc", root + "otc/", "OTC")}${link("conformance", root + "conformance/", "Report", "wide")}${link("gh", REPO, "GitHub", "wide")}</nav>
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
