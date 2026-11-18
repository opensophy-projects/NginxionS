// The policy objects of WAF -> Policy on PostgreSQL (see ../test/postgres.js): what the editor of the interface does,
// down to local_policy.yaml (written to a temporary directory) and its versions.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { admin, freshDatabase, postgres } from "../test/postgres.js";

describe("WAF policy objects on PostgreSQL", { skip: !postgres && "no test database (test/postgres.js)" }, () => {
	let knex;
	let dir;
	let api;
	before(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "nginxions-policy-"));
		process.env.NGINXIONS_APPSEC_POLICY_FILE = path.join(dir, "local_policy.yaml");
		// no agent in the test: its answer is a closed port
		process.env.NGINXIONS_APPSEC_ORCHESTRATION_URL = "http://127.0.0.1:9";
		knex = await freshDatabase("waf");
		const { seedBuiltins } = await import("./objects/store.js");
		await seedBuiltins();
		api = (await import("./objects/api.js")).default;
	});
	after(async () => {
		await fs.rm(dir, { recursive: true, force: true });
		await knex?.destroy();
	});

	test("the built-in objects and the default policy", async () => {
		const state = await api.get(admin);
		assert.ok(state.objects.length > 0);
		assert.ok(state.objects.every((o) => o.builtin));
		assert.ok(state.policy.mode);
		assert.ok(Object.keys(state.templates).length > 0);
	});

	test("an exception: created, renamed, used by the default policy, versions, rollback, deleted", async () => {
		const created = await api.create(admin, {
			kind: "exception",
			name: "allow-health",
			description: "health checks",
			spec: { action: "skip", condition: [{ key: "url", value: "/health" }] },
		});
		assert.ok(created.id);
		await assert.rejects(
			api.create(admin, { kind: "exception", name: "allow-health", spec: { action: "skip", condition: [] } }),
			"the same name twice",
		);
		await assert.rejects(api.create(admin, { kind: "nothing", name: "x", spec: {} }), "an unknown kind");

		const updated = await api.update(admin, created.id, {
			kind: "exception",
			name: "allow-healthz",
			spec: { action: "skip", condition: [{ key: "url", value: "/healthz" }] },
		});
		assert.equal(updated.name, "allow-healthz");
		await assert.rejects(
			api.update(admin, created.id, { kind: "log_trigger", name: "x", spec: {} }),
			"the kind changes",
		);

		const before = await api.get(admin);
		const preview = await api.preview(admin, {
			policy: { ...before.policy, exceptions: [created.id] },
		});
		assert.equal(preview.valid, true);
		assert.ok(
			preview.diff.some((l) => l.op === "+"),
			"the preview shows the exception",
		);

		await api.setPolicy(admin, { ...before.policy, exceptions: [created.id] });
		await assert.rejects(api.delete(admin, created.id), "an exception the policy uses");

		const exported = await api.export(admin, "v1beta2");
		const text = typeof exported === "string" ? exported : (exported.content ?? JSON.stringify(exported));
		assert.match(text, /allow-healthz/);

		const versions = await api.versions(admin);
		assert.ok(versions.length >= 2);
		const first = versions[versions.length - 1];
		await api.rollback(admin, first.id);
		const back = await api.get(admin);
		assert.ok(!back.objects.some((o) => o.name === "allow-healthz"), "the rollback brings the first version back");
	});

	test("import: a dry run changes nothing, the import creates the objects", async () => {
		const yaml = [
			"apiVersion: v1beta2",
			"policies:",
			"  default:",
			"    mode: detect-learn",
			"    threatPreventionPractices: [imported-practice]",
			"    accessControlPractices: []",
			"    triggers: []",
			"    exceptions: [imported-exception]",
			"threatPreventionPractices:",
			"  - name: imported-practice",
			"    practiceMode: inherited",
			"    webAttacks:",
			"      overrideMode: inherited",
			"      minimumConfidence: high",
			"exceptions:",
			"  - name: imported-exception",
			"    action: skip",
			"    condition:",
			"      - key: sourceIp",
			"        value: 10.0.0.1",
		].join("\n");
		const dry = await api.import(admin, yaml, true);
		assert.ok(dry);
		assert.ok(!(await api.get(admin)).objects.some((o) => o.name === "imported-exception"));
		await api.import(admin, yaml, false);
		const after = await api.get(admin);
		assert.ok(after.objects.some((o) => o.name === "imported-exception"));
		assert.equal(after.policy.mode, "detect-learn");
	});
});
