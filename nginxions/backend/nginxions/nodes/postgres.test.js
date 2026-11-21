// Nodes on PostgreSQL (see ../test/postgres.js): the manager side through its functions, and the whole join of a node
// through member.js against a real HTTPS server in front of it (the pin of the certificate of the manager included).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { freshDatabase, postgres } from "../test/postgres.js";

const ADMIN = { can: async () => true, token: { getUserId: () => 1 } };
const VIEWER = {
	can: async (permission) => {
		if (permission !== "nodes:view") throw new Error(`forbidden: ${permission}`);
	},
	token: { getUserId: () => 2 },
};

describe("nodes on PostgreSQL", { skip: !postgres && "no PostgreSQL for tests" }, () => {
	let knex;
	let nodes;
	let member;
	let server;
	let managerUrl;
	const dir = mkdtempSync(path.join(tmpdir(), "nginxions-nodes-"));
	// the shared storage and smartsync of the manager (step 15.4): what reaches them
	const learned = [];
	const fakeServices = [];
	const fake = (name, answer) =>
		new Promise((resolve) => {
			const service = http.createServer((req, res) => {
				const chunks = [];
				req.on("data", (d) => chunks.push(d));
				req.on("end", () => {
					learned.push({
						name,
						method: req.method,
						url: req.url,
						tenant: req.headers["x-tenant-id"],
						body: Buffer.concat(chunks).toString(),
					});
					const [status, body] = answer(req);
					res.writeHead(status, { "Content-Type": "application/json" });
					res.end(body);
				});
			});
			fakeServices.push(service);
			service.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${service.address().port}`));
		});

	// nginxions-control of this server (step 15.5): what the agent learned, and the state restored
	const agentLearned = { files: [] };
	const restored = [];
	before(async () => {
		process.env.NGINXIONS_CONTROL_URL = await fake("control", (req) => {
			if (req.url === "/v1/agent/learning/snapshot") return [200, JSON.stringify(agentLearned)];
			if (req.url === "/v1/agent/learning") return [200, "[]"];
			return [200, '{"restored": true}'];
		});
		writeFileSync(path.join(dir, "control_token"), "t");
		process.env.NGINXIONS_CONTROL_TOKEN_FILE = path.join(dir, "control_token");
		process.env.NGINXIONS_LEARNING_PROFILE_DIR = path.join(dir, "profiles");
		process.env.NGINXIONS_APPSEC_MODEL_DIR = path.join(dir, "model");
		process.env.NGINXIONS_LEARNING_SNAPSHOT_DIR = path.join(dir, "snapshots");
		process.env.NGINXIONS_APPSEC_STORAGE_URL = await fake("storage", (req) =>
			req.url.includes("missing") ? [404, "{}"] : [200, '{"stored": true}'],
		);
		process.env.NGINXIONS_APPSEC_SMARTSYNC_URL = await fake("smartsync", () => [200, ""]);
		// the settings file of the agent (its learning role): never /ext of the machine running the tests
		process.env.NGINXIONS_APPSEC_POLICY_FILE = path.join(dir, "appsec", "local_policy.yaml");
		process.env.NGINXIONS_SECRET_KEY_FILE = path.join(dir, "secret.key");
		process.env.NGINXIONS_MEMBER_FILE = path.join(dir, "cluster", "member.json");
		// the signing key of the manager (step 15.2): never /data of the machine running the tests
		process.env.NGINXIONS_SIGNING_KEY_FILE = path.join(dir, "manager-signing.key");
		knex = await freshDatabase("nodes");
		// the routes load the PKI in its order (it has a cycle with mTLS when imported alone)
		await import("../routes.js");
		({ default: nodes } = await import("./index.js"));
		member = await import("./member.js");
		// a manager: the two routes without login, in front of the functions of nodes, over HTTPS
		execFileSync("openssl", [
			"req",
			"-x509",
			"-newkey",
			"ec",
			"-pkeyopt",
			"ec_paramgen_curve:prime256v1",
			"-nodes",
			"-keyout",
			path.join(dir, "panel.key"),
			"-out",
			path.join(dir, "panel.crt"),
			"-days",
			"2",
			"-subj",
			"/CN=manager.test",
		]);
		server = https.createServer(
			{ key: readFileSync(path.join(dir, "panel.key")), cert: readFileSync(path.join(dir, "panel.crt")) },
			(req, res) => {
				const chunks = [];
				req.on("data", (d) => chunks.push(d));
				req.on("end", async () => {
					// an error of the manager is an answer (500 with its message), never a request left without one
					try {
						await answerOf(Buffer.concat(chunks));
					} catch (err) {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: { code: 500, message: String(err.message) } }));
					}
				});
				const token = () => /^Bearer\s+(\S+)$/.exec(req.headers.authorization || "")?.[1];
				const answerOf = async (raw) => {
					// the learning routes (bytes in and out), as routes.js has them: the path not normalized
					const [pathname, search = ""] = req.url.split(/\?(.*)/s);
					const storagePrefix = "/api/nginxions/nodes/learning/storage";
					if (pathname.startsWith(storagePrefix) || pathname === "/api/nginxions/nodes/learning/sync") {
						const answer = pathname.startsWith(storagePrefix)
							? await nodes.learningStorage(token(), {
									method: req.method,
									rawPath: pathname.slice(storagePrefix.length),
									query: new URLSearchParams(search),
									body: raw,
								})
							: await nodes.learningSync(token(), raw);
						if (!answer) {
							res.writeHead(401);
							return res.end();
						}
						res.writeHead(answer.status, { "Content-Type": answer.type });
						return res.end(answer.body);
					}
					const body = JSON.parse(raw.toString() || "{}");
					let answer = null;
					if (req.url === "/api/nginxions/nodes/register")
						answer = await nodes.register(body, "198.51.100.7");
					if (req.url === "/api/nginxions/nodes/events") answer = await nodes.events(token(), body.events);
					if (req.url === "/api/nginxions/nodes/package") answer = await nodes.package(token());
					if (req.url === "/api/nginxions/nodes/model") {
						const model = await nodes.wafModel(token());
						if (model?.file) {
							res.writeHead(200, { "Content-Type": "application/gzip" });
							return res.end(readFileSync(model.file));
						}
						res.writeHead(model ? 404 : 401);
						return res.end();
					}
					if (req.url === "/api/nginxions/nodes/learning/profile") {
						const profile = await nodes.learningProfile(token());
						if (profile?.bytes) {
							res.writeHead(200, { "Content-Type": "application/gzip" });
							return res.end(profile.bytes);
						}
						res.writeHead(profile ? 404 : 401);
						return res.end();
					}
					if (req.url === "/api/nginxions/nodes/heartbeat") {
						answer = await nodes.heartbeat(token(), body.info, "198.51.100.7");
					}
					res.writeHead(answer ? 200 : 401, { "Content-Type": "application/json" });
					res.end(JSON.stringify(answer ?? { error: { code: 401, message: "Unknown" } }));
				};
			},
		);
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		managerUrl = `https://127.0.0.1:${server.address().port}`;
	});
	after(async () => {
		server?.close();
		for (const service of fakeServices) service.close();
		await (await import("./relay.js")).stopRelay();
		await knex?.destroy();
	});

	test("the thresholds of the learning of the nodes: saved in the GUI, written for smartsync", async () => {
		const { default: clusterSettings } = await import("./cluster-settings.js");
		assert.deepEqual(await clusterSettings.get(VIEWER), {
			minSources: 3,
			minSourcesTypes: 10,
			minIntervals: 5,
			ratioThreshold: 0.8,
		});
		const next = { minSources: 4, minSourcesTypes: 12, minIntervals: 6, ratioThreshold: 0.7 };
		await assert.rejects(() => clusterSettings.set(VIEWER, next), /forbidden: nodes:manage/);
		assert.deepEqual(await clusterSettings.set(ADMIN, next), next);
		assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "appsec", "nginxions-smartsync.json"), "utf8")), next);
		await assert.rejects(() => clusterSettings.set(ADMIN, { ...next, minSources: 1 }), /sources 2–1000/);
	});

	test("a viewer sees the list but adds no node", async () => {
		assert.deepEqual(await nodes.list(VIEWER), []);
		await assert.rejects(() => nodes.add(VIEWER, { name: "edge-1" }), /forbidden: nodes:manage/);
	});

	test("a node joins with its code: certificate from the PKI, token, heartbeat, the code works once", async () => {
		const { node, code } = await nodes.add(ADMIN, { name: "edge-1", labels: ["EU", "edge"] });
		assert.equal(node.state, "pending");
		assert.deepEqual(node.labels, ["eu", "edge"]);
		await assert.rejects(() => nodes.add(ADMIN, { name: "edge-1" }), /exists/);

		const status = await member.default.join(ADMIN, { manager_url: managerUrl, code });
		assert.equal(status.joined, true);
		assert.equal(status.uid, node.uid);
		assert.equal(status.name, "edge-1");
		assert.match(status.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

		const [row] = await nodes.list(ADMIN);
		assert.equal(row.status, "active");
		assert.equal(row.state, "online");
		assert.equal(row.address, "198.51.100.7");
		// the certificate of the node is signed by the trust domain of the nodes, its CN is the id of the node
		const cert = await knex("nginxions_pki_cert").where({ common_name: node.uid }).first();
		const ca = await knex("nginxions_pki_ca").where({ id: cert.ca_id }).first();
		assert.equal(ca.name, "NginxionS Nodes");
		assert.equal(cert.profile, "client");
		// the key stayed on the node: the PKI keeps none
		assert.equal(cert.key_enc, null);

		// the code is spent
		await assert.rejects(
			() => member.default.join(ADMIN, { manager_url: managerUrl, code }),
			/joined|node of a manager/,
		);
		assert.equal(await nodes.register({ code, csr_pem: "x" }), null);

		await member.beat();
		const state = await member.readState();
		assert.equal(state.last_error, "");
		// the key of the manager is pinned, the (empty) package of the node is applied and its version told
		assert.match(state.signing_key, /BEGIN PUBLIC KEY/);
		assert.match(state.applied_version, /^[0-9a-f]{64}$/);
		assert.equal(state.package_error, "");
		// an event of this server after the join goes to the manager with the id of the node (one database here: the
		// manager keeps it as a second row)
		const { classify } = await import("../events/normalize.js");
		const { store } = await import("../events/store.js");
		const { row: event } = classify({
			eventTime: new Date().toISOString().replace("Z", ""),
			eventName: "Web Request",
			eventSeverity: "Critical",
			eventSource: { serviceName: "HTTP Transaction Handler", assetName: "shop.example.com" },
			eventData: { securityAction: "Prevent", waapIncidentType: "SQL Injection", sourceIP: "198.51.100.20" },
		});
		await store({ events: [event], telemetry: [], cursors: [] });
		await member.beat();
		assert.equal((await nodes.list(ADMIN))[0].info.package_version, state.applied_version);
		const copies = await knex("nginxions_security_event").where({ source_ip: "198.51.100.20" });
		assert.deepEqual(copies.map((e) => e.node_id).sort(), ["local", node.uid].sort());
		assert.equal((await member.readState()).events_error, "");
		// sent once: the next heartbeat sends nothing again
		await member.beat();
		assert.equal((await knex("nginxions_security_event").where({ source_ip: "198.51.100.20" })).length, 2);
		assert.equal((await nodes.list(ADMIN))[0].info.version.length > 0, true);
		// the rollout: the package the node applied, once (later heartbeats with the same version add nothing)
		const rollout = await nodes.rollout(VIEWER);
		assert.deepEqual(
			rollout.map((r) => [r.kind, r.result, r.version, r.node_name]),
			[["package", "applied", state.applied_version, "edge-1"]],
		);
		assert.deepEqual(await nodes.rollout(VIEWER, { node_id: row.id + 1000 }), []);
		// a manager with a node: the learning of the cluster from its storage (empty here)
		assert.deepEqual(await nodes.clusterLearning(VIEWER), { available: true, assets: [], error: "" });
	});

	test("the agent of the node learns through the manager: its relay, the storage and smartsync there", async () => {
		// the role in the settings of the agent: through the manager (a node) and smartsync (this manager has a node)
		const env = readFileSync(path.join(dir, "appsec", "nginxions-agent.env"), "utf8");
		assert.match(env, /^NGINXIONS_LEARNING_VIA=manager$/m);
		assert.match(env, /^NGINXIONS_SMARTSYNC=true$/m);

		const relay = await import("./relay.js");
		const [storagePort, syncPort] = await relay.startRelay({ storagePort: 0, syncPort: 0 });
		const { uid } = await member.readState();
		// the agent sends its path as it is (no URL normalization, as fetch would do with ".." and "%2e%2e")
		const agent = (port, method, urlPath, body) =>
			new Promise((resolve, reject) => {
				const req = http.request({ host: "127.0.0.1", port, method, path: urlPath }, (res) => {
					const chunks = [];
					res.on("data", (d) => chunks.push(d));
					res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
				});
				req.on("error", reject);
				req.end(body);
			});
		learned.length = 0;
		// the data of a window: under the id of the node, whatever the agent calls itself
		let answer = await agent(
			storagePort,
			"PUT",
			"/api//shop/Indicators/Confidence/window_0_1/agent-a/data.data0",
			'{"w":1}',
		);
		assert.equal(answer.status, 200, answer.text);
		assert.deepEqual(learned.at(-1), {
			name: "storage",
			method: "PUT",
			url: `/api/shop/Indicators/Confidence/window_0_1/${uid}/agent-a/data.data0`,
			tenant: "local",
			body: '{"w":1}',
		});
		// reads: the state put together and the labels of the manager; a file not there yet is the 404 of the storage
		answer = await agent(storagePort, "GET", "/api/?list-type=2&prefix=/shop/Indicators/Confidence/remote");
		assert.equal(answer.status, 200);
		assert.equal(learned.at(-1).url, "/api/?list-type=2&prefix=%2Fshop%2FIndicators%2FConfidence%2Fremote");
		assert.equal((await agent(storagePort, "GET", "/api//shop/tuning/missing.data")).status, 404);
		// the state put together, the processed state of an agent, the labels: never written by a node
		const before = learned.length;
		for (const file of ["remote/confidence.data", "processed/confidence.data"]) {
			answer = await agent(storagePort, "PUT", `/api//shop/Indicators/Confidence/${file}`, "{}");
			assert.equal(answer.status, 403, file);
		}
		assert.equal((await agent(storagePort, "PUT", "/api//shop/tuning/decisions.data", "[]")).status, 403);
		assert.equal((await agent(storagePort, "GET", "/api//shop/../../etc/passwd")).status, 400);
		assert.equal(learned.length, before, "nothing refused reached the storage");
		// the notification to smartsync: its fields only
		answer = await agent(
			syncPort,
			"POST",
			"/api/sync",
			JSON.stringify({ assetId: "shop", type: "Indicators/Confidence", windowId: "window_0_1", x: 1 }),
		);
		assert.equal(answer.status, 200, answer.text);
		assert.deepEqual(
			{ ...learned.at(-1), body: JSON.parse(learned.at(-1).body) },
			{
				name: "smartsync",
				method: "POST",
				url: "/api/sync",
				tenant: "local",
				body: { assetId: "shop", type: "Indicators/Confidence", windowId: "window_0_1" },
			},
		);
		assert.equal((await agent(syncPort, "POST", "/api/sync", "{}")).status, 400);
		assert.equal((await agent(syncPort, "GET", "/health/live")).status, 404);
		// the state of the node shows what its relay did last
		const status = await member.default.status(ADMIN);
		assert.ok(status.learning.last_ok_on);
		assert.equal(status.learning.requests > 5, true);
	});

	test("a new node starts with the learning profile of its manager, never over what it learned", async () => {
		const { default: profiles } = await import("../learning/profiles.js");
		const gz = (text) => gzipSync(JSON.stringify(text)).toString("base64");
		const [{ id: shop }] = await knex("proxy_host")
			.insert({
				created_on: new Date(),
				modified_on: new Date(),
				owner_user_id: 1,
				is_deleted: 0,
				domain_names: JSON.stringify(["shop.example.com"]),
				forward_host: "upstream",
				forward_port: 80,
				enabled: 1,
				meta: "{}",
				locations: "[]",
			})
			.returning("id");
		// what the agent of the manager learned: the shop (its API location too) and another site
		agentLearned.files = [
			{ asset: "shop.example.com", name: "5.data", content: gz({ learned: "shop" }) },
			{ asset: "shop.example.com/api", name: "4.data", content: gz({ learned: "api" }) },
			{ asset: "other.example.com", name: "5.data", content: gz({ learned: "other" }) },
		];
		await assert.rejects(() => profiles.create(VIEWER, { name: "shop", host_ids: [shop] }), /forbidden/);
		await assert.rejects(() => profiles.create(ADMIN, { name: "a/b", host_ids: [shop] }), /name of the profile/);
		const meta = await profiles.create(ADMIN, { name: "Shop prod", host_ids: [shop] });
		assert.equal(meta.files, 2, "the files of the site only");
		assert.equal(meta.own, true);
		assert.deepEqual(meta.sites, [{ domains: ["shop.example.com"] }]);
		// the file: downloaded, uploaded again is the same profile
		const file = await profiles.download(ADMIN, meta.id);
		await assert.rejects(() => profiles.upload(ADMIN, file.content), /here already/);
		await assert.rejects(() => profiles.upload(ADMIN, Buffer.from("junk")), /not a learning profile/);

		// the node serves the shop; the profile for new nodes is in its package, by version
		const [row] = await nodes.list(ADMIN);
		await nodes.setHosts(ADMIN, row.id, [shop]);
		const { contentOf } = await import("./package.js");
		assert.equal((await contentOf(row.id)).learning_profile, undefined);
		await profiles.setForNewNodes(ADMIN, meta.id, true);
		assert.deepEqual((await contentOf(row.id)).learning_profile, { id: meta.id, version: meta.version });

		// the node has learned the API location of the shop itself: nothing of the shop is replaced
		agentLearned.files = [{ asset: "shop.example.com/api", name: "4.data", content: gz({ own: 1 }) }];
		learned.length = 0;
		const state = await member.readState();
		let change = await member.fetchProfile(state, { id: meta.id, version: meta.version });
		assert.deepEqual(change, { profile_version: meta.version, profile_assets: 0, profile_error: "" });
		assert.equal(learned.filter((r) => r.url === "/v1/agent/learning/restore").length, 0);

		// a node that learned nothing of it: the site is filled, what else it learned stays
		agentLearned.files = [{ asset: "blog.example.com", name: "5.data", content: gz({ own: 2 }) }];
		change = await member.fetchProfile({ ...state, profile_version: "" }, { id: meta.id, version: meta.version });
		assert.equal(change.profile_assets, 1, change.profile_error);
		const restore = learned.find((r) => r.url === "/v1/agent/learning/restore");
		assert.deepEqual(
			JSON.parse(restore.body)
				.files.map((f) => `${f.asset}/${f.name}`)
				.sort(),
			["blog.example.com/5.data", "shop.example.com/5.data", "shop.example.com/api/4.data"],
		);
		// the same version again: nothing fetched
		assert.deepEqual(await member.fetchProfile({ ...state, profile_version: meta.version }, meta), {});

		// a profile signed by another key than the one the node pinned is refused
		const other = await member.fetchProfile(
			{
				...state,
				profile_version: "",
				signing_key: (await import("node:crypto"))
					.generateKeyPairSync("ed25519")
					.publicKey.export({ type: "spki", format: "pem" }),
			},
			{ id: meta.id, version: meta.version },
		);
		assert.match(other.profile_error, /not signed by the manager/);

		// applied here, for the sites of these hosts; then off for new nodes and deleted
		agentLearned.files = [];
		const applied = await profiles.apply(ADMIN, meta.id, { host_ids: [shop] });
		assert.deepEqual(applied.assets, ["shop.example.com"]);
		await profiles.setForNewNodes(ADMIN, meta.id, false);
		assert.equal(await nodes.learningProfile("x"), null);
		await nodes.setHosts(ADMIN, row.id, []);
		await profiles.remove(ADMIN, meta.id);
		assert.deepEqual((await profiles.list(ADMIN)).profiles, []);
	});

	test("the model of the agent of the manager goes to its nodes, checked by its hash", async () => {
		const { createHash } = await import("node:crypto");
		const { mkdirSync } = await import("node:fs");
		const { MODEL_FILE } = await import("../waf/model-file.js");
		const [row] = await nodes.list(ADMIN);
		const { contentOf } = await import("./package.js");
		assert.equal((await contentOf(row.id)).waf_model, undefined, "no model uploaded: the model of the image");
		// a model uploaded on the manager: its hash and size are in the signed package of every node
		const model = gzipSync(Buffer.from("a model of the agent".repeat(1000)));
		mkdirSync(path.dirname(MODEL_FILE), { recursive: true });
		writeFileSync(MODEL_FILE, model);
		const sha256 = createHash("sha256").update(model).digest("hex");
		const ref = (await contentOf(row.id)).waf_model;
		assert.deepEqual(ref, { sha256, size: model.length });

		// the node fetches it over its pinned channel into a file, as the package names it
		const state = await member.readState();
		let fetched = null;
		const install = async (fetchTo, wanted) => {
			const file = path.join(dir, "model-of-the-node.tgz");
			await fetchTo(file);
			fetched = { bytes: readFileSync(file), wanted };
		};
		let change = await member.syncModel({ ...state, model_sha256: "" }, ref, { install });
		assert.deepEqual(change, { model_sha256: sha256, model_error: "" });
		assert.deepEqual(fetched, { bytes: model, wanted: sha256 });
		// the same model: nothing fetched
		fetched = null;
		assert.deepEqual(await member.syncModel({ ...state, model_sha256: sha256 }, ref, { install }), {});
		assert.equal(fetched, null);
		// a size the manager did not answer with: the download stops, the error is told
		change = await member.syncModel({ ...state, model_sha256: "" }, { sha256, size: 10 }, { install });
		assert.match(change.model_error, /too big/);
		// the manager without a model: the node goes back to the model of the image
		let removed = 0;
		change = await member.syncModel({ ...state, model_sha256: sha256 }, undefined, {
			remove: async () => {
				removed += 1;
			},
		});
		assert.deepEqual(change, { model_sha256: "", model_error: "" });
		assert.equal(removed, 1);
	});

	test("another certificate on the address of the manager: the node sends nothing", async () => {
		const state = await member.readState();
		await assert.rejects(
			() =>
				member.managerRequest(managerUrl, "/api/nginxions/nodes/heartbeat", {
					pin: "00:11",
					body: { info: {} },
				}),
			/certificate of the manager changed/,
		);
		assert.ok(state.fingerprint);
	});

	test("a code with the CN of another node is refused, and the code is spent", async () => {
		const { node, code } = await nodes.add(ADMIN, { name: "edge-2" });
		const { generateKey } = await import("../pki/x509.js");
		const { makeCsr } = await import("../pki/ops.js");
		const csr = await makeCsr({ keyPem: generateKey("ec-p256"), subject: { common_name: "n-0000000000000000" } });
		await assert.rejects(() => nodes.register({ code, csr_pem: csr }), /CN of the request/);
		assert.equal((await nodes.list(ADMIN)).find((n) => n.uid === node.uid).status, "pending");
		assert.equal(await nodes.register({ code, csr_pem: csr }), null);
		const fresh = await nodes.newCode(ADMIN, node.id);
		assert.notEqual(fresh.code, code);
		await nodes.remove(ADMIN, node.id);
	});

	test("disabled on the manager: certificate revoked, the next heartbeat says so and the node stops", async () => {
		const [row] = await nodes.list(ADMIN);
		await assert.rejects(() => nodes.remove(ADMIN, row.id), /Disable the node first/);
		const revoked = await nodes.revoke(ADMIN, row.id);
		assert.equal(revoked.state, "revoked");
		const cert = await knex("nginxions_pki_cert").where({ common_name: row.uid }).first();
		assert.ok(cert.revoked_on);

		await member.beat();
		const state = await member.readState();
		assert.equal(state.disabled, true);
		assert.match(state.last_error, /disabled/);

		// disabled: its relay says so (503), the agent learns here again
		const env = readFileSync(path.join(dir, "appsec", "nginxions-agent.env"), "utf8");
		assert.doesNotMatch(env, /NGINXIONS_LEARNING_VIA/);
		assert.doesNotMatch(env, /NGINXIONS_SMARTSYNC/);

		const left = await member.default.leave(ADMIN);
		assert.equal(left.joined, false);
		assert.equal(await nodes.remove(ADMIN, row.id), true);
		assert.deepEqual(await nodes.list(ADMIN), []);
	});
});
