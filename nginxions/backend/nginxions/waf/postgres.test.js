// The policy objects of WAF -> Policy on PostgreSQL (see ../test/postgres.js): what the editor of the interface does,
// down to local_policy.yaml (written to a temporary directory) and its versions.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import YAML from "yaml";
import { admin, freshDatabase, postgres } from "../test/postgres.js";

describe("WAF policy objects on PostgreSQL", { skip: !postgres && "no test database (test/postgres.js)" }, () => {
	let knex;
	let dir;
	let api;
	before(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "nginxions-policy-"));
		process.env.NGINXIONS_APPSEC_POLICY_FILE = path.join(dir, "local_policy.yaml");
		process.env.NGINXIONS_WAF_POLICY_BACKUP_DIR = path.join(dir, "backups");
		process.env.NGINXIONS_APPSEC_MODEL_DIR = path.join(dir, "model");
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

	test("expert preview, save and rollback validate the same policy", async () => {
		const { default: expert } = await import("./expert.js");
		const initial = await expert.get(admin);
		for (const yaml of [
			"policies:\n  default:\n    mode: unknown\n",
			"policies:\n  default:\n    accessControlPractices: not-a-list\n",
			"policies:\n  default:\n    practices: [missing-practice]\n",
		]) {
			const preview = await expert.check(admin, yaml);
			assert.equal(preview.valid, false);
			await assert.rejects(expert.save(admin, { content: yaml }), { message: preview.error });
		}
		assert.deepEqual((await expert.get(admin)).versions, initial.versions);
		const first = await expert.save(admin, { content: "policies:\n  default:\n    mode: prevent-learn\n" });
		const next = "policies:\n  default:\n    mode: inactive\n";
		const preview = await expert.check(admin, next);
		assert.equal(preview.valid, true);
		assert.ok(preview.diff.some(({ op, line }) => op === "+" && line.includes("mode: inactive")));
		const second = await expert.save(admin, { content: next });
		const rolledBack = await expert.rollback(admin, first.id);
		assert.ok(rolledBack.id > second.id);
		assert.equal(rolledBack.content, first.content);
		assert.match(await fs.readFile(process.env.NGINXIONS_APPSEC_POLICY_FILE, "utf8"), /mode: prevent-learn/);
		await expert.save(admin, { content: "" });
	});

	test("bootstrap imports legacy policies and ignores WAF overrides for disabled locations", async () => {
		const { bootstrap, buildPolicy, regenerateNow } = await import("./policy.js");
		const host = {
			id: 1,
			owner_user_id: 1,
			created_on: new Date(),
			modified_on: new Date(),
			domain_names: JSON.stringify(["legacy-policy.test"]),
			forward_host: "upstream.test",
			forward_port: "80",
			access_list_id: 0,
			certificate_id: 0,
			advanced_config: "",
			meta: "{}",
			locations: JSON.stringify([{ path: "/check" }]),
		};
		await knex("proxy_host").insert(host);
		const backupFixture = fileURLToPath(
			new URL("../../../../deploy/test/fixtures/npm-backup.tgz", import.meta.url),
		);
		const source = execFileSync("tar", ["-xOzf", backupFixture, "appsec-localconfig/local_policy.yaml"], {
			encoding: "utf8",
		});
		const policy = YAML.parse(source);
		policy.policies["specific-rules"].push({ name: "npm-managed-specific-rule-proxyhost-1-0", mode: "inactive" });
		const legacy = YAML.stringify(policy);
		await fs.writeFile(process.env.NGINXIONS_APPSEC_POLICY_FILE, legacy);
		await bootstrap();
		const backups = process.env.NGINXIONS_WAF_POLICY_BACKUP_DIR;
		const original = (await fs.readdir(backups)).find((name) => name.endsWith("-before-nginxions.yaml"));
		assert.equal(await fs.readFile(path.join(backups, original), "utf8"), legacy);
		const waf = await knex("nginxions_waf_host").where({ proxy_host_id: 1 }).first();
		assert.equal(waf.mode, "prevent-learn");
		assert.equal(waf.minimum_confidence, "high");
		const location = await knex("nginxions_waf_location").where({ proxy_host_id: 1, path: "/check" }).first();
		assert.equal(location.enabled, false);
		const rules = async () =>
			(await buildPolicy()).doc.policies.specificRules.map(({ host, mode }) => [host, mode]);
		assert.deepEqual(await rules(), [
			["legacy-policy.test", "prevent-learn"],
			["legacy-policy.test/check", "inactive"],
		]);
		await knex("proxy_host")
			.where({ id: 1 })
			.update({ locations: JSON.stringify([{ path: "/check", npmplus_enabled: false }]) });
		assert.deepEqual(await rules(), [["legacy-policy.test", "prevent-learn"]]);
		await knex("proxy_host")
			.where({ id: 1 })
			.update({ domain_names: JSON.stringify(["renamed-policy.test"]) });
		assert.deepEqual(await rules(), [["renamed-policy.test", "prevent-learn"]]);
		await knex("proxy_host").where({ id: 1 }).update({ is_deleted: 1 });
		assert.deepEqual(await rules(), []);
		for (let version = 0; version < 23; version++) {
			await fs.writeFile(process.env.NGINXIONS_APPSEC_POLICY_FILE, `# snapshot ${version}\n`);
			await regenerateNow();
		}
		assert.equal((await fs.readdir(backups)).length, 20);
	});

	test("model upload validates the archive before replacing the model and can restore the last one", async () => {
		const { default: agent } = await import("./agent-settings.js");
		const resources = fileURLToPath(
			new URL("../../../../openappsec/agent/components/security_apps/waap/resources/", import.meta.url),
		);
		const archive = execFileSync("tar", ["--format=pax", "-czf", "-", "-C", resources, "waap.data"], {
			maxBuffer: 16 * 1024 * 1024,
		});
		const upload = (body) => {
			const stream = Readable.from([body]);
			stream.headers = { "content-length": String(body.length) };
			return agent.uploadModel(admin, stream, false);
		};
		const installed = await upload(archive);
		assert.equal(installed.present, true);
		for (const invalid of [gzipSync("this is not a tar archive"), archive.subarray(0, archive.length - 4)]) {
			await assert.rejects(upload(invalid), /Invalid advanced model archive/);
			assert.equal((await agent.get(admin)).model.sha256, installed.sha256);
		}
		assert.equal((await agent.removeModel(admin, false)).present, false);
		assert.equal((await agent.previousModel(admin, false)).sha256, installed.sha256);
	});
});
