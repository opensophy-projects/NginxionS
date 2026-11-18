// The SQL of the request log, of analytics and of the events on PostgreSQL (see ../test/postgres.js): what nginx and
// the agent log goes through the real ingestion and comes back through every tab of the interface.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { admin, freshDatabase, postgres } from "../test/postgres.js";

const NOW = new Date();
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60 * 1000);
const iso = (d) => d.toISOString().replace("Z", "");

// one line of the access log of nginx (log_format nginxions_requests)
const line = (minutes, extra = {}) =>
	JSON.stringify({
		t: (ago(minutes).getTime() / 1000).toFixed(3),
		h: "app.example.com",
		port: "443",
		ip: "203.0.113.7",
		m: "GET",
		u: "/index.html",
		s: 200,
		b: 5120,
		rl: 300,
		rt: 0.042,
		ut: "0.030",
		uct: "0.002",
		us: "200",
		ua_addr: "10.0.0.2:8080",
		cache: "",
		proto: "HTTP/2.0",
		tls: "TLSv1.3",
		ct: "text/html; charset=utf-8",
		ref: "https://example.org/",
		ua: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
		al: "en-US",
		...extra,
	});

const attack = (minutes, extra = {}) => ({
	eventTime: iso(ago(minutes)),
	eventName: "Web Request",
	eventSeverity: "Critical",
	eventPriority: "High",
	eventSource: { serviceName: "HTTP Transaction Handler", assetName: "app.example.com" },
	eventData: {
		securityAction: "Prevent",
		waapIncidentType: "SQL Injection",
		sourceIP: "198.51.100.9",
		httpHostName: "app.example.com",
		httpMethod: "GET",
		httpUriPath: "/search",
		httpUriQuery: "id=1' OR '1'='1",
		matchedLocation: "url",
		matchedParameter: "id",
		matchedSample: "1' OR '1'='1",
		waapFoundIndicators: ["sqli_tautology"],
		waapFinalScore: 9.2,
		httpResponseCode: "403",
		ruleName: "npm-managed-specific-rule-proxyhost-1",
		...extra,
	},
});

describe("analytics on PostgreSQL", { skip: !postgres && "no test database (test/postgres.js)" }, () => {
	let knex;
	let dir;
	before(async () => {
		knex = await freshDatabase("events");
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "nginxions-requests-"));
		const lines = [];
		for (let i = 0; i < 30; i++) lines.push(line(5 + i));
		for (let i = 0; i < 5; i++) lines.push(line(10 + i, { s: 404, u: `/missing/${i}`, ct: "text/plain" }));
		for (let i = 0; i < 3; i++)
			lines.push(line(20 + i, { s: 502, us: "502", h: "api.example.com", u: "/v1/items" }));
		lines.push(line(15, { s: 403, ip: "198.51.100.9", u: "/search", ua: "sqlmap/1.8" }));
		lines.push(line(16, { h: "static.example.com", cache: "HIT", ct: "image/png", u: "/logo.png" }));
		const file = path.join(dir, "requests.log");
		await fs.writeFile(file, `${lines.join("\n")}\n`);
		const { pollOnce } = await import("./requests.js");
		await pollOnce({ file });

		const { classify } = await import("./normalize.js");
		const { store } = await import("./store.js");
		const events = [
			attack(15),
			attack(25, { securityAction: "Detect" }),
			attack(40, { waapIncidentType: "Cross Site Scripting" }),
		]
			.map((e) => classify(e))
			.filter((c) => c.type === "event")
			.map((c) => c.row);
		await store({ events, telemetry: [], cursors: [] });
	});
	after(async () => {
		await fs.rm(dir, { recursive: true, force: true });
		await knex?.destroy();
	});

	test("the log of nginx is in the request log", async () => {
		const [{ count }] = await knex("nginxions_request_log").count("* as count");
		assert.equal(Number(count), 40);
	});

	test("every tab of Analytics answers, for every period", async () => {
		const traffic = (await import("./traffic.js")).default;
		for (const period of ["1h", "24h", "7d", "30d"]) {
			for (const tab of ["requests", "visitors", "performance", "security", "cache", "origin"]) {
				const r = await traffic.get(admin, { period, tab }, NOW);
				assert.equal(r.tab, tab, `${period} ${tab}`);
				assert.ok(!r.unsupported, `${period} ${tab}`);
				assert.ok(Array.isArray(r.timeline), `${period} ${tab}: timeline`);
			}
		}
		const r = await traffic.get(admin, { period: "24h", tab: "requests" }, NOW);
		const total = r.timeline.reduce((n, b) => n + Number(b.requests ?? 0), 0);
		assert.equal(total, 40);
	});

	test("filters narrow the tabs and the log", async () => {
		const traffic = (await import("./traffic.js")).default;
		const all = await traffic.list(admin, { period: "24h", limit: 100 }, NOW);
		assert.equal(all.total, 40);
		const api = await traffic.list(admin, { period: "24h", host: "api.example.com" }, NOW);
		assert.equal(api.total, 3);
		assert.ok(api.rows.every((r) => r.host === "api.example.com"));
		const errors = await traffic.list(admin, { period: "24h", status: "404" }, NOW);
		assert.equal(errors.total, 5);
		const tab = await traffic.get(admin, { period: "24h", tab: "requests", host: "api.example.com" }, NOW);
		assert.equal(
			tab.timeline.reduce((n, b) => n + Number(b.requests ?? 0), 0),
			3,
		);
		// pages by the cursor of the previous page
		const first = await traffic.list(admin, { period: "24h", limit: 10 }, NOW);
		assert.equal(first.rows.length, 10);
		const second = await traffic.list(admin, { period: "24h", limit: 10, before: first.next }, NOW);
		assert.equal(second.rows.length, 10);
		assert.ok(!second.rows.some((r) => first.rows.some((f) => f.id === r.id)), "pages overlap");
		const file = await traffic.export(admin, { period: "24h" }, NOW);
		assert.equal(file.rows.length, 40);
		assert.equal(file.capped, false);
	});

	test("the attacks of the agent are in Analytics and in the events", async () => {
		const analytics = (await import("./analytics.js")).default;
		for (const period of ["1h", "24h", "7d", "30d"]) {
			const a = await analytics.get(admin, { period }, NOW);
			assert.ok(a.kpi.attacks >= (period === "1h" ? 3 : 3), `${period}: ${a.kpi.attacks}`);
		}
		const a = await analytics.get(admin, { period: "24h" }, NOW);
		assert.equal(a.kpi.attacks, 3);
		assert.equal(a.kpi.prevented, 2);
		assert.equal(a.kpi.detected, 1);
		assert.ok(a.types.some((t) => t.type === "SQL Injection"));
		assert.ok(a.traffic.requests >= 40);
		const host = await analytics.get(admin, { period: "24h", host: "app.example.com" }, NOW);
		assert.equal(host.host, "app.example.com");
	});
});
