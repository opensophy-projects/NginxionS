// The package of a node on PostgreSQL (see ../test/postgres.js): what the manager puts in it, and what a node does
// with it (rows, ids, a second time, removal, a domain taken, nginx refusing a host). nginx and the files of
// certificates are replaced: the rows and the result are what is checked.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { freshDatabase, postgres } from "../test/postgres.js";

const ADMIN = { can: async () => true, token: { getUserId: () => 1 } };
const NOW = new Date();
/** a JSON column: an object from PostgreSQL json, a string from text */
const obj = (v) => (typeof v === "string" ? JSON.parse(v || "{}") : (v ?? {}));

describe("packages of nodes on PostgreSQL", { skip: !postgres && "no PostgreSQL for tests" }, () => {
	let knex;
	let nodes;
	let pkg;
	let apply;
	let content;
	const dir = mkdtempSync(path.join(tmpdir(), "nginxions-package-"));
	// what nginx would do: every configured host online, or the ones named refused
	let refuse = new Set();
	const io = {
		configure: async (ids) => {
			for (const id of ids) {
				const row = await knex("proxy_host").where({ id }).first();
				const meta = obj(row.meta);
				Object.assign(
					meta,
					refuse.has(id) ? { nginx_online: false, nginx_err: "bad" } : { nginx_online: true },
				);
				await knex("proxy_host")
					.where({ id })
					.update({ meta: JSON.stringify(meta) });
			}
		},
		removeConfig: async () => {},
		writeCertificate: async () => {},
	};

	const insert = async (table, row) => {
		const [r] = await knex(table)
			.insert({ created_on: NOW, modified_on: NOW, ...row })
			.returning("id");
		return r.id ?? r;
	};
	const host = (domain, extra = {}) => ({
		owner_user_id: 1,
		is_deleted: 0,
		domain_names: JSON.stringify([domain]),
		forward_host: "upstream",
		forward_port: 80,
		enabled: 1,
		meta: "{}",
		locations: "[]",
		...extra,
	});

	before(async () => {
		process.env.NGINXIONS_SECRET_KEY_FILE = path.join(dir, "secret.key");
		process.env.NGINXIONS_SIGNING_KEY_FILE = path.join(dir, "signing.key");
		knex = await freshDatabase("node_package");
		await import("../routes.js");
		({ default: nodes } = await import("./index.js"));
		pkg = await import("./package.js");
		apply = await import("./apply.js");
	});
	after(async () => {
		await knex?.destroy();
	});

	test("the manager: the hosts of the node, their own certificate and access list, WAF; ACME left out", async () => {
		const own = await insert("certificate", {
			owner_user_id: 1,
			is_deleted: 0,
			provider: "other",
			nice_name: "own",
			domain_names: JSON.stringify(["shop.example.com"]),
			expires_on: NOW,
			meta: JSON.stringify({ certificate: "CERT", certificate_key: "KEY" }),
		});
		const acme = await insert("certificate", {
			owner_user_id: 1,
			is_deleted: 0,
			provider: "letsencrypt",
			nice_name: "acme",
			domain_names: JSON.stringify(["blog.example.com"]),
			expires_on: NOW,
			meta: "{}",
		});
		const list = await insert("access_list", { owner_user_id: 1, is_deleted: 0, name: "staff", meta: "{}" });
		await insert("access_list_auth", { access_list_id: list, username: "alice", password: "x", meta: "{}" });
		await insert("access_list_client", {
			access_list_id: list,
			address: "10.0.0.0/8",
			directive: "allow",
			meta: "{}",
		});
		const shop = await insert(
			"proxy_host",
			host("shop.example.com", { certificate_id: own, access_list_id: list }),
		);
		const blog = await insert("proxy_host", host("blog.example.com", { certificate_id: acme }));
		await insert("proxy_host", host("manager-only.example.com"));
		await knex("nginxions_waf_host").insert({
			proxy_host_id: shop,
			enabled: true,
			mode: "prevent-learn",
			modified_on: NOW,
		});

		const { node } = await nodes.add(ADMIN, { name: "edge" });
		await assert.rejects(() => nodes.setHosts(ADMIN, node.id, [shop, 999999]), /Unknown proxy hosts: 999999/);
		assert.deepEqual(await nodes.setHosts(ADMIN, node.id, [blog, shop]), [shop, blog]);
		assert.deepEqual((await nodes.list(ADMIN))[0].host_ids.sort(), [shop, blog].sort());

		content = await pkg.contentOf(node.id);
		assert.deepEqual(content.hosts.map((h) => h.id).sort(), [shop, blog].sort());
		assert.deepEqual(content.hosts.find((h) => h.id === shop).domain_names, ["shop.example.com"]);
		assert.deepEqual(
			content.certificates.map((c) => c.id),
			[own],
		);
		assert.deepEqual(content.skipped, [{ kind: "certificate", id: acme, name: "acme", reason: "letsencrypt" }]);
		assert.equal(content.access_lists[0].items[0].username, "alice");
		assert.equal(content.access_lists[0].clients[0].address, "10.0.0.0/8");
		assert.equal(content.waf_hosts[0].mode, "prevent-learn");

		// the version changes only with the content
		const a = await pkg.packageOf(node.id);
		const b = await pkg.packageOf(node.id);
		assert.equal(a.version, b.version);
		await knex("nginxions_waf_host").where({ proxy_host_id: shop }).update({ mode: "detect-learn" });
		assert.notEqual((await pkg.packageOf(node.id)).version, a.version);
		// out of work: no hosts in its package, its hosts stay given to it; back: they are in the package again
		assert.equal((await nodes.drain(ADMIN, node.id, true)).drained, true);
		assert.deepEqual((await pkg.contentOf(node.id)).hosts, []);
		assert.deepEqual((await nodes.hosts(ADMIN, node.id)).sort(), [shop, blog].sort());
		await nodes.drain(ADMIN, node.id, false);
		content = await pkg.contentOf(node.id);
		assert.equal(content.hosts.length, 2);

		// this database becomes "the node": the rows of the manager are gone, only the package is left
		await knex("nginxions_waf_host").delete();
		await knex("access_list_auth").delete();
		await knex("access_list_client").delete();
		await knex("proxy_host").delete();
		await knex("access_list").delete();
		await knex("certificate").delete();
	});

	test("the node: rows of its own for the package, the same rows the second time", async () => {
		const result = await apply.applyContent(content, io);
		assert.equal(result.hosts, 2);
		assert.deepEqual(result.offline, []);
		const shop = await knex("proxy_host").whereRaw("domain_names::text like ?", ["%shop.example.com%"]).first();
		const cert = await knex("certificate").where({ id: shop.certificate_id }).first();
		assert.equal(obj(cert.meta).certificate_key, "KEY");
		assert.equal(obj(cert.meta).nginxions_managed, true);
		const list = await knex("access_list").where({ id: shop.access_list_id }).first();
		assert.equal(list.name, "staff");
		assert.equal((await knex("access_list_auth").where({ access_list_id: list.id })).length, 1);
		assert.equal((await knex("nginxions_waf_host").where({ proxy_host_id: shop.id }).first()).mode, "detect-learn");
		assert.equal(obj(shop.meta).nginxions_managed, true);
		// the host of an ACME certificate comes without it (its renewal is on the manager)
		const blog = await knex("proxy_host").whereRaw("domain_names::text like ?", ["%blog.example.com%"]).first();
		assert.equal(blog.certificate_id, 0);
		assert.ok(result.skipped.some((s) => s.reason === "letsencrypt"));

		await apply.applyContent(content, io);
		assert.equal((await knex("proxy_host")).length, 2, "no copies");
		assert.equal((await knex("certificate")).length, 1);
		assert.equal((await knex("access_list_auth")).length, 1);
	});

	test("a host of the node itself is never touched, and its domain is not taken by the package", async () => {
		await insert("proxy_host", host("local.example.com"));
		const clash = {
			...content,
			hosts: [...content.hosts, { ...content.hosts[0], id: 777, domain_names: ["local.example.com"] }],
		};
		const result = await apply.applyContent(clash, io);
		assert.equal(result.hosts, 2);
		assert.ok(result.skipped.some((s) => s.id === 777 && /taken: local.example.com/.test(s.reason)));
		assert.equal((await knex("proxy_host")).length, 3);
	});

	test("what the package no longer has is removed, with its certificate and access list", async () => {
		const shopSource = content.hosts.find((h) => h.domain_names.includes("shop.example.com"));
		const smaller = {
			...content,
			hosts: content.hosts.filter((h) => h !== shopSource),
			certificates: [],
			access_lists: [],
			waf_hosts: [],
		};
		await apply.applyContent(smaller, io);
		const names = (await knex("proxy_host")).map((r) => JSON.stringify(r.domain_names)).join(" ");
		assert.doesNotMatch(names, /shop\.example\.com/);
		assert.match(names, /local\.example\.com/, "the host of the node stays");
		assert.equal((await knex("certificate")).length, 0);
		assert.equal((await knex("access_list")).length, 0);
		assert.equal((await knex("access_list_auth")).length, 0);
	});

	test("a host nginx refuses is in the result (the node then goes back to the package before)", async () => {
		const before = await knex("nginxions_managed").where({ kind: "proxy_host" });
		refuse = new Set(before.map((m) => m.local_id));
		const result = await apply.applyContent(content, io);
		refuse = new Set();
		assert.ok(result.offline.length >= 1);
		assert.equal(result.offline[0].error, "bad");
	});
});
