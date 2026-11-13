// Turns the workflow's form fields (read from the environment, never from the command line)
// into a request file. Usage: node request.mjs <requests dir>
import fs from "fs";
const title = String(process.env.GIVEAWAY_TITLE ?? "").trim();
const entries = String(process.env.GIVEAWAY_ENTRIES ?? "");
if (!title || !entries.trim()) { console.error("A title and at least one entry are needed."); process.exit(1); }
const slug = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "giveaway";
const id = `${new Date().toISOString().slice(0, 10)}-${slug}-${Date.now().toString(36).slice(-4)}`;
const request = { id, title, winners: Number(process.env.GIVEAWAY_WINNERS || 1), delayMinutes: Number(process.env.GIVEAWAY_DELAY || 1), entries };
fs.writeFileSync(`${process.argv[2]}/${id}.json`, JSON.stringify(request, null, 1) + "\n");
console.log(id);
