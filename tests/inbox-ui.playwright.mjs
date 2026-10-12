// Headless UI check of the Inbox webview (not part of vitest; needs Playwright + Chromium).
// Run: node tests/inbox-ui.playwright.mjs   (after `pnpm -r build`)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

// Pull the shell out of the compiled bundle without needing VS Code.
const src = readFileSync(new URL("../apps/vscode-extension/src/inbox-html.ts", import.meta.url), "utf8");
const body = src.slice(src.indexOf("`") + 1, src.lastIndexOf("`"))
  .replaceAll("${nonce}", "n0nce").replaceAll("${cspSource}", "'self'");
const prelude = `<script nonce="n0nce">window.__posted=[];window.acquireVsCodeApi=function(){var st=null;return{postMessage:function(m){window.__posted.push(m)},getState:function(){return st},setState:function(s){st=s}}};</script>`;
const dir = mkdtempSync(join(tmpdir(), "cf-ui-"));
const file = join(dir, "inbox.html");
writeFileSync(file, body.replace("<body>", "<body>" + prelude).replace("script-src 'nonce-n0nce'", "script-src 'nonce-n0nce' 'unsafe-inline'"));

const rule = (id, title, extra = {}) => ({ id, title, content: title + " <b>x</b>", scope: "project", category: "coding-rule", priority: 60, confidence: 0.5, status: "proposed", appliesTo: null, rejectedReason: null, sourceMessage: "agent said no", conflictIds: [], ...extra });
const state = {
  projectName: "demo", rootPath: "/x",
  proposed: [rule("a", "Rule A"), rule("b", "Rule B", { conflictIds: ["c1"] }), rule("c", "Rule C")],
  approved: [rule("d", "Approved D", { status: "approved" })], history: [],
  conflicts: [{ id: "c1", type: "direct", explanation: "pk", left: rule("d", "UUID", { status: "approved" }), right: rule("b", "AutoInc") }],
  capabilities: [], faults: [{ id: "f1", type: "reject", severity: "normal", message: "boom", createdAt: "now" }],
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("file://" + file);
const posted = () => page.evaluate(() => window.__posted);
const post = (m) => page.evaluate((m) => window.dispatchEvent(new MessageEvent("message", { data: m })), m);
const ok = (c, msg) => { if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok  :", msg); };

ok((await posted()).some((m) => m.type === "ready"), "sends ready");
await post({ type: "state", state });
ok((await page.locator(".row").count()) === 3, "renders 3 proposed rows");
ok((await page.locator("nav .badge").first().textContent()) === "3", "tab badge shows 3");
ok(!(await page.content()).includes("<b>x</b>"), "HTML in rule text is escaped");

await page.keyboard.press("j");
ok((await page.locator(".row.sel").textContent()).includes("Rule B"), "J moves selection");
ok((await page.locator("text=Conflicts with an approved rule").count()) === 1, "conflict warning shown for B");
await page.keyboard.press("a");
let last = (await posted()).at(-1);
ok(last.type === "action" && last.action.act === "approve" && last.action.ids[0] === "b", "A posts approve for selected");

await page.keyboard.press("r");
ok(await page.locator("#rReason").isVisible(), "R opens reject form");
await page.click('[data-reason="Too broad"]');
await page.click('[data-do="confirmReject"]');
last = (await posted()).at(-1);
ok(last.action.act === "reject" && last.action.reason === "Too broad", "reject carries chosen reason");

await page.keyboard.press("e");
ok(await page.locator("#eContent").isVisible(), "E opens editor");
await page.fill("#eContent", "Edited rule");
await page.click('[data-do="saveApprove"]');
last = (await posted()).at(-1);
ok(last.action.act === "edit" && last.action.content === "Edited rule" && last.action.approve === true, "save & approve posts edit");

await post({ type: "toast", message: "Approved 1 lesson(s)", undo: { act: "setStatus", ids: ["b"], status: "proposed" } });
await page.click("#undo");
last = (await posted()).at(-1);
ok(last.action.act === "setStatus" && last.action.status === "proposed", "Undo posts the inverse action");

await page.click('[data-tab="conflicts"]');
ok((await page.locator(".pair > div").count()) === 2, "conflict shows both rules side by side");
await page.click('[data-do="keep"][data-w="left"]');
last = (await posted()).at(-1);
ok(last.action.act === "resolve" && last.action.winner === "left", "Keep A posts resolve(left)");
await page.click('[data-do="diff"]');
ok((await posted()).at(-1).type === "openDiff", "Open diff posts openDiff");

await page.click('[data-tab="rules"]');
await page.fill("#filter", "zzz");
ok((await page.locator("#filter").evaluate((e) => e === document.activeElement)), "filter keeps focus while typing");
ok((await page.locator("text=No rules match").count()) === 1, "filter empty state");

await page.setViewportSize({ width: 420, height: 800 });
ok((await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), "no horizontal overflow at narrow width");
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
await browser.close();
