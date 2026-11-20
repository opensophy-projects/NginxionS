// Nodes on PostgreSQL (see ../test/postgres.js): the manager side through its functions, and the whole join of a node
// through member.js against a real HTTPS server in front of it (the pin of the certificate of the manager included).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
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

	before(async () => {
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
				let raw = "";
				req.on("data", (d) => {
					raw += d;
				});
				req.on("end", async () => {
					// an error of the manager is an answer (500 with its message), never a request left without one
					try {
						await answerOf(raw);
					} catch (err) {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: { code: 500, message: String(err.message) } }));
					}
				});
				const answerOf = async (raw) => {
					const body = JSON.parse(raw || "{}");
					let answer = null;
					if (req.url === "/api/nginxions/nodes/register")
						answer = await nodes.register(body, "198.51.100.7");
					if (req.url === "/api/nginxions/nodes/events") {
						answer = await nodes.events(
							/^Bearer\s+(\S+)$/.exec(req.headers.authorization || "")?.[1],
							body.events,
						);
					}
					if (req.url === "/api/nginxions/nodes/package") {
						answer = await nodes.package(/^Bearer\s+(\S+)$/.exec(req.headers.authorization || "")?.[1]);
					}
					if (req.url === "/api/nginxions/nodes/heartbeat") {
						const token = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || "")?.[1];
						answer = await nodes.heartbeat(token, body.info, "198.51.100.7");
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
		await knex?.destroy();
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

		const left = await member.default.leave(ADMIN);
		assert.equal(left.joined, false);
		assert.equal(await nodes.remove(ADMIN, row.id), true);
		assert.deepEqual(await nodes.list(ADMIN), []);
	});
});
