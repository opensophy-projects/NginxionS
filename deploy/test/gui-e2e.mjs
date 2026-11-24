// The interface driven like a user (Playwright, Chromium): each scenario does something in the GUI of NginxionS (clicks,
// forms, switches) and checks its effect where it matters, not in the interface: a site answers or refuses, a login is
// asked for, an attack is blocked, a ban takes effect, a user can log in. Run by scripts/test-airgap.sh (GUI_E2E=1)
// after smoke, with the session of smoke (its cookie jar on the volume test-state), in the closed network.
//
//   ADMIN   the interface (https://nginxions:81)      HTTP   the sites (http://nginxions)
//   JAR     the cookie jar of smoke                    OUT    screenshots of failures, gui-e2e.json and .md
//   ONLY    a comma list of scenarios to run (all by default)
//   MANAGER_FINGERPRINT   SHA-256 of the panel certificate for the nodes scenario
//
// A failed scenario does not stop the others; the test fails at its end. Every scenario cleans up what it made.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { gzipSync } from "node:zlib";
import { chromium, request } from "playwright";

const ADMIN = process.env.ADMIN || "https://nginxions:81";
const HTTP = new URL(process.env.HTTP || "http://nginxions");
const OUT = process.env.OUT || "/out";
const JAR = process.env.JAR || "/state/cookies";
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const UPSTREAM = process.env.UPSTREAM || "test-upstream";
const XSS = "/?q=%3Cscript%3Ealert(document.cookie)%3C/script%3E";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** a request to a site of NginxionS by its name: {status, body, headers} (no redirect is followed) */
const site = (host, path = "/", { method = "GET", auth, tls = false } = {}) =>
	new Promise((resolve) => {
		const headers = { Host: host };
		if (auth) headers.Authorization = `Basic ${Buffer.from(auth).toString("base64")}`;
		// over HTTPS without SNI (the address of NginxionS): the certificate of a test host is not checked
		const req = (tls ? https : http).request(
			{
				host: HTTP.hostname,
				port: tls ? 443 : HTTP.port || 80,
				path,
				method,
				headers,
				timeout: 10000,
				...(tls ? { rejectUnauthorized: false, servername: "" } : {}),
			},
			(res) => {
				let body = "";
				res.on("data", (d) => {
					body += d;
				});
				res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
			},
		);
		req.on("timeout", () => req.destroy(new Error("timeout")));
		req.on("error", (e) => resolve({ status: 0, body: String(e.message), headers: {} }));
		req.end();
	});

/** a request over HTTPS to a site by its name (SNI too), with a client certificate (.p12) or without: the status */
const tlsStatus = (host, { pfx, passphrase } = {}) =>
	new Promise((resolve) => {
		const req = https.request(
			{
				host: HTTP.hostname,
				port: 443,
				path: "/",
				headers: { Host: host },
				servername: host,
				// the server certificate is of a test CA of the scenario: not checked
				rejectUnauthorized: false,
				timeout: 10000,
				...(pfx ? { pfx, passphrase } : {}),
			},
			(res) => {
				res.resume();
				res.on("end", () => resolve(res.statusCode));
			},
		);
		req.on("timeout", () => req.destroy(new Error("timeout")));
		// a refused handshake is a refusal too
		req.on("error", () => resolve(0));
		req.end();
	});

/** waits until check() returns a truthy value; the last value is in the error */
async function until(what, check, { timeout = 60000, every = 1500 } = {}) {
	const end = Date.now() + timeout;
	let last;
	while (Date.now() < end) {
		try {
			last = await check();
		} catch (err) {
			// a page or a request that failed (the panel restarting) is a "not yet"; its error is the last value
			last = { ok: false, error: String(err.message || err).split("\n")[0].slice(0, 200) };
		}
		if (last?.ok ?? last) return last;
		await sleep(every);
	}
	throw new Error(`${what}: not reached in ${timeout / 1000} s (last: ${JSON.stringify(last)?.slice(0, 300)})`);
}

/** the site answers through the proxy (the upstream whoami echoes "Hostname:") */
const proxied = (host, path, opts) =>
	site(host, path, opts).then((r) => ({ ok: r.status === 200 && /^Hostname:/m.test(r.body), status: r.status }));
const status = (host, want, path, opts) =>
	site(host, path, opts).then((r) => ({ ok: r.status === want, status: r.status, location: r.headers.location }));

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
await context.addCookies(cookiesOf(readFileSync(JAR, "utf8")));
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message || e).slice(0, 300)));
page.on("response", (res) => {
	if (res.url().includes("/api/") && res.status() >= 500) pageErrors.push(`${res.status()} ${res.url()}`);
});

