import { CONTRACT } from "./shared";
export function wireFooter(): void {
  const ca = document.getElementById("ca");
  if (ca) ca.textContent = CONTRACT;
  document.getElementById("copy-ca")?.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLElement;
    try { await navigator.clipboard.writeText(CONTRACT); b.textContent = "Copied"; } catch { b.textContent = "Select the address to copy"; }
    setTimeout(() => { b.textContent = "Copy address"; }, 1600);
  });
}
