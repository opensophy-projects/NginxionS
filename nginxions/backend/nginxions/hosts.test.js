import assert from "node:assert/strict";
import net from "node:net";
import { after, before, describe, test } from "node:test";
import errs from "../lib/error.js";
import { freshDatabase, postgres } from "./test/postgres.js";

const created = new Date("2026-11-01T08:00:00Z");
const changed = new Date("2026-11-01T09:00:00Z");
const host = {
	created_on: created,
	modified_on: changed,
	owner_user_id: 71,
	enabled: 1,
	meta: "{}",
};

function listen(t) {
	const server = net.createServer((socket) => socket.end());
	t.after(() => server.close());
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

describe("host history and upstreams on PostgreSQL", {
	skip: !postgres && "no test database (test/postgres.js)",
}, () => {
	let knex;
	let hosts;
	before(async () => {
		knex = await freshDatabase("hosts");
		({ default: hosts } = await import("./hosts.js"));
	});
	after(() => knex?.destroy());

	const proxy = (id, extra = {}) =>
		knex("proxy_host").insert({
			...host,
			id,
			domain_names: JSON.stringify([`proxy${id}.example.test`]),
			forward_host: "127.0.0.1",
			forward_port: 8080,
			...extra,
		});
	const audit = (object_id, action, meta, extra = {}) =>
		knex("audit_log")
			.insert({
				created_on: changed,
				modified_on: changed,
				user_id: 71,
				object_type: "proxy-host",
				object_id,
				action,
				meta: JSON.stringify(meta),
				...extra,
			})
			.returning("id");
	const access = {
		token: { getUserId: () => 71 },
		async can(label) {
			if (!label.startsWith("proxy_hosts:") && !label.startsWith("streams:")) throw new errs.PermissionError();
			return { permission_visibility: "user", nginxions_hosts: { proxy_host: [203] } };
		},
	};

	test("lists the latest record for visible hosts and rejects history from a previous occupant of the same ID", async () => {
		await knex("user").insert({
			id: 71,
			created_on: created,
			modified_on: changed,
			name: "",
			nickname: "Operator",
			email: "operator@example.test",
			avatar: "",
			roles: "[]",
		});
		await proxy(201);
		await proxy(202, { owner_user_id: 72 });
		await proxy(203, { owner_user_id: 72 });
		await proxy(204, { is_deleted: 1 });
		await proxy(205);
		await audit(201, "created", {
			forward_port: "8080",
			meta: { directory: "First", nginx_online: true },
		});
		const [{ id: edited }] = await audit(201, "updated", {
			forward_port: 8080,
			forward_scheme: "http",
			meta: { directory: "Second", nginx_online: false },
		});
		const [{ id: waf }] = await audit(
			201,
			"updated",
			{ enabled: true, mode: "detect-learn" },
			{ object_type: "waf" },
		);
		await audit(201, "updated", { forward_port: 8443, forward_scheme: "http", meta: { directory: "Second" } });
		await audit(201, "updated", { enabled: false }, { object_type: "waf" });
		await audit(202, "updated", {});
		await audit(203, "created", {}, { user_id: 72 });
		await audit(204, "updated", {});
		await audit(205, "updated", {}, { created_on: new Date("2026-10-01T08:00:00Z") });

		const changes = await hosts.changes(access);
		assert.deepEqual(changes.map((e) => e.object_id).sort(), [201, 203]);
		assert.deepEqual(changes.find((e) => e.object_id === 201).waf, { enabled: false, mode: null });
		assert.equal(changes.find((e) => e.object_id === 203).user.name, null);

		const history = await hosts.history(access, "proxy-host", 201);
		assert.deepEqual(
			history.map((e) => e.action),
			["updated-waf", "updated", "updated-waf", "updated", "created"],
		);
		assert.deepEqual(history[1].fields, ["forward_port"]);
		assert.deepEqual(history.find((e) => e.id === waf).waf, { enabled: true, mode: "detect-learn" });
		assert.equal(history[0].user.name, "Operator");
		assert.deepEqual(history.find((e) => e.id === edited).fields, ["meta.directory"]);
		assert.deepEqual(await hosts.history(access, "proxy-host", 205), []);
		await assert.rejects(hosts.history(access, "proxy-host", 204), errs.ItemNotFoundError);
		await assert.rejects(hosts.history(access, "unknown", 201), errs.ValidationError);
	});

	test("propagates a permission lookup outage instead of reporting an empty table", async () => {
		const error = new Error("Permission lookup unavailable");
		const unavailable = {
			...access,
			can: async () => {
				throw error;
			},
		};
		await assert.rejects(hosts.changes(unavailable), error);
		await assert.rejects(hosts.upstreams(unavailable), error);
	});

	test("reports reachable and closed TCP endpoints, deduplicates locations and skips invalid targets", async (t) => {
		const reachable = await listen(t);
		const peer = await listen(t);
		const port = reachable.address().port;
		const closed = peer.address().port;
		await new Promise((resolve) => peer.close(resolve));
		await proxy(211, {
			forward_port: port,
			locations: JSON.stringify([
				{ forward_scheme: "http", forward_host: "127.0.0.1", forward_port: port },
				{ forward_scheme: "http", forward_host: "127.0.0.1", forward_port: closed },
				{ forward_scheme: "http", forward_host: "127.0.0.1", forward_port: 65536 },
				{ forward_scheme: "http", forward_host: "unix:/tmp/upstream.sock", forward_port: port },
			]),
		});
		await proxy(212, { enabled: 0 });
		await proxy(213, { owner_user_id: 72 });
		await proxy(214, { forward_host: "$dynamic_upstream" });
		await proxy(215, { forward_port: 65536 });
		const stream = { ...host, forwarding_host: "127.0.0.1", forwarding_port: port };
		await knex("stream").insert([
			{ ...stream, id: 211, incoming_port: 9100, tcp_forwarding: 1 },
			{ ...stream, id: 212, incoming_port: 9101, forwarding_port: 65536, tcp_forwarding: 1 },
			{ ...stream, id: 213, incoming_port: 9102, udp_forwarding: 1 },
		]);
		const isolated = { ...access, can: async (label) => ({ ...(await access.can(label)), nginxions_hosts: {} }) };
		const results = (await hosts.upstreams(isolated)).filter((row) => row.object_id >= 211);
		assert.deepEqual(
			results.map(({ type, port, ok }) => [type, port, ok]),
			[
				["proxy-host", port, true],
				["proxy-host", closed, false],
				["stream", port, true],
			],
		);
		assert.equal(results[1].error, "ECONNREFUSED");
		assert.deepEqual(
			(await hosts.upstreams(isolated)).filter((row) => row.object_id >= 211),
			results,
		);
	});
});