/** the API with the session of the page */
const api = async (method, path, data) => {
	const res = await page.request.fetch(`${ADMIN}/api${path}`, { method, data });
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = text;
	}
	if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${text.slice(0, 200)}`);
	return json;
};

/** the panel answers its API */
const answers = () => api("GET", "/").then(
	() => true,
	() => false,
);
const panelUp = () => until("the panel answers", answers, { timeout: 150000, every: 2000 });
/**
 * A restart of open-appsec also restarts nginxions in its network namespace. Check both container generations
 * before opening a page. A heartbeat may change the learning role again as a node learns it was disabled.
 */
async function panelRestarted(previousAgentStart, settingsApplied = () => true) {
	if (!previousAgentStart) throw new Error("the agent has no start time before restarting");
	let stable;
	await until(
		"the agent and the panel have restarted and stay healthy",
		async () => {
			const [agent, panel, applied] = await Promise.all([
				api("GET", "/nginxions/services/openappsec"),
				api("GET", "/nginxions/services/nginxions"),
				settingsApplied(),
			]).catch(() => []);
			const healthy =
				applied &&
				agent?.health === "healthy" &&
				panel?.health === "healthy" &&
				Date.parse(agent.startedAt) > Date.parse(previousAgentStart) &&
				Date.parse(panel.startedAt) >= Date.parse(agent.startedAt);
			if (!healthy) {
				stable = undefined;
				return { ok: false, agent: agent?.health, panel: panel?.health, applied };
			}
			if (stable?.agent !== agent.startedAt || stable?.panel !== panel.startedAt) {
				stable = { agent: agent.startedAt, panel: panel.startedAt, since: Date.now() };
			}
			return { ok: Date.now() - stable.since >= 15000, agent: stable.agent, panel: stable.panel };
		},
		{ timeout: 195000, every: 1000 },
	);
	// the page asked the panel while it was away (502, refused): expected, not an error of the page
	pageErrors.length = 0;
}

const go = async (path) => {
	await page.goto(ADMIN + path, { waitUntil: "networkidle", timeout: 45000 });
	await page.waitForTimeout(500);
};
/** a toast, an alert or the form shows an error: its text */
const shownError = () =>
	page
		.locator(".alert-danger, .invalid-feedback:visible, .Toastify__toast--error")
		.allInnerTexts()
		.then((t) => t.join(" | ").trim());
/** the modal is closed (saved); an error in it fails the step */
async function saved(what) {
	try {
		await page.locator(".modal.show").waitFor({ state: "detached", timeout: 30000 });
	} catch {
		throw new Error(`${what}: the window did not close (${(await shownError()) || "no error shown"})`);
	}
}
/** the client address NginxionS sees for this browser (the upstream echoes X-Real-Ip) */
const myAddress = async (host) => {
	const r = await site(host, "/");
	return r.body.match(/^X-Real-Ip: (.+)$/im)?.[1]?.trim();
};

// ------------------------------------------------------------------- the GUI actions used by the scenarios

/** Hosts → Add → Proxy: a proxy host of one domain to the test upstream */
async function addProxyHost(domain, { port = 80 } = {}) {
	await go("/hosts");
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await page.locator("button", { hasText: "A site or service" }).click();
	const modal = page.locator(".modal.show");
	await modal.locator("#react-select-2-input, input[id^='react-select'][id$='-input']").first().fill(domain);
	await page.keyboard.press("Enter");
	await modal.locator("#forwardHost").fill(UPSTREAM);
	await modal.locator("#forwardPort").fill(String(port));
	await modal.getByRole("button", { name: "Save", exact: true }).click();
	await saved(`proxy host ${domain}`);
}

/** the row of a host in Hosts (searched by its name) */
async function hostRow(domain) {
	await go(`/hosts?q=${encodeURIComponent(domain)}`);
	const row = page.locator("tbody tr", { hasText: domain }).first();
	await row.waitFor({ timeout: 20000 });
	return row;
}

/** an item of the open menu of a row (Edit, Delete...) */
const menuItem = (text) => page.getByRole("menuitem", { name: text, exact: true }).last();
/** Actions of the row of a host → an item of its menu */
async function hostAction(domain, item) {
	const row = await hostRow(domain);
	await row.getByRole("button", { name: "Actions" }).click();
	await menuItem(item).click();
}

/** the id of a proxy host by its domain (to clean up through the API when a scenario failed half way) */
const proxyHostId = async (domain) =>
	(await api("GET", "/nginx/proxy-hosts")).find((h) => h.domain_names.includes(domain))?.id;
async function removeProxyHost(domain) {
	const id = await proxyHostId(domain);
	if (id) await api("DELETE", `/nginx/proxy-hosts/${id}`);
}

/** Access → Add Access List: a list with one login (user, password) */
async function addAccessList(name, user, password) {
	await go("/access");
	await page.getByRole("button", { name: "Add Access List" }).click();
	const modal = page.locator(".modal.show");
	await modal.locator("#name").fill(name);
	await modal.locator("a", { hasText: "Authorizations" }).click();
	const inputs = modal.locator("#tab-auth input");
	await inputs.nth(0).fill(user);
	await inputs.nth(1).fill(password);
	await modal.getByRole("button", { name: "Save", exact: true }).click();
	await saved(`access list ${name}`);
}
const accessListId = async (name) => (await api("GET", "/nginx/access-lists")).find((l) => l.name === name)?.id;

/** the WAF of a host from its row in Hosts: Off, Detect, Prevent */
async function setWaf(domain, mode) {
	const row = await hostRow(domain);
	await row.getByRole("button", { name: "WAF", exact: true }).click();
	// an item reads "Prevent" + its description: the start of its text
	await page.getByRole("menuitem").filter({ hasText: new RegExp(`^\\s*${mode}`) }).last().click();
	await page.waitForTimeout(500);
	const err = await shownError();
	if (err) throw new Error(`WAF ${mode} on ${domain}: ${err}`);
}

/** the switch of a host in its row of Hosts (on: enabled) */
async function setHostEnabled(domain, on) {
	const row = await hostRow(domain);
	const sw = row.locator("input[aria-label='Disable'], input[aria-label='Enable']").first();
	if ((await sw.isChecked()) !== on) await sw.click();
	await page.waitForTimeout(500);
}

// ------------------------------------------------------------------------------------------ the scenarios

let crowdsecBefore;
let blockPageBefore;
let expertBefore;
const scenarios = [
	{
		name: "phase-2-navigation",
		title: "Phase 2: Hosts renders in RU/EN, both themes and both viewports; the mobile drawer keeps focus",
		run: async () => {
			for (const locale of ["en", "ru"]) {
				for (const theme of ["light", "dark"]) {
					for (const width of [375, 1440]) {
						const layout = await browser.newContext({
							ignoreHTTPSErrors: true,
							viewport: { width, height: 850 },
						});
						try {
							await layout.addCookies(cookiesOf(readFileSync(JAR, "utf8")));
							await layout.addInitScript(({ locale, theme }) => {
								localStorage.setItem("locale", locale);
								localStorage.setItem("tabler-theme", theme);
							}, { locale, theme });
							const view = await layout.newPage();
							const errors = [];
							view.on("pageerror", (error) => errors.push(error.message));
							view.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
							await view.goto(ADMIN + "/hosts", { waitUntil: "networkidle" });
							await view.locator('#nginxions-content h1 [data-translation-id="nginxions.hosts.title"]').waitFor();
							assert.equal(await view.locator("html").getAttribute("lang"), locale);
							assert.equal(await view.locator("html").getAttribute("data-bs-theme"), theme);
							assert.equal(await view.locator("h1").innerText(), locale === "ru" ? "Хосты" : "Hosts");
							if (width === 375) {
								const toggle = view.locator('button[aria-controls="nginxions-mobile-drawer"]');
								await toggle.click();
								const drawer = view.locator("dialog[open]");
								await drawer.waitFor();
								await view.keyboard.press("Shift+Tab");
								assert.equal(await drawer.evaluate((d) => d.contains(document.activeElement)), true);
								await view.keyboard.press("Escape");
								await drawer.waitFor({ state: "hidden" });
								assert.equal(await toggle.evaluate((b) => b === document.activeElement), true);
								await toggle.click();
								await view.setViewportSize({ width: 1440, height: 850 });
								await view.waitForFunction(() => !document.body.style.overflow && !document.querySelector("dialog[open]"));
							}
							assert.deepEqual(errors, []);
						} finally {
							await layout.close();
						}
					}
				}
			}
		},
	},
	{
		name: "phase-2-login-locale",
		title: "Phase 2: changing language on a short login screen preserves the form and persists the document language",
		run: async () => {
			const loginContext = await browser.newContext({
				ignoreHTTPSErrors: true,
				viewport: { width: 640, height: 360 },
			});
			try {
				const login = await loginContext.newPage();
				await login.goto(ADMIN, { waitUntil: "networkidle" });
				const email = login.locator('input[type="email"]');
				const password = login.locator('input[autocomplete="current-password"]');
				const language = login.getByRole("button", { name: "Language", exact: true });
				await email.focus();
				await language.click();
				await login.getByRole("menu").waitFor();
				await login.keyboard.press("Escape");
				await email.fill("phase2-draft@example.test");
				await password.fill(`draft-only-${Date.now()}`);
				const draft = await password.inputValue();
				await login.evaluate(() => { window.phase2Marker = true; });
				await language.click();
				await login.locator('[role="menuitem"]:has([data-translation-id="locale-ru-RU"])').click();
				await login.waitForFunction(() => document.documentElement.lang === "ru");
				assert.equal(await email.inputValue(), "phase2-draft@example.test");
				assert.equal(await password.inputValue(), draft);
				assert.equal(await login.evaluate(() => window.phase2Marker), true);
				await login.reload({ waitUntil: "networkidle" });
				await email.waitFor();
				assert.equal(await login.locator("html").getAttribute("lang"), "ru");
				assert.equal(await login.locator('[data-translation-id="login.title"]').innerText(), "Авторизация");
			} finally {
				await loginContext.close();
			}
		},
	},
	{
		name: "phase-2-overview-error",
		title: "Phase 2: Overview identifies an unavailable hosts API and preserves other host cards",
		run: async () => {
			const overview = await context.newPage();
			try {
				await overview.route(/\/api\/nginx\/proxy-hosts(?:\?|$)/, (route) => route.fulfill({
					status: 503, json: { error: { message: "Simulated hosts API outage" } },
				}));
				await overview.goto(ADMIN, { waitUntil: "domcontentloaded" });
				const error = overview.locator('[data-translation-id="nginxions.overview.hosts.unavailable"]');
				await error.waitFor();
				assert.match(await error.locator('xpath=ancestor::a[1]').innerText(), /^—/);
				assert.equal(await overview.locator('[data-translation-id="nginxions.overview.all-good"]').count(), 0);
				await overview.locator('[data-translation-id="nginxions.overview.hosts.stream"]').waitFor();
			} finally {
				await overview.close();
			}
		},
	},
	{
		name: "phase-2-host-transfer",
		title: "Phase 2: import validates host names, applies explicit ACL mapping, and creates disabled hosts disabled",
		run: async () => {
			const domain = "phase2-import.local";
			const name = "Phase 2 import ACL";
			await addAccessList(name, "phase2-user", `phase2-${Date.now()}`);
			const acl = await accessListId(name);
			assert.ok(acl);
			await go("/hosts");
			const importFile = async (domainNames) => page.locator('input[type="file"]').setInputFiles({
				name: "nginxions-hosts.json",
				mimeType: "application/json",
				buffer: Buffer.from(JSON.stringify({
					format: "nginxions-hosts",
					version: 1,
					hosts: [{ type: "proxy", data: {
						domainNames,
						forwardHost: UPSTREAM,
						forwardScheme: "http",
						forwardPort: 80,
						npmplusAccessListType: "custom",
						npmplusAccessListIds: [acl],
					} }, { type: "stream", data: {
						incomingPort: "28878",
						forwardingHost: UPSTREAM,
						forwardingPort: "80",
						tcpForwarding: true,
						enabled: false,
					} }],
				})),
			});
			await importFile(domain);
			await page.locator(".Toastify__toast--error").last().waitFor();
			assert.equal(await proxyHostId(domain), undefined);
			await importFile([domain]);
			const modal = page.getByRole("dialog").last();
			await modal.waitFor();
			await modal.getByRole("button", { name: "Import", exact: true }).click();
			await modal.getByText("Select a target for every reference before importing.").waitFor();
			assert.equal(await proxyHostId(domain), undefined);
			await modal.getByRole("combobox").selectOption(String(acl));
			const create = page.waitForRequest((request) =>
				request.method() === "POST" && new URL(request.url()).pathname === "/api/nginx/streams"
			);
			await modal.getByRole("button", { name: "Import", exact: true }).click();
			assert.equal((await create).postDataJSON().enabled, false);
			await saved("host import");
			const id = await proxyHostId(domain);
			assert.ok(id);
			const host = await api("GET", `/nginx/proxy-hosts/${id}`);
			assert.deepEqual(host.npmplus_access_list_ids, [acl]);
			const streams = await api("GET", "/nginx/streams");
			assert.equal(streams.find((s) => String(s.incoming_port) === "28878")?.enabled, false);
		},
		cleanup: async () => {
			await removeProxyHost("phase2-import.local");
			const stream = (await api("GET", "/nginx/streams")).find((s) => String(s.incoming_port) === "28878");
			if (stream) await api("DELETE", `/nginx/streams/${stream.id}`);
			const id = await accessListId("Phase 2 import ACL");
			if (id) await api("DELETE", `/nginx/access-lists/${id}`);
		},
	},
	{
		name: "phase-2-bulk-partial",
		title: "Phase 2: a bulk change reports each outcome when one host is refused",
		run: async () => {
			const first = "phase2-bulk-first.local";
			const second = "phase2-bulk-second.local";
			for (const domain of [first, second]) {
				await api("POST", "/nginx/proxy-hosts", {
					domain_names: [domain], forward_host: UPSTREAM, forward_scheme: "http", forward_port: 80,
				});
			}
			const refused = await proxyHostId(second);
			const path = `**/api/nginx/proxy-hosts/${refused}/disable`;
			await page.route(path, (route) => route.fulfill({
				status: 409, json: { error: { message: "Simulated refusal of the second host" } },
			}));
			try {
				await go("/hosts");
				for (const domain of [first, second]) {
					await page.getByRole("checkbox", { name: domain, exact: true }).check();
				}
				await page.getByRole("button", { name: "Disable", exact: true }).click();
				const error = page.locator(".Toastify__toast--error").last();
				await error.getByText("Succeeded: 1. Failed: 1.", { exact: false }).waitFor();
				assert.match(await error.innerText(), /phase2-bulk-second.local/);
				const hosts = await api("GET", "/nginx/proxy-hosts");
				assert.equal(hosts.find((h) => h.domain_names.includes(first)).enabled, false);
				assert.equal(hosts.find((h) => h.domain_names.includes(second)).enabled, true);
			} finally {
				await page.unroute(path);
			}
		},
		cleanup: async () => {
			await removeProxyHost("phase2-bulk-first.local");
			await removeProxyHost("phase2-bulk-second.local");
		},
	},
	{
		name: "hosts-proxy",
		title: "Hosts → Add → Proxy: the new host proxies its domain to the upstream; Delete in its menu stops it",
		async run() {
			const d = "gui-proxy.local";
			await addProxyHost(d);
			await until(`${d} answers through the proxy`, () => proxied(d));
			await hostAction(d, "Delete");
			await page.locator(".modal.show").getByRole("button", { name: /Delete|Yes|Confirm/ }).last().click();
			await saved(`delete ${d}`);
			await until(`${d} no longer proxied`, () => proxied(d).then((r) => ({ ok: !r.ok, status: r.status })));
		},
		cleanup: () => removeProxyHost("gui-proxy.local"),
	},
	{
		name: "hosts-switch",
		title: "Hosts → the switch of a row: a disabled host stops answering, enabled again it proxies",
		async run() {
			const d = "gui-switch.local";
			await addProxyHost(d);
			await until(`${d} answers`, () => proxied(d));
			await setHostEnabled(d, false);
			await until(`${d} disabled`, () => proxied(d).then((r) => ({ ok: !r.ok, status: r.status })));
			await setHostEnabled(d, true);
			await until(`${d} enabled again`, () => proxied(d));
		},
		cleanup: () => removeProxyHost("gui-switch.local"),
	},
	{
		name: "hosts-edit",
		title: "Hosts → Edit: a wrong port of the upstream gives the error page (502), the right one proxies again",
		async run() {
			const d = "gui-edit.local";
			await addProxyHost(d);
			await until(`${d} answers`, () => proxied(d));
			const edit = async (port) => {
				await hostAction(d, "Edit");
				const modal = page.locator(".modal.show");
				await modal.locator("#forwardPort").fill(String(port));
				await modal.getByRole("button", { name: "Save", exact: true }).click();
				await saved(`edit ${d}`);
			};
			await edit(81);
			await until(`${d} with a dead upstream port answers 502`, () => status(d, 502));
			await edit(80);
			await until(`${d} proxies again`, () => proxied(d));
		},
		cleanup: () => removeProxyHost("gui-edit.local"),
	},
	{
		name: "access-basic",
		title: "Access → a list with a login, chosen in the host: the site asks for it (401), lets in with it (200)",
		async run() {
			const d = "gui-acl.local";
			await addAccessList("gui basic", "carol", "gui-password-1");
			await addProxyHost(d);
			await until(`${d} answers`, () => proxied(d));
			await hostAction(d, "Edit");
			const modal = page.locator(".modal.show");
			// Global Access Lists: the type Custom, then Add a list and choose it
			await modal.locator(".react-select__control", { hasText: "Publicly Accessible" }).click();
			await page.locator(".react-select__option", { hasText: "Custom" }).click();
			await modal.locator("button", { hasText: /^\s*Add\s*$/ }).last().click();
			// Add takes the first list not chosen yet; another one is chosen in its field
			const chosen = modal.locator(".react-select__control:visible").last();
			if (!(await chosen.innerText()).includes("gui basic")) {
				await chosen.click();
				await page.locator(".react-select__option", { hasText: "gui basic" }).first().click();
			}
			await modal.getByRole("button", { name: "Save", exact: true }).click();
			await saved(`access list on ${d}`);
			await until(`${d} asks for a login`, () => status(d, 401));
			await until(`${d} lets in with the login`, () => proxied(d, "/", { auth: "carol:gui-password-1" }));
			await until(`a wrong password on ${d} gets 401`, () => status(d, 401, "/", { auth: "carol:wrong" }), {
				timeout: 30000,
			});
		},
		async cleanup() {
			await removeProxyHost("gui-acl.local");
			const id = await accessListId("gui basic");
			if (id) await api("DELETE", `/nginx/access-lists/${id}`);
		},
	},
	{
		name: "waf-modes",
		title: "Hosts → WAF of a row: Prevent blocks an attack (403), Detect lets it through and logs it, Off",
		async run() {
			const d = "gui-waf.local";
			await addProxyHost(d);
			await until(`${d} answers`, () => proxied(d));
			await setWaf(d, "Prevent");
			await until(`${d} blocks XSS in Prevent`, () => status(d, 403, XSS), { timeout: 120000 });
			await until(`a normal request to ${d} passes in Prevent`, () => proxied(d, "/?q=hello"), { timeout: 30000 });
			await setWaf(d, "Detect");
			await until(`${d} lets XSS through in Detect`, () => proxied(d, XSS), { timeout: 120000 });
			await until(`the attack on ${d} is an event`, async () => {
				const ev = await api("GET", `/nginxions/events?host=${d}&limit=5`);
				const rows = ev.rows ?? ev.events ?? ev.items ?? ev;
				return { ok: Array.isArray(rows) && rows.length > 0, n: rows?.length };
			});
			await go(`/waf/events?host=${d}`);
			await page.locator("tbody tr", { hasText: d }).first().click({ timeout: 20000 });
			const event = page.getByRole("dialog");
			await event.getByText("Event as written by the agent").waitFor();
			await event.locator("pre", { hasText: d }).last().waitFor({ timeout: 20000 });
			await event.getByRole("button", { name: "Close", exact: true }).last().click();
			await setWaf(d, "Off");
			await until(`${d} not inspected when Off`, () => proxied(d, XSS), { timeout: 120000 });
		},
		cleanup: () => removeProxyHost("gui-waf.local"),
	},
	{
		name: "waf-location",
		title: "Host form → WAF: a location has its own mode and policy generation follows host changes",
		async run() {
			const domain = "gui-waf-location.local";
			const renamed = "gui-waf-renamed.local";
			await addProxyHost(domain);
			await hostAction(domain, "Edit");
			const form = page.getByRole("dialog");
			await form.locator('a[href="#tab-locations"]').click();
			const locations = form.locator("#tab-locations");
			await locations.getByRole("button", { name: /add location/i }).click();
			await locations.getByPlaceholder("/path", { exact: true }).fill("/review");
			await locations.locator("input[id^='forwardHost-']").fill(UPSTREAM);
			await locations.locator("input[id^='forwardPort-']").fill("80");
			await form.locator('a[href="#tab-waf"]').click();
			await form.getByRole("checkbox", { name: "Protect with open-appsec" }).check();
			await form.locator("#nginxionsWafMode").selectOption("detect-learn");
			await form.getByRole("combobox", { name: "/review" }).selectOption("prevent-learn");
			await form.getByRole("button", { name: "Save", exact: true }).click();
			await saved("WAF location");
			const id = await proxyHostId(domain);
			const policy = () => api("GET", "/nginxions/waf/policy");
			await until("the WAF location is in the generated policy", async () =>
				(await policy()).content.includes(`host: ${domain}/review`));
			await until("the WAF location uses Prevent", () => status(domain, 403, `/review${XSS.slice(1)}`), { timeout: 120000 });
			await until("the rest of the host uses Detect", () => proxied(domain, XSS));
			await go("/agents/open-appsec?tab=agent");
			await page.getByRole("button", { name: "Show YAML", exact: true }).click();
			await page.getByRole("dialog").locator("pre").filter({ hasText: `${domain}/review` }).waitFor();
			await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
			const applied = page.waitForResponse((response) => response.url().endsWith("/api/nginxions/waf/policy/apply"));
			await page.getByRole("button", { name: "Apply now", exact: true }).click();
			if (!(await (await applied).json()).applied?.ok) throw new Error("The agent did not accept the apply request");
			await api("PUT", `/nginx/proxy-hosts/${id}`, { domain_names: [renamed] });
			await until("the policy follows a host rename", async () => {
				const { content } = await policy();
				return content.includes(`host: ${renamed}/review`) && !content.includes(domain);
			});
			await removeProxyHost(renamed);
			await until("the policy drops a deleted host", async () => !(await policy()).content.includes(renamed));
		},
		async cleanup() {
			await removeProxyHost("gui-waf-location.local");
			await removeProxyHost("gui-waf-renamed.local");
		},
	},
	{
		name: "waf-expert",
		title: "Expert policy → Check, diff, save and roll back as a new version",
		async run() {
			expertBefore = (await api("GET", "/nginxions/waf/policy/custom")).content;
			await go("/agents/open-appsec?item=expert");
			const editor = page.locator("textarea:visible").first();
			await editor.fill("policies:\n  default:\n    mode: unknown\n");
			await page.getByRole("button", { name: "Check", exact: true }).click();
			await page.locator(".alert-danger", { hasText: "policies.default.mode" }).waitFor();
			const save = page.getByRole("button", { name: "Save and apply", exact: true });
			if (!(await save.isDisabled())) throw new Error("the invalid fragment can be saved");
			const first = "policies:\n  default:\n    mode: detect-learn\n";
			await editor.fill(first);
			await page.getByRole("button", { name: "Check", exact: true }).click();
			await page.getByText("Changes of local_policy.yaml", { exact: true }).waitFor();
			await page.getByPlaceholder("Comment", { exact: true }).fill("Phase 1 initial fragment");
			await save.click();
			const firstRow = page.getByRole("row", { name: /Phase 1 initial fragment/ });
			await firstRow.getByText("in force", { exact: true }).waitFor();
			await editor.fill("policies:\n  default:\n    mode: inactive\n");
			await save.click();
			await firstRow.getByRole("button", { name: "Roll back", exact: true }).click();
			await page.getByRole("dialog").getByRole("button", { name: "Roll back", exact: true }).click();
			await page.getByRole("row", { name: /Rollback to version/ }).getByText("in force", { exact: true }).waitFor();
			if ((await api("GET", "/nginxions/waf/policy/custom")).content !== first) {
				throw new Error("the rollback did not restore the saved fragment");
			}
		},
		async cleanup() {
			if (expertBefore !== undefined) await api("PUT", "/nginxions/waf/policy/custom", { content: expertBefore });
			expertBefore = undefined;
		},
	},
	{
		name: "waf-model",
		title: "Agent → Model: reject a bad archive, upload waap.data, restart and return to the built-in model",
		async run() {
			const model = execFileSync("tar", ["-czf", "-", "-C", "/e2e", "waap.data"], { maxBuffer: 16 * 1024 * 1024 });
			const hash = createHash("sha256").update(model).digest("hex");
			await go("/agents/open-appsec?tab=agent");
			const chooser = page.locator('input[type="file"][accept*=".tgz"]');
			const modelResponse = (method) => page.waitForResponse((response) =>
				new URL(response.url()).pathname === "/api/nginxions/waf/agent/model" && response.request().method() === method);
			let response = modelResponse("PUT");
			await chooser.setInputFiles({ name: "invalid.tgz", mimeType: "application/gzip", buffer: gzipSync("plain text") });
			if ((await response).status() !== 400) throw new Error("the invalid archive was accepted");
			const before = await api("GET", "/nginxions/services/openappsec");
			response = modelResponse("PUT");
			await chooser.setInputFiles({ name: "open-appsec-advanced-model.tgz", mimeType: "application/gzip", buffer: model });
			if (!(await response).ok()) throw new Error("the archive with waap.data was refused");
			await panelRestarted(before.startedAt);
			if ((await api("GET", "/nginxions/waf/agent")).model.sha256 !== hash) throw new Error("the uploaded model is missing");
			await go("/agents/open-appsec?tab=agent");
			const installed = await api("GET", "/nginxions/services/openappsec");
			await page.getByRole("button", { name: "Remove model", exact: true }).click();
			response = modelResponse("DELETE");
			await page.getByRole("dialog").getByRole("button", { name: "Remove model", exact: true }).click();
			if (!(await response).ok()) throw new Error("the custom model was not removed");
			await panelRestarted(installed.startedAt);
			const { model: current } = await api("GET", "/nginxions/waf/agent");
			if (current.present || current.previous?.sha256 !== hash) throw new Error("the built-in model was not restored");
		},
		async cleanup() {
			const state = await api("GET", "/nginxions/waf/agent");
			if (state.model.present) await api("DELETE", "/nginxions/waf/agent/model?apply=false");
		},
	},
	{
		name: "crowdsec-ban",
		title: "Blocks → Ban addresses: the banned address is refused (403); Unban lets it in again",
		async run() {
			const d = "gui-ban.local";
			await addProxyHost(d);
			await until(`${d} answers`, () => proxied(d));
			const me = await myAddress(d);
			if (!me) throw new Error("the upstream did not echo the address of the client");
			// CrowdSec → Change settings: the bouncer checks requests in nginx; private addresses (the test network)
			// may be banned
			crowdsecBefore = await api("GET", "/nginxions/crowdsec/settings");
			await go("/crowdsec");
			await page.getByRole("button", { name: "Change settings" }).click();
			const setSwitch = async (label, on) => {
				const box = page.locator("label.form-switch", { hasText: label }).locator("input");
				if ((await box.isChecked()) !== on) await box.click();
			};
			await setSwitch("Check requests in nginx", true);
			await setSwitch("Never ban private addresses", false);
			await page.getByRole("button", { name: "Save and apply" }).click();
			await until("the settings of CrowdSec applied", async () => {
				const cs = await api("GET", "/nginxions/crowdsec/settings");
				const pending = (await api("GET", "/nginxions/crowdsec")).pending ?? [];
				return { ok: cs.bouncer?.enabled === true && pending.length === 0, pending };
			}, { timeout: 180000 });
			await go("/analytics/blocks?tab=decisions");
			await page.getByRole("button", { name: "Ban addresses" }).click();
			const modal = page.locator(".modal.show");
			await modal.locator("#cs-ban-values").fill(me);
			await modal.locator("#cs-ban-reason").fill("gui-e2e");
			await modal.getByRole("button", { name: /^Ban \(/ }).click();
			await saved(`ban of ${me}`);
			await until(`${me} is refused on ${d}`, () => status(d, 403), { timeout: 90000 });
			await go(`/analytics/blocks?tab=decisions&q=${encodeURIComponent(me)}`);
			const row = page.locator("tbody tr", { hasText: me }).first();
			await row.waitFor({ timeout: 30000 });
			await row.getByRole("button", { name: "Unban" }).click();
			const confirm = page.locator(".modal.show").getByRole("button", { name: /Unban|Yes|Confirm/ });
			if (await confirm.count()) await confirm.last().click();
			await until(`${me} is let in again on ${d}`, () => proxied(d), { timeout: 90000 });
		},
		async cleanup() {
			const me = await myAddress("gui-ban.local").catch(() => "");
			if (me) await api("POST", "/nginxions/crowdsec/decisions/delete", { values: [me] }).catch(() => {});
			await removeProxyHost("gui-ban.local");
			if (crowdsecBefore) await api("PUT", "/nginxions/crowdsec/settings", crowdsecBefore).catch(() => {});
		},
	},
	{
		name: "hosts-redirect",
		title: "Hosts → Add → Redirect: the domain answers the code chosen in the form (302) to its address, with the path",
		async run() {
			const d = "gui-redirect.local";
			await go("/hosts");
			await page.getByRole("button", { name: "Add", exact: true }).click();
			await page.locator("button", { hasText: "Send visitors of a domain" }).click();
			const modal = page.locator(".modal.show");
			await modal.locator("input[id^='react-select'][id$='-input']").first().fill(d);
			await page.keyboard.press("Enter");
			await modal.locator("#forwardDomainName").fill("example.org");
			await modal.locator("#forwardHttpCode").selectOption("302");
			await modal.locator("#preservePath").check();
			await modal.getByRole("button", { name: "Save", exact: true }).click();
			await saved(`redirect ${d}`);
			await until(`${d} redirects with 302 and the path`, () =>
				site(d, "/a/b?c=1").then((r) => ({
					ok: r.status === 302 && /example\.org\/a\/b\?c=1$/.test(r.headers.location ?? ""),
					status: r.status,
					location: r.headers.location,
				})),
			);
		},
		async cleanup() {
			const h = (await api("GET", "/nginx/redirection-hosts")).find((x) => x.domain_names.includes("gui-redirect.local"));
			if (h) await api("DELETE", `/nginx/redirection-hosts/${h.id}`);
		},
	},
	{
		name: "hosts-404",
		title: "Hosts → Add → 404: the domain answers 404",
		async run() {
			const d = "gui-dead.local";
			await go("/hosts");
			await page.getByRole("button", { name: "Add", exact: true }).click();
			await page.locator("button", { hasText: "Answer 404 for a domain" }).click();
			const modal = page.locator(".modal.show");
			await modal.locator("input[id^='react-select'][id$='-input']").first().fill(d);
			await page.keyboard.press("Enter");
			await modal.getByRole("button", { name: "Save", exact: true }).click();
			await saved(`404 host ${d}`);
			await until(`${d} answers 404`, () => status(d, 404));
		},
		async cleanup() {
			const h = (await api("GET", "/nginx/dead-hosts")).find((x) => x.domain_names.includes("gui-dead.local"));
			if (h) await api("DELETE", `/nginx/dead-hosts/${h.id}`);
		},
	},
	{
		name: "hosts-duplicate",
		title: "Hosts → Duplicate: the copy with another domain proxies too, the original keeps answering",
		async run() {
			const d = "gui-orig.local";
			const copy = "gui-copy.local";
			await addProxyHost(d);
			await until(`${d} answers`, () => proxied(d));
			await hostAction(d, "Duplicate");
			const modal = page.locator(".modal.show");
			// the copy opens with the domains of the original: they are replaced
			await modal.locator(".react-select__multi-value__remove").first().click();
			await modal.locator("input[id^='react-select'][id$='-input']").first().fill(copy);
			await page.keyboard.press("Enter");
			await modal.getByRole("button", { name: "Save", exact: true }).click();
			await saved(`duplicate of ${d}`);
			await until(`${copy} answers`, () => proxied(copy));
			await until(`the original ${d} still answers`, () => proxied(d), { timeout: 30000 });
		},
		async cleanup() {
			await removeProxyHost("gui-orig.local");
			await removeProxyHost("gui-copy.local");
		},
	},
	{
		name: "stream",
		title: "Hosts → Add → Stream: the TCP port forwards to the upstream; Delete closes it",
		async run() {
			const port = 2333;
			await go("/hosts");
			await page.getByRole("button", { name: "Add", exact: true }).click();
			await page.locator("button", { hasText: "Forward a TCP/UDP port" }).click();
			const modal = page.locator(".modal.show");
			await modal.locator("#incomingPort").fill(String(port));
			await modal.locator("#forwardingHost").fill(UPSTREAM);
			await modal.locator("#forwardingPort").fill("80");
			if (!(await modal.locator("#tcpForwarding").isChecked())) await modal.locator("#tcpForwarding").check();
			await modal.getByRole("button", { name: "Save", exact: true }).click();
			await saved(`stream ${port}`);
			const viaStream = () =>
				new Promise((resolve) => {
					const req = http.get({ host: HTTP.hostname, port, path: "/", timeout: 5000 }, (res) => {
						let body = "";
						res.on("data", (d) => {
							body += d;
						});
						res.on("end", () => resolve({ ok: /^Hostname:/m.test(body), status: res.statusCode }));
					});
					req.on("timeout", () => req.destroy(new Error("timeout")));
					req.on("error", (e) => resolve({ ok: false, error: e.code || e.message }));
				});
			await until(`the stream on ${port} answers`, viaStream);
			// the stream is a row of Hosts named by its port
			await hostAction(String(port), "Delete");
			await page.locator(".modal.show").getByRole("button", { name: /Delete|Yes|Confirm/ }).last().click();
			await saved(`delete the stream ${port}`);
			await until(`the stream on ${port} is closed`, () => viaStream().then((r) => ({ ok: !r.ok, ...r })));
		},
		async cleanup() {
			const st = (await api("GET", "/nginx/streams")).find((x) => Number(x.incoming_port) === 2333);
			if (st) await api("DELETE", `/nginx/streams/${st.id}`);
		},
	},
	{
		name: "pki-mtls",
		title:
			"PKI: root CA, trust domain, server certificate as TLS of a host; mTLS on: without a certificate refused, with the .p12 200, revoked refused",
		async run() {
			const domain = "gui-mtls.local";
			const p12Password = "gui-p12-password";
			const modal = () => page.locator(".modal.show").last();
			// Certificates → PKI → Create a root CA
			await go("/pki?tab=cas");
			await page.getByRole("button", { name: "Create a root CA" }).click();
			await modal().locator("#pki-ca-name").fill("GUI Root");
			await modal().locator("#pki-ca-cn").fill("GUI Root");
			await modal().getByRole("button", { name: "Create", exact: true }).click();
			await saved("root CA");
			// its menu → New trust domain
			const caAction = async (name, item) => {
				await page.locator("tbody tr", { hasText: name }).first().getByRole("button", { name: "Actions" }).click();
				await menuItem(item).click();
			};
			await caAction("GUI Root", "New trust domain");
			await modal().locator("#pki-ca-name").fill("GUI Servers");
			await modal().locator("#pki-ca-cn").fill("GUI Servers");
			await modal().getByRole("button", { name: "Create", exact: true }).click();
			await saved("trust domain");
			// the trust domain → Issue certificate: Server, installed as a certificate of NginxionS
			await caAction("GUI Servers", "Issue certificate");
			await modal().getByRole("button", { name: "Server", exact: true }).click();
			await modal().locator("#pki-subject-commonName").fill(domain);
			await modal().locator("#pki-dns").fill(domain);
			await modal()
				.locator("label", { hasText: "Install as a certificate of NginxionS" })
				.locator("input")
				.check({ force: true });
			await modal().getByRole("button", { name: "Issue", exact: true }).click();
			await modal().getByRole("button", { name: "Done" }).click();
			await saved("server certificate");

			// Hosts: a proxy host, its TLS column → the installed certificate
			await addProxyHost(domain);
			let row = await hostRow(domain);
			await row.getByRole("button", { name: "TLS", exact: true }).click();
			await page.getByRole("menuitem").filter({ hasText: `${domain} (PKI)` }).last().click();
			await until("the host answers over HTTPS", async () => (await tlsStatus(domain)) === 200);

			// the switch of mTLS: on (a trust domain of the host is made in one step), no certificate → refused
			row = await hostRow(domain);
			await row.locator("input[aria-label^='Turn on mTLS']").click();
			await until("without a client certificate the host refuses", async () => {
				const code = await tlsStatus(domain);
				return { ok: code === 403 || code === 0, code };
			});

			// mTLS → Issue access certificate…: a .p12 with our password, downloaded like a user does
			row = await hostRow(domain);
			await row.getByRole("button", { name: "mTLS", exact: true }).click();
			await menuItem("Issue access certificate…").click();
			await modal().locator("#mtls-access-name").fill("gui-alice");
			await modal().locator("#mtls-access-password").fill(p12Password);
			await modal().getByRole("button", { name: "Issue", exact: true }).click();
			const download = modal().getByRole("button", { name: "Download .p12" });
			await download.waitFor({ timeout: 30000 });
			const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
			const pfx = readFileSync(await file.path());
			await modal().getByRole("button", { name: "Done" }).click();
			await saved("access certificate");
			const withCert = () => tlsStatus(domain, { pfx, passphrase: p12Password });
			await until("with the .p12 the host answers", async () => {
				const code = await withCert();
				return { ok: code === 200, code };
			});

			// mTLS → Choose a certificate → its menu → Revoke: the same .p12 is refused
			row = await hostRow(domain);
			await row.getByRole("button", { name: "mTLS", exact: true }).click();
			await page.getByRole("menuitem").filter({ hasText: "Choose a certificate" }).last().click();
			await modal().getByRole("button", { name: "Actions" }).first().click();
			await menuItem("Revoke").click();
			await modal().getByRole("button", { name: "Revoke", exact: true }).click();
			await page.waitForTimeout(1000);
			const err = await shownError();
			if (err) throw new Error(`revoke: ${err}`);
			await until(
				"a revoked certificate is refused",
				async () => {
					const code = await withCert();
					return { ok: code !== 200, code };
				},
				{ timeout: 90000 },
			);
		},
		async cleanup() {
			await removeProxyHost("gui-mtls.local");
			const { cas } = await api("GET", "/nginxions/pki");
			// the trust domain mTLS made for the host may be under another root: by its name first
			for (const ca of cas.filter((c) => c.name.includes("gui-mtls.local"))) {
				await api("DELETE", `/nginxions/pki/cas/${ca.id}?cascade=true&disable_hosts=true`).catch(() => {});
			}
			for (const ca of cas.filter((c) => c.name === "GUI Root")) {
				await api("DELETE", `/nginxions/pki/cas/${ca.id}?cascade=true&disable_hosts=true`);
			}
			for (const c of await api("GET", "/nginx/certificates")) {
				if (c.nice_name === "gui-mtls.local (PKI)") await api("DELETE", `/nginx/certificates/${c.id}`);
			}
		},
	},
	{
		name: "nodes",
		title:
			"Agents → Nodes: a node added gets a code; this server joins itself with it (online), disabled it learns so, disconnected and deleted",
		async run() {
			const modal = () => page.locator(".modal.show").last();
			await go("/agents/nodes");
			await page.locator("#node-name").fill("gui-node");
			await page.locator("#node-labels").fill("gui test");
			await page.getByRole("button", { name: "Add node" }).click();
			const code = (await page.getByTestId("node-code").innerText()).trim();
			if (!/^n-[0-9a-f]{16}\./.test(code)) throw new Error(`no join code shown: ${code}`);
			const uid = code.split(".")[0];
			const row = page.locator(`tr[data-node="${uid}"]`);
			await row.waitFor();
			if (!/Waits for connection/.test(await row.innerText())) throw new Error("the new node does not wait");
			// "This server": the backend calls its own panel as its manager
			await page.locator("#cluster-manager").fill("https://127.0.0.1:81");
			await page.locator("#cluster-code").fill(code);
			const fingerprint = process.env.MANAGER_FINGERPRINT;
			if (!fingerprint) throw new Error("the test Manager fingerprint is required");
			await page.locator("#cluster-fingerprint").fill(fingerprint);
			const beforeJoin = await api("GET", "/nginxions/services/openappsec");
			await page.getByRole("button", { name: "Connect", exact: true }).click();
			await page.locator("dt").filter({ hasText: "Certificate of the manager (SHA-256)" }).waitFor({ timeout: 30000 });
			await panelRestarted(beforeJoin.startedAt);
			await until("the node is online in the list", async () => {
				await go("/agents/nodes");
				return /Online/.test(await row.innerText());
			});
			// Rollout plan (step 15.2): the staged rollout switched on and off, hosts given to a label of the node
			const plan = page.getByTestId("rollout-plan");
			await plan.getByText("Staged rollout", { exact: true }).click();
			await until("the staged rollout is on", async () => (await api("GET", "/nginxions/nodes/staged")).staged);
			await go("/agents/nodes");
			await plan.getByText("Staged rollout", { exact: true }).click();
			await until("the staged rollout is off", async () => !(await api("GET", "/nginxions/nodes/staged")).staged);
			await addProxyHost("gui-label.local");
			const labelHost = await proxyHostId("gui-label.local");
			await go("/agents/nodes");
			await plan.locator("tr[data-label-row='gui']").getByRole("button", { name: "Hosts", exact: true }).click();
			await modal().locator("label.form-check", { hasText: "gui-label.local" }).locator("input").check();
			await modal().getByRole("button", { name: "Save", exact: true }).click();
			await saved("the hosts of the label");
			const given = (await api("GET", "/nginxions/nodes/label-hosts")).find((l) => l.label === "gui");
			if (!given?.host_ids?.includes(labelHost)) throw new Error(`the label does not serve the host: ${JSON.stringify(given)}`);
			// Packages: the node held on a package it was given, then it follows the configuration again
			await row.getByRole("button", { name: "Packages", exact: true }).click();
			await modal().getByRole("button", { name: "Back to this package" }).first().click();
			await page.getByText("The node gets this package with its next heartbeat.").waitFor({ timeout: 15000 });
			const held = (await api("GET", "/nginxions/nodes")).find((n) => n.uid === uid);
			if (held?.pinned?.by !== "manual") throw new Error(`the node is not held: ${JSON.stringify(held?.pinned)}`);
			await modal().getByRole("button", { name: "Follow the configuration" }).click();
			await page.getByText("The node follows the configuration again.").waitFor({ timeout: 15000 });
			await modal().locator(".modal-footer").getByRole("button", { name: "Close", exact: true }).click();
			if ((await api("GET", "/nginxions/nodes")).find((n) => n.uid === uid)?.pinned)
				throw new Error("the node still is held");
			// Disable → its next heartbeat learns it
			const beforeDisable = await api("GET", "/nginxions/services/openappsec");
			await row.getByRole("button", { name: "Disable" }).click();
			await modal().getByRole("button", { name: "Disable", exact: true }).click();
			await saved("disable the node");
			await panelRestarted(beforeDisable.startedAt, async () => {
				const member = await api("GET", "/nginxions/cluster/member");
				return member.disabled && (await api("GET", "/nginxions/waf/agent")).restartRequired === false;
			});
			await go("/agents/nodes");
			await page.getByText("The manager disabled this node").waitFor();
			await page.getByRole("button", { name: "Disconnect" }).click();
			await modal().getByRole("button", { name: "Disconnect", exact: true }).click();
			await saved("disconnect");
			await row.getByRole("button", { name: "Delete" }).click();
			await modal().getByRole("button", { name: "Delete", exact: true }).click();
			await saved("delete the node");
			await row.waitFor({ state: "detached", timeout: 15000 });
			if ((await api("GET", "/nginxions/cluster/member")).joined) throw new Error("still a node of a manager");
		},
		async cleanup() {
			await api("DELETE", "/nginxions/cluster/member").catch(() => {});
			await api("PUT", "/nginxions/nodes/staged", { staged: false }).catch(() => {});
			await api("PUT", "/nginxions/nodes/label-hosts/gui", { host_ids: [] }).catch(() => {});
			await removeProxyHost("gui-label.local").catch(() => {});
			for (const n of await api("GET", "/nginxions/nodes").catch(() => [])) {
				if (n.name !== "gui-node") continue;
				if (n.status === "active") await api("POST", `/nginxions/nodes/${n.id}/revoke`);
				await api("DELETE", `/nginxions/nodes/${n.id}`);
			}
		},
	},
	{
		name: "learning-profile",
		title:
			"Agents → open-appsec → Learning → Learning profiles: a profile of a site with its WAF policy is made, applied (the agent restarts) and removed",
		async run() {
			const d = "gui-profile.local";
			const modal = () => page.locator(".modal.show").last();
			await addProxyHost(d);
			await setWaf(d, "Prevent");
			const id = await proxyHostId(d);
			let sample = 0;
			// Wait for the agent to persist the site's learning before submitting the profile form.
			await until(
				"the agent saves learning data for the site",
				async () => {
					for (let i = 0; i < 20; i++) {
						const { status } = await site(d, `/?filters=blue%2Cmedium%2Clinen%2C${++sample}`);
						if (status !== 200) return { ok: false, status };
					}
					const { assets, error } = await api("GET", `/nginxions/learning/hosts/${id}/learned`);
					return { ok: assets.length > 0, error };
				},
				{ timeout: 240000, every: 15000 },
			);
			await go("/agents/open-appsec?tab=learning");
			await page.getByRole("button", { name: "Learning profiles" }).click();
			await modal().getByRole("button", { name: "New profile" }).click();
			await modal().locator("#profile-name").fill("gui profile");
			await modal().locator("label.form-check", { hasText: d }).locator("input").check();
			await modal().locator("label.form-check", { hasText: "With the WAF policy" }).locator("input").check();
			await modal().getByRole("button", { name: "Make the profile" }).click();
			try {
				await page.getByText("The profile is made").waitFor({ timeout: 15000 });
			} catch {
				throw new Error(`the profile was not made: ${(await shownError()) || "no confirmation shown"}`);
			}
			const row = modal().locator("tr", { hasText: "gui profile" });
			await row.waitFor();
			const made = (await api("GET", "/nginxions/learning/profiles")).profiles?.find((p) => p.name === "gui profile");
			if (!made?.policy) throw new Error(`the profile carries no WAF policy: ${JSON.stringify(made)?.slice(0, 300)}`);
			const { startedAt } = await api("GET", "/nginxions/services/openappsec");
			if (!startedAt) throw new Error("the agent has no start time before applying the profile");
			await row.getByRole("button", { name: "Apply", exact: true }).click();
			await page.locator(".modal.show").last().getByRole("button", { name: "Apply", exact: true }).click();
			await page.getByText("The profile is applied, the agent restarts").waitFor({ timeout: 30000 });
			await panelRestarted(startedAt);
			if ((await api("GET", `/nginxions/waf/hosts/${id}`)).mode !== "prevent-learn")
				throw new Error("the WAF of the site changed");
			await go("/agents/open-appsec?tab=learning");
			await page.getByRole("button", { name: "Learning profiles" }).click();
			await modal().locator("tr", { hasText: "gui profile" }).getByRole("button", { name: "Remove", exact: true }).click();
			await page.locator(".modal.show").last().getByRole("button", { name: "Remove", exact: true }).click();
			await modal().locator("tr", { hasText: "gui profile" }).waitFor({ state: "detached", timeout: 15000 });
		},
		async cleanup() {
			for (const p of (await api("GET", "/nginxions/learning/profiles").catch(() => ({}))).profiles ?? []) {
				if (p.name === "gui profile") await api("DELETE", `/nginxions/learning/profiles/${p.id}`).catch(() => {});
			}
			await removeProxyHost("gui-profile.local").catch(() => {});
		},
	},
	{
		name: "default-site",
		title: "Settings → default site: «404» makes an unknown domain answer 404, «congratulations» brings the page back",
		async run() {
			const unknown = "gui-nobody.local";
			const choose = async (value) => {
				await go("/settings");
				await page.locator(`input[name='value'][value='${value}']`).check({ force: true });
				await page.getByRole("button", { name: "Save", exact: true }).click();
				await page.waitForTimeout(800);
				const err = await shownError();
				if (err) throw new Error(`default site ${value}: ${err}`);
			};
			// over HTTPS: the default site sends plain HTTP there
			await choose("404");
			await until(`${unknown} answers 404`, () => status(unknown, 404, "/", { tls: true }));
			await choose("congratulations");
			await until(`${unknown} answers the page of NginxionS`, () => status(unknown, 200, "/", { tls: true }));
		},
		cleanup: () => api("PUT", "/settings/default-site", { value: "congratulations", meta: {} }).catch(() => {}),
	},
	{
		name: "block-page",
		title: "Agents → Block page: the title set in the form is on the 403 page of an attack",
		async run() {
			const d = "gui-block.local";
			const title = "Blocked by the GUI test";
			await addProxyHost(d);
			await until(`${d} answers`, () => proxied(d));
			await setWaf(d, "Prevent");
			await until(`${d} blocks XSS`, () => status(d, 403, XSS), { timeout: 120000 });
			blockPageBefore = (await api("GET", "/nginxions/block-page/code").catch(() => ({}))).content;
			await go("/agents/block-page");
			await page.locator("#bp-title").fill(title);
			await page.getByRole("button", { name: "Save", exact: true }).click();
			await page.waitForTimeout(800);
			const err = await shownError();
			if (err) throw new Error(`block page: ${err}`);
			await until(`the 403 page of ${d} has the new title`, () =>
				site(d, XSS).then((r) => ({ ok: r.status === 403 && r.body.includes(title), status: r.status })),
			);
		},
		async cleanup() {
			await removeProxyHost("gui-block.local");
			if (blockPageBefore) await api("PUT", "/nginxions/block-page/code", { content: blockPageBefore }).catch(() => {});
		},
	},
	{
		name: "users-role",
		title: "Users → a user with the role Viewer: reads the hosts, may not create one (403)",
		async run() {
			const email = "gui-viewer@nginxions.test";
			const password = "gui-viewer-password-1";
			await go("/users");
			await page.getByRole("button", { name: "Add User" }).click();
			const modal = page.locator(".modal.show");
			await modal.locator("#name").fill("Gui Viewer");
			await modal.locator("#nickname").fill("viewer");
			await modal.locator("#email").fill(email);
			await modal.locator("#password").fill(password);
			// the roles of the user: only Viewer
			for (const role of ["Administrator", "Operator", "Security Analyst", "Viewer"]) {
				const box = modal.locator("label", { hasText: role }).locator("input[type=checkbox]").first();
				if ((await box.count()) && (await box.isChecked()) !== (role === "Viewer")) await box.click({ force: true });
			}
			await modal.getByRole("button", { name: "Save", exact: true }).click();
			await saved("the viewer");
			const viewer = await request.newContext({ ignoreHTTPSErrors: true, baseURL: ADMIN });
			try {
				const login = await viewer.post("/api/tokens", { data: { identity: email, secret: password } });
				if (login.status() !== 200) throw new Error(`the viewer could not log in: ${login.status()}`);
				const list = await viewer.get("/api/nginx/proxy-hosts");
				if (list.status() !== 200) throw new Error(`the viewer could not read the hosts: ${list.status()}`);
				const create = await viewer.post("/api/nginx/proxy-hosts", {
					data: { domain_names: ["gui-viewer.local"], forward_scheme: "http", forward_host: UPSTREAM, forward_port: 80 },
				});
				if (create.status() !== 403) throw new Error(`the viewer created a host: ${create.status()}`);
			} finally {
				await viewer.dispose();
			}
		},
		async cleanup() {
			await removeProxyHost("gui-viewer.local");
			const u = (await api("GET", "/users")).find((x) => x.email === "gui-viewer@nginxions.test");
			if (u) await api("DELETE", `/users/${u.id}`);
		},
	},
	{
		name: "users",
		title: "Users → Add User: the new user logs in; disabled in the form, the login is refused",
		async run() {
			const email = "gui-user@nginxions.test";
			const password = "gui-user-password-1";
			await go("/users");
			await page.getByRole("button", { name: "Add User" }).click();
			let modal = page.locator(".modal.show");
			await modal.locator("#name").fill("Gui User");
			await modal.locator("#nickname").fill("gui");
			await modal.locator("#email").fill(email);
			await modal.locator("#password").fill(password);
			await modal.getByRole("button", { name: "Save", exact: true }).click();
			await saved("new user");
			// a login of its own, not in the session of the page (it would take the place of the administrator)
			const login = async () => {
				const anon = await request.newContext({ ignoreHTTPSErrors: true });
				const code = (await anon.post(`${ADMIN}/api/tokens`, { data: { identity: email, secret: password } })).status();
				await anon.dispose();
				return code;
			};
			const first = await login();
			if (first !== 200) throw new Error(`the new user could not log in: ${first}`);
			await go(`/users?q=${encodeURIComponent(email)}`);
			const row = page.locator("tbody tr", { hasText: email }).first();
			await row.waitFor({ timeout: 20000 });
			// the menu of a row of Users (a dropdown of Bootstrap, the page of NPMplus)
			await row.locator(".dropdown-toggle").click();
			await row.locator(".dropdown-menu .dropdown-item", { hasText: "Edit" }).click();
			modal = page.locator(".modal.show");
			await modal.locator("#isDisabled").check();
			await modal.getByRole("button", { name: "Save", exact: true }).click();
			await saved("disable the user");
			const after = await login();
			if (after === 200) throw new Error("a disabled user still logs in");
		},
		async cleanup() {
			const u = (await api("GET", "/users")).find((x) => x.email === "gui-user@nginxions.test");
			if (u) await api("DELETE", `/users/${u.id}`);
		},
	},
];

// ------------------------------------------------------------------------------------------------- the run

const results = [];
for (const s of scenarios) {
	if (ONLY.length && !ONLY.includes(s.name)) continue;
	const r = { name: s.name, title: s.title, ok: false, error: "", seconds: 0 };
	const started = Date.now();
	pageErrors.length = 0;
	console.log(`==> ${s.title}`);
	try {
		// a scenario before may have restarted the panel (the nodes)
		await panelUp();
		await s.run();
		if (pageErrors.length) throw new Error(`errors in the page: ${pageErrors.join("; ")}`);
		r.ok = true;
	} catch (err) {
		// the first line, and for a timeout of Playwright the element it waited for
		const lines = String(err.message || err).split("\n");
		const waited = lines.find((l) => /waiting for/.test(l))?.trim();
		r.error = [lines[0], waited].filter(Boolean).join(" — ").slice(0, 500);
		console.log(`FAIL: ${r.error}`);
		await page.screenshot({ path: `${OUT}/${s.name}.png`, fullPage: true }).catch(() => {});
	}
	try {
		await panelUp().catch(() => {});
		await s.cleanup?.();
	} catch (err) {
		console.log(`    cleanup of ${s.name}: ${String(err.message || err).slice(0, 200)}`);
	}
	r.seconds = Math.round((Date.now() - started) / 1000);
	results.push(r);
}
await browser.close();

const failed = results.filter((r) => !r.ok);
writeFileSync(`${OUT}/gui-e2e.json`, `${JSON.stringify(results, null, 2)}\n`);
const md = [
	"## The interface driven like a user",
	"",
	`${results.length} scenarios, ${failed.length ? `**${failed.length} failed**` : "all passed"}.`,
	"",
	"| scenario | result | s |",
	"|---|---|---|",
	...results.map((r) => `| ${r.title} | ${r.ok ? "✅" : `❌ ${r.error.replaceAll("|", "\\|")}`} | ${r.seconds} |`),
	"",
];
writeFileSync(`${OUT}/gui-e2e.md`, md.join("\n"));
console.log(md.join("\n"));
process.exit(failed.length ? 1 : 0);
