// Home page: a live double-spend demo, plus forwarding of old playground links.
import { highlightHtml, runPhil, KIND_TITLE, esc } from "./shared";
import { wireFooter } from "./foot";

// Links shared before the site had a home page pointed at the root with a hash.
if (location.hash.length > 1) location.replace("playground/" + location.hash);

const BROKEN = `record Coin mode linear {
  amount : U64
}

callable Spend(coin : Coin) -> U64 {
  outcomes { success U64 };
}

fn spend(coin : Coin) -> U64 satisfies Spend {
  let Coin { amount } = coin;
  return amount;
}

component main provides U64 {
  let coin = construct Coin { amount = 10 };
  let first = spend(coin);
  let second = spend(coin);
  return first + second;
}
`;
const FIXED = BROKEN.replace("  let second = spend(coin);\n", "").replace("first + second", "first");
let fixed = false;
function show(): void {
  const src = fixed ? FIXED : BROKEN;
  const o = runPhil(src);
  document.getElementById("demo-code")!.innerHTML = highlightHtml(src, o.span);
  const says = document.getElementById("demo-says")!;
  says.className = "says" + (o.ok ? " good" : "");
  says.innerHTML = o.ok
    ? `<b>Ran to completion</b>The coin was spent once. The program hands back ${esc(o.returns[0]?.text ?? "")}.`
    : `<b>${esc(KIND_TITLE[o.kind] ?? o.kind)}${o.line ? `, line ${o.line}` : ""}</b>${esc(o.message)}`;
  document.getElementById("demo-flip")!.textContent = fixed ? "Spend it twice again" : "Remove the double spend";
}
document.getElementById("demo-flip")!.addEventListener("click", () => { fixed = !fixed; show(); });
show();
wireFooter();
