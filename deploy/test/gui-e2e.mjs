// The interface driven like a user (Playwright, Chromium): each scenario does something in the GUI of NginxionS (clicks,
// forms, switches) and checks its effect where it matters, not in the interface: a site answers or refuses, a login is
// asked for, an attack is blocked, a ban takes effect, a user can log in. Run by scripts/test-airgap.sh (GUI_E2E=1)
// after smoke, with the session of smoke (its cookie jar on the volume test-state), in the closed network.
//
//   ADMIN   the interface (https://nginxions:81)      HTTP   the sites (http://nginxions)
//   JAR     the cookie jar of smoke                    OUT    screenshots of failures, gui-e2e.json and .md
//   ONLY    a comma list of scenarios to run (all by default)
//
// A failed scenario does not stop the others; the test fails at its end. Every scenario cleans up what it made.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
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

/** waits until check() returns a truthy value; the last value is in the error */
async function until(what, check, { timeout = 60000, every = 1500 } = {}) {
	const end = Date.now() + timeout;
	let last;
	while (Date.now() < end) {
		last = await check();
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
const scenarios = [
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
			await page.locator("tbody tr", { hasText: d }).first().waitFor({ timeout: 20000 });
			await setWaf(d, "Off");
			await until(`${d} not inspected when Off`, () => proxied(d, XSS), { timeout: 120000 });
		},
		cleanup: () => removeProxyHost("gui-waf.local"),
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
