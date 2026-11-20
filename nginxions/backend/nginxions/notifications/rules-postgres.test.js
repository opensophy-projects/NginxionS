// The checks of the rules of notifications on PostgreSQL (see ../test/postgres.js): each rule reads the tables that
// the rest of NginxionS writes, and gives the alerts a message is sent for.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { freshDatabase, postgres } from "../test/postgres.js";

const NOW = new Date();
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60000);
const inDays = (days) => new Date(NOW.getTime() + days * 86400000);

describe("rules of notifications on PostgreSQL", { skip: !postgres && "no PostgreSQL for tests" }, () => {
	let knex;
	let check;
	before(async () => {
		knex = await freshDatabase("notification_rules");
		({ check } = await import("./rules.js"));
	});
	after(async () => {
		await knex?.destroy();
	});

	test("attack spike: fires from the threshold on, per host, with the top source", async () => {
		const { classify } = await import("../events/normalize.js");
		const { store } = await import("../events/store.js");
		const attack = (minutes, ip, host = "app.example.com") =>
			classify({
				eventTime: ago(minutes).toISOString().replace("Z", ""),
				eventName: "Web Request",
				eventSeverity: "Critical",
				eventSource: { serviceName: "HTTP Transaction Handler", assetName: host },
				eventData: { securityAction: "Prevent", waapIncidentType: "SQL Injection", sourceIP: ip, httpHostName: host },
			}).row;
		await store({
			events: [
				attack(1, "198.51.100.9"),
				attack(2, "198.51.100.9"),
				attack(3, "203.0.113.5"),
				// out of the window of 5 minutes
				attack(30, "198.51.100.9"),
				attack(1, "198.51.100.9", "other.example.com"),
			],
			telemetry: [],
			cursors: [],
		});
		assert.deepEqual(await check("attack_spike", { threshold: 5, window: 5 }, NOW), []);
		const all = await check("attack_spike", { threshold: 4, window: 5 }, NOW);
		assert.equal(all.length, 1);
		assert.equal(all[0].key, "spike");
		assert.equal(all[0].values.count, 4);
		assert.equal(all[0].values.top, "198.51.100.9");
		const host = await check("attack_spike", { threshold: 3, window: 5, host: "APP.example.com " }, NOW);
		assert.equal(host[0].key, "spike:app.example.com");
		assert.equal(host[0].values.count, 3);
	});

	test("expiring certificates: TLS of a host by hand, PKI in use, CAs; renewed and revoked ones are not news", async () => {
		const certificate = (nice_name, days, provider = "other") => ({
			created_on: NOW,
			modified_on: NOW,
			owner_user_id: 1,
			is_deleted: 0,
			provider,
			nice_name,
			domain_names: JSON.stringify([`${nice_name}.example.com`]),
			expires_on: inDays(days),
			meta: "{}",
		});
		await knex("certificate").insert([certificate("soon", 5), certificate("later", 200), certificate("gone", -2)]);
		const [ca] = await knex("nginxions_pki_ca")
			.insert({
				created_on: NOW,
				modified_on: NOW,
				name: "Root",
				kind: "root",
				subject: "{}",
				subject_dn: "CN=Root",
				serial: "01",
				not_before: ago(60),
				not_after: inDays(10),
				fingerprint: "f",
				key_type: "ec",
				cert_pem: "",
				meta: "{}",
			})
			.returning("id");
		const pki = (serial, common_name, days, extra = {}) => ({
			created_on: NOW,
			modified_on: NOW,
			ca_id: ca.id ?? ca,
			profile: "client",
			serial,
			common_name,
			subject: "{}",
			sans: "[]",
			not_before: ago(60),
			not_after: inDays(days),
			fingerprint: serial,
			key_type: "ec",
			cert_pem: "",
			...extra,
		});
		await knex("nginxions_pki_cert").insert([
			pki("a1", "alice", 3),
			pki("b2", "bob", 3, { revoked_on: NOW, revoke_reason: "keyCompromise" }),
			pki("c3", "carol", 100),
		]);
		const alerts = await check("cert_expiry", { days: 14 }, NOW);
		const names = alerts.map((a) => a.values.name).sort();
		assert.deepEqual(names, ["Root", "alice", "gone", "soon"]);
		const soon = alerts.find((a) => a.values.name === "soon");
		assert.equal(soon.values.stage, "7");
		assert.equal(soon.values.domains, "soon.example.com");
		assert.equal(alerts.find((a) => a.values.name === "gone").values.stage, "expired");
		assert.equal(alerts.find((a) => a.values.name === "alice").values.domains, "PKI, client");
		assert.equal(alerts.find((a) => a.values.name === "Root").values.domains, "CA, root");
	});

	test("host problems: an enabled host nginx refused is an alert, a disabled or a working one is not", async () => {
		const host = (name, enabled, meta) => ({
			created_on: NOW,
			modified_on: NOW,
			owner_user_id: 1,
			is_deleted: 0,
			domain_names: JSON.stringify([name]),
			forward_host: "upstream",
			forward_port: 80,
			enabled,
			meta: JSON.stringify(meta),
		});
		await knex("proxy_host").insert([
			host("broken.example.com", 1, { nginx_online: false, nginx_err: "no port in upstream" }),
			host("off.example.com", 0, { nginx_online: false, nginx_err: "x" }),
			host("fine.example.com", 1, { nginx_online: true }),
		]);
		const alerts = await check("host_problem", {}, NOW);
		assert.equal(alerts.length, 1);
		assert.equal(alerts[0].values.name, "broken.example.com");
		assert.equal(alerts[0].values.error, "no port in upstream");
	});

	test("trials of blocking: an ended one that waits for a decision, with its report", async () => {
		const id = (await knex("proxy_host").whereRaw("domain_names::text like ?", ["%fine.example.com%"]).first("id")).id;
		await knex("nginxions_waf_trial").insert([
			{
				proxy_host_id: id,
				started_on: ago(24 * 60),
				ends_on: ago(0),
				mode: "prevent-learn",
				finished_on: NOW,
				report: JSON.stringify({ events: 12, toBlock: 10, toPass: 2 }),
			},
			// still running: not news yet
			{ proxy_host_id: id, started_on: ago(60), ends_on: inDays(1), mode: "prevent-learn", report: "{}" },
		]);
		const alerts = await check("waf_trial", {}, NOW);
		assert.equal(alerts.length, 1);
		assert.deepEqual(alerts[0].values, { name: "fine.example.com", hours: 24, events: 12, toBlock: 10, toPass: 2 });
	});

	test("the WAF switched off: no alert of the agent or of the policy", async () => {
		const { setSetting } = await import("../settings.js");
		await setSetting("waf.enabled", false);
		assert.deepEqual(await check("agent_down", {}, NOW), []);
		assert.deepEqual(await check("policy_error", {}, NOW), []);
	});
});
