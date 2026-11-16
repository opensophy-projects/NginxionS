// The interface in a real browser (Playwright, Chromium), run by scripts/test-airgap.sh after smoke in the closed
// network with the session of smoke (its cookie jar on the volume test-state). Every page is opened: it must render
// (not a blank page), throw no error of JavaScript and get no 5xx from the API. Errors of the console (CSP included)
// are reported. A screenshot of each page goes to /out (reports/ui), the results to /out/ui-e2e.json and .md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const ADMIN = process.env.ADMIN || "https://nginxions:81";
const OUT = process.env.OUT || "/out";
const JAR = process.env.JAR || "/state/cookies";

const PAGES = [
	["overview", "/"],
	["hosts", "/hosts"],
	["hosts-proxy", "/hosts?f=type:is:proxy"],
	["certificates", "/certificates"],
	["access", "/access"],
	// the old pages of PKI, mTLS and ACME lead to their blocks of Certificates
	["certificates-cas", "/pki?tab=cas"],
	["certificates-mtls", "/mtls"],
	["certificates-acme", "/certificates/acme"],
	["crowdsec", "/crowdsec"],
	["open-appsec", "/agents/open-appsec"],
	["open-appsec-agent", "/agents/open-appsec?tab=agent"],
	["open-appsec-expert", "/agents/open-appsec?item=expert"],
	["block-page", "/agents/block-page"],
	["blocks", "/analytics/blocks"],
	["events", "/waf/events"],
	["analytics", "/waf/analytics"],
	["audit-log", "/audit-log"],
	["users", "/users"],
	["roles", "/roles"],
	["services", "/system/services"],
	["notifications", "/system/notifications"],
	["settings", "/settings"],
	["not-found", "/no-such-page"],
];

/** the cookies of a curl jar (Netscape format; "#HttpOnly_" marks HttpOnly ones) */
const cookiesOf = (text) =>
	text
		.split("\n")
		.filter((l) => l.trim() && (!l.startsWith("#") || l.startsWith("#HttpOnly_")))
		.map((l) => l.split("\t"))
		.filter((f) => f.length >= 7)
		.map((f) => ({
			name: f[5],
			value: f[6].trim(),
			url: ADMIN,
			httpOnly: f[0].startsWith("#HttpOnly_"),
			secure: ADMIN.startsWith("https:"),
		}));

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
await context.addCookies(cookiesOf(readFileSync(JAR, "utf8")));

const results = [];
for (const [name, path] of PAGES) {
	const page = await context.newPage();
	const r = { name, path, console: [], errors: [], api5xx: [], blank: false };
	page.on("console", (m) => {
		if (m.type() === "error") r.console.push(m.text().slice(0, 300));
	});
	page.on("pageerror", (e) => r.errors.push(String(e.message || e).slice(0, 300)));
	page.on("response", (res) => {
		if (res.url().includes("/api/") && res.status() >= 500) r.api5xx.push(`${res.status()} ${res.url()}`);
	});
	try {
		await page.goto(ADMIN + path, { waitUntil: "networkidle", timeout: 45000 });
		await page.waitForTimeout(800);
		const text = await page.evaluate(() => document.getElementById("root")?.innerText ?? "");
		r.blank = text.trim().length < 20;
		r.login = /\/login\b/.test(page.url());
		await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
	} catch (err) {
		r.errors.push(`navigation: ${String(err.message || err).slice(0, 300)}`);
	}
	r.failed = r.errors.length > 0 || r.api5xx.length > 0 || r.blank || r.login;
	results.push(r);
	await page.close();
}
await browser.close();

writeFileSync(`${OUT}/ui-e2e.json`, `${JSON.stringify(results, null, 2)}\n`);
const failed = results.filter((r) => r.failed);
const withConsole = results.filter((r) => r.console.length);
const md = [
	"## Interface in a browser (Playwright)",
	"",
	`${results.length} pages: ${failed.length} failed, ${withConsole.length} with errors in the console.`,
	"",
	"| page | result | console | details |",
	"|---|---|---|---|",
	...results.map(
		(r) =>
			`| ${r.path} | ${r.failed ? "❌" : "✅"} | ${r.console.length} | ${[
				r.login ? "sent to the login" : "",
				r.blank ? "blank page" : "",
				...r.errors,
				...r.api5xx,
				...r.console.slice(0, 2),
			]
				.filter(Boolean)
				.join("; ")
				.replace(/\\/g, "\\\\")
				.replace(/\|/g, "\\|")
				.slice(0, 400)} |`,
	),
	"",
].join("\n");
writeFileSync(`${OUT}/ui-e2e.md`, md);
console.log(md);
process.exit(failed.length ? 1 : 0);
