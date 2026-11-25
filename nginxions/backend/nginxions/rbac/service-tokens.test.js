import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import knex from "knex";
import { freshDatabase, postgres } from "../test/postgres.js";

test("service token migration supports SQLite and can roll back", async (t) => {
	const db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
	t.after(() => db.destroy());
	await db.raw("PRAGMA foreign_keys = ON");
	await db.schema.createTable("nginxions_role", (table) => table.increments("id"));
	const { up, down } = await import("../migrations/20261125000100_nginxions_service_token.js");
	await up(db);
	const [roleId] = await db("nginxions_role").insert({});
	const [tokenId] = await db("nginxions_service_token").insert({
		name: "SQLite fixture",
		token_digest: "a".repeat(64),
		created_by: 1,
		created_on: new Date(),
		expires_on: new Date(),
	});
	await db("nginxions_service_token_role").insert({ token_id: tokenId, role_id: roleId });
	await db("nginxions_role").where({ id: roleId }).delete();
	assert.deepEqual(await db("nginxions_service_token_role"), []);
	await down(db);
	assert.equal(await db.schema.hasTable("nginxions_service_token"), false);
	assert.equal(await db.schema.hasTable("nginxions_service_token_role"), false);
});

test("service token API and RBAC with PostgreSQL", { skip: !postgres }, async (t) => {
	const db = await freshDatabase("service_tokens");
	t.after(() => db.destroy());
	process.env.DISABLE_GRAVATAR = "true";
	process.env.OIDC_DISABLE_PASSWORD = "false";
	const { getCompiledSchema } = await import("../../schema/index.js");
	await getCompiledSchema();

	const { default: app } = await import("../../app.js");
	const { default: userModel } = await import("../../models/user.js");
	const { default: proxyModel } = await import("../../models/proxy_host.js");
	const { default: audit } = await import("../../internal/audit-log.js");
	const { authenticateServiceToken } = await import("./service-tokens.js");
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(() => new Promise((resolve) => server.close(resolve)));

	const request = async (path, { method = "GET", cookie, bearer, body } = {}) => {
		const headers = {};
		if (cookie) headers.Cookie = cookie;
		if (bearer) headers.Authorization = `Bearer ${bearer}`;
		if (body) headers["Content-Type"] = "application/json";
		const res = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
			method,
			headers,
			body: JSON.stringify(body),
		});
		return { res, data: await res.json() };
	};
	const session = async (email) => {
		const { res } = await request("/tokens", {
			method: "POST",
			body: {
				identity: email,
				secret: "fixture-password",
			},
		});
		assert.equal(res.status, 200);
		return res.headers.getSetCookie()[0].split(";")[0];
	};
	const email = "operator@example.test";
	const { res: setup, data: admin } = await request("/users", {
		method: "POST",
		body: { name: "Owner", nickname: "Owner", email, auth: { type: "password", secret: "fixture-password" } },
	});
	assert.equal(setup.status, 201, admin.error?.message);
	const cookie = await session(email);
	const login = await request("/users/me", { cookie });
	assert.equal(login.res.status, 200);
	assert.equal(login.data.id, admin.id);

	const hosts = "/nginx/proxy-hosts";
	const tokens = "/nginxions/rbac/service-tokens";
	const roles = "/nginxions/rbac/roles";
	const allRoles = (await request(roles, { cookie })).data;
	const viewer = allRoles.find(({ builtin }) => builtin === "viewer");
	const administrator = allRoles.find(({ builtin }) => builtin === "administrator");
	const proxy = (domain) =>
		proxyModel.query().insert({
			owner_user_id: admin.id,
			domain_names: [domain],
			forward_host: "upstream",
			forward_scheme: "http",
			forward_port: 80,
			npmplus_location_config: "",
		});
	const published = await proxy("shared.example.test");
	const other = await proxy("private.example.test");
	const role = {
		name: "Read selected hosts",
		scope: "hosts",
		hosts: [{ host_type: "proxy_host", host_id: published.id }],
		permissions: ["proxy_hosts:view", "waf_policy:view"],
	};
	const { res: roleResponse, data: scoped } = await request(roles, { cookie, method: "POST", body: role });
	assert.equal(roleResponse.status, 201);
	const issue = (roles) =>
		request(tokens, {
			cookie,
			method: "POST",
			body: { name: "Automation fixture", roles, expires_in_days: 30 },
		});

	await t.test("management requires a session of an administrator and valid non-admin roles", async () => {
		assert.equal((await request(tokens)).res.status, 403);
		const { default: authModel } = await import("../../models/auth.js");
		const delegate = await userModel.query().insert({
			name: "Role editor",
			nickname: "editor",
			email: "editor@example.test",
			avatar: "",
			roles: [],
		});
		await authModel.query().insert({ user_id: delegate.id, type: "password", secret: "fixture-password" });
		const { data: delegated } = await request(roles, {
			cookie,
			method: "POST",
			body: {
				name: "Role editors",
				scope: "all",
				permissions: ["roles:manage"],
			},
		});
		assert.equal(
			(
				await request(`/nginxions/rbac/users/${delegate.id}`, {
					cookie,
					method: "PUT",
					body: { roles: [delegated.id] },
				})
			).res.status,
			200,
		);
		const delegatedCookie = await session(delegate.email);
		assert.equal((await request(roles, { cookie: delegatedCookie })).res.status, 200);
		assert.equal((await request(tokens, { cookie: delegatedCookie })).res.status, 403);
		for (const assigned of [[administrator.id], [2147483647], [], [scoped.id, scoped.id]]) {
			assert.equal((await issue(assigned)).res.status, 400);
		}
		const { res } = await request(tokens, {
			cookie,
			method: "POST",
			body: { name: "Invalid lifetime", roles: [viewer.id], expires_in_days: 366 },
		});
		assert.equal(res.status, 400);
		const blankName = await request(tokens, {
			cookie,
			method: "POST",
			body: { name: "  ", roles: [viewer.id], expires_in_days: 1 },
		});
		assert.equal(blankName.res.status, 400);
		assert.equal((await request(`${tokens}/2147483647`, { cookie, method: "DELETE" })).res.status, 404);
		assert.deepEqual((await request(tokens, { cookie })).data, []);
	});

	const { res, data: created } = await issue([scoped.id]);
	assert.equal(res.status, 201);
	const { id, secret: bearer } = created;
	assert.match(bearer, /^nxs_svc_[A-Za-z0-9_-]{43}$/);
	assert.match(res.headers.get("cache-control"), /no-store/);
	const record = await db("nginxions_service_token").where({ id }).first();
	assert.equal(record.token_digest, createHash("sha256").update(bearer).digest("hex"));
	assert.equal(Object.hasOwn(created, "token_digest"), false);
	const list = await request(tokens, { cookie });
	assert.deepEqual(
		list.data.map(({ roles, status }) => ({ roles, status })),
		[{ roles: [scoped.id], status: "active" }],
	);
	assert.equal(JSON.stringify(list.data).includes(bearer), false);

	await t.test("scope is based on assigned roles and selected hosts", async () => {
		const { res, data } = await request(hosts, { bearer });
		assert.equal(res.status, 200);
		assert.match(res.headers.get("ratelimit-policy"), /q=1200; *w=60/);
		assert.deepEqual(
			data.map(({ id }) => id),
			[published.id],
		);
		assert.equal((await request(`${hosts}/${published.id}`, { bearer })).res.status, 200);
		assert.equal((await request(`${hosts}/${other.id}`, { bearer })).res.status, 404);
		assert.equal((await request(`/nginxions/waf/hosts/${published.id}`, { bearer })).res.status, 200);
		assert.equal((await request("/nginxions/waf/policy", { bearer })).res.status, 403);
		assert.equal(
			(
				await request(`${hosts}/${published.id}`, {
					bearer,
					method: "PUT",
					body: { forward_port: 8080 },
				})
			).res.status,
			403,
		);
		assert.equal((await request("/nginx/access-lists", { bearer })).res.status, 403);
		assert.equal((await request("/tokens", { bearer })).res.status, 403);
		assert.equal((await request("/users/me", { bearer })).res.status, 403);
		assert.equal((await request(tokens, { bearer, cookie })).res.status, 403);
	});

	await t.test("changes to assigned roles are live and deleting a role removes its grants", async () => {
		const changed = await request(`${tokens}/${id}`, {
			cookie,
			method: "PUT",
			body: { roles: [scoped.id, viewer.id] },
		});
		assert.equal(changed.res.status, 200);
		assert.equal(Object.hasOwn(changed.data, "secret"), false);
		const global = await request(hosts, { bearer });
		assert.deepEqual(new Set(global.data.map(({ id }) => id)), new Set([published.id, other.id]));
		await request(`${tokens}/${id}`, { cookie, method: "PUT", body: { roles: [scoped.id] } });
		const updated = await request(`${roles}/${scoped.id}`, {
			cookie,
			method: "PUT",
			body: { ...role, hosts: [{ host_type: "proxy_host", host_id: other.id }] },
		});
		assert.equal(updated.res.status, 200);
		assert.deepEqual(
			(await request(hosts, { bearer })).data.map(({ id }) => id),
			[other.id],
		);
		assert.equal((await request(`${roles}/${scoped.id}`, { cookie, method: "DELETE" })).res.status, 200);
		assert.equal((await request(hosts, { bearer })).res.status, 403);
		assert.deepEqual((await request(tokens, { cookie })).data[0].roles, []);
	});

	await t.test("revocation, expiry, and inactive issuers refuse the credential", async () => {
		const replacement = (await issue([viewer.id])).data;
		const revoked = () => request(`${tokens}/${replacement.id}`, { cookie, method: "DELETE" });
		assert.equal((await request(hosts, { bearer: replacement.secret })).res.status, 200);
		assert.equal((await revoked()).res.status, 200);
		assert.equal((await revoked()).res.status, 200);
		const refused = await request(hosts, { bearer: replacement.secret, cookie });
		assert.equal(refused.res.status, 401);
		assert.equal(refused.res.headers.get("www-authenticate"), "Bearer");
		assert.equal((await request(hosts, { bearer: "nxs_svc_invalid" })).res.status, 401);
		assert.equal(
			(
				await request(`${tokens}/${replacement.id}`, {
					cookie,
					method: "PUT",
					body: { roles: [viewer.id] },
				})
			).res.status,
			400,
		);

		const expiring = (await issue([viewer.id])).data;
		await db("nginxions_service_token")
			.where({ id: expiring.id })
			.update({ expires_on: new Date(0) });
		assert.equal((await request(hosts, { bearer: expiring.secret })).res.status, 401);
		assert.equal(
			(
				await request(`${tokens}/${expiring.id}`, {
					cookie,
					method: "PUT",
					body: { roles: [viewer.id] },
				})
			).res.status,
			400,
		);
		assert.equal((await request(tokens, { cookie })).data[0].status, "expired");

		const issuer = await userModel.query().insert({
			name: "Secondary administrator",
			nickname: "secondary",
			email: "secondary@example.test",
			avatar: "",
			roles: ["admin"],
		});
		await db("nginxions_service_token").where({ id }).update({ created_by: issuer.id });
		await userModel.query().findById(issuer.id).patch({ is_disabled: true });
		assert.equal((await request(hosts, { bearer })).res.status, 401);
		assert.equal((await request(tokens, { cookie })).data.find((row) => row.id === id).status, "issuer_inactive");

		const entries = await db("audit_log").where({ object_type: "service_token", object_id: replacement.id });
		assert.equal(entries.filter(({ action }) => action === "revoked").length, 1);
		assert.equal(JSON.stringify(entries).includes(replacement.secret), false);
	});

	await t.test("writes can be attributed to the service token in audit records", async () => {
		const token = (await issue([viewer.id])).data;
		const access = await authenticateServiceToken(token.secret);
		const entry = await audit.add(access, { action: "updated", object_type: "fixture", meta: { name: "Fixture" } });
		assert.equal(entry.user_id, admin.id);
		assert.deepEqual(entry.meta, { name: "Fixture", service_token_id: token.id });
	});
});
