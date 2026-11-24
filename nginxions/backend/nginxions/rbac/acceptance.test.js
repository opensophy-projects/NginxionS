import assert from "node:assert/strict";
import { test } from "node:test";
import knex from "knex";
import { freshDatabase, postgres } from "../test/postgres.js";
import { effective, projection } from "./model.js";

test("the SQLite RBAC migration preserves and groups existing upstream permissions", async () => {
	const db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
	try {
		const { up, down } = await import("../migrations/20261028000000_nginxions_rbac.js");
		await db.schema.createTable("user", (table) => {
			table.increments("id");
			table.json("roles");
			table.integer("is_deleted");
		});
		const common = {
			visibility: "user",
			proxy_hosts: "manage",
			redirection_hosts: "manage",
			dead_hosts: "manage",
			streams: "manage",
			access_lists: "manage",
			certificates: "manage",
		};
		const custom = { ...common, visibility: "all", streams: "hidden", certificates: "view" };
		await db.schema.createTable("user_permission", (table) => {
			table.increments("id");
			table.integer("user_id");
			for (const key of Object.keys(common)) table.string(key);
		});
		await db("user").insert(
			[1, 2, 3, 4, 5].map((id) => ({
				id,
				roles: JSON.stringify(id === 4 ? ["admin"] : []),
				is_deleted: Number(id === 5),
			})),
		);
		await db("user_permission").insert(
			[common, common, custom, common, common].map((row, i) => ({ ...row, user_id: i + 1 })),
		);
		await db.transaction(up);
		assert.equal((await db("nginxions_role").whereNotNull("builtin")).length, 4);
		const assignments = await db("nginxions_user_role").orderBy("user_id");
		assert.deepEqual(
			assignments.map((row) => row.user_id),
			[1, 2, 3],
		);
		assert.equal(assignments[0].role_id, assignments[1].role_id);
		assert.notEqual(assignments[0].role_id, assignments[2].role_id);
		for (const { user_id, role_id } of assignments) {
			const { scope } = await db("nginxions_role").where({ id: role_id }).first();
			const permissions = (await db("nginxions_role_permission").where({ role_id })).map(
				({ resource, action }) => `${resource}:${action}`,
			);
			assert.deepEqual(projection(effective(false, [{ scope, permissions }])), user_id === 3 ? custom : common);
		}
		await db.transaction(down);
		assert.equal((await db("user_permission")).length, 5);
	} finally {
		await db.destroy();
	}
});

test("RBAC on PostgreSQL", { skip: !postgres && "no test database" }, async (t) => {
	const db = await freshDatabase("rbac");
	t.after(() => db.destroy());
	process.env.DISABLE_GRAVATAR = "true";

	const { default: Access } = await import("../../lib/access.js");
	const { default: tokenModel } = await import("../../models/token.js");
	const { default: User } = await import("../../models/user.js");
	const { default: ProxyHost } = await import("../../models/proxy_host.js");
	const { default: rbac, syncOidcGroups } = await import("./index.js");
	const { default: users } = await import("../../internal/user.js");

	const makeUser = (name, roles = []) =>
		User.query().insert({ name, nickname: name, email: `${name}@example.test`, avatar: "", roles });
	const makeAccess = async (user) => {
		const { token } = await tokenModel().create({ iss: "test", attrs: { id: user.id }, scope: ["user"] });
		return new Access(token);
	};
	const administrator = await makeUser("first-admin", ["admin"]);
	const access = await makeAccess(administrator);
	const builtin = Object.fromEntries((await rbac.list(access)).map((role) => [role.builtin, role]));
	const makeRole = (name, permissions, options = {}) =>
		rbac.create(access, { name, permissions, scope: "own", ...options });

	await t.test("the same host scope applies to CRUD, history, WAF and mTLS", async () => {
		const reviewer = await makeUser("host-reviewer");
		const reviewAccess = await makeAccess(reviewer);
		const proxy = (owner, domain) =>
			ProxyHost.query().insert({
				owner_user_id: owner.id,
				domain_names: [domain],
				forward_host: "upstream",
				forward_scheme: "http",
				forward_port: 80,
				npmplus_location_config: "",
			});
		const own = await proxy(reviewer, "own.example.test");
		const shared = await proxy(administrator, "shared.example.test");
		const outside = await proxy(administrator, "outside.example.test");
		const role = await makeRole(
			"Host reviewer",
			["proxy_hosts:view", "waf_policy:manage", "pki:manage", "crowdsec:manage", "waf_learning:view"],
			{
				scope: "hosts",
				hosts: [{ host_type: "proxy_host", host_id: shared.id }],
			},
		);
		await rbac.setUserRoles(access, reviewer.id, [role.id]);
		const { default: proxyHosts } = await import("../../internal/proxy-host.js");
		const { default: history } = await import("../hosts.js");
		const { default: waf } = await import("../waf/hosts.js");
		const { default: mtls } = await import("../pki/mtls.js");
		assert.deepEqual(
			(await proxyHosts.getAll(reviewAccess)).map(({ id }) => id),
			[own.id, shared.id],
		);
		for (const { id } of [own, shared]) {
			assert.equal((await proxyHosts.get(reviewAccess, { id })).id, id);
			assert.ok(await waf.get(reviewAccess, id));
			assert.ok(await mtls.get(reviewAccess, "proxy_host", id));
			assert.deepEqual(await history.history(reviewAccess, "proxy-host", id), []);
			await assert.rejects(reviewAccess.can("proxy_hosts:update", id), { status: 403 });
		}
		await assert.rejects(proxyHosts.get(reviewAccess, { id: outside.id }), { status: 404 });
		await assert.rejects(history.history(reviewAccess, "proxy-host", outside.id), { status: 404 });
		await assert.rejects(waf.get(reviewAccess, outside.id), { status: 404 });
		await assert.rejects(waf.set(reviewAccess, outside.id, {}), { status: 404 });
		await assert.rejects(mtls.get(reviewAccess, "proxy_host", outside.id), { status: 404 });
		await assert.rejects(mtls.set(reviewAccess, "proxy_host", outside.id, {}), { status: 404 });
		const { default: crowdsec } = await import("../crowdsec/index.js");
		await db("nginxions_crowdsec_host").insert(
			[shared, outside].map(({ id }) => ({
				host_type: "proxy_host",
				host_id: id,
				bouncer: false,
				modified_on: new Date(),
			})),
		);
		assert.deepEqual(
			(await crowdsec.hosts(reviewAccess)).hosts.map(({ host_id }) => host_id),
			[shared.id],
		);
		await assert.rejects(crowdsec.setHost(reviewAccess, "proxy_host", outside.id, true), { status: 404 });
		const { default: learning } = await import("../learning/index.js");
		await assert.rejects(learning.learned(reviewAccess, outside.id), { status: 404 });
	});

	await t.test("delegated role changes respect existing permissions, scope and OIDC controls", async () => {
		const manager = await makeUser("team-manager");
		const member = await makeUser("team-member");
		const managerAccess = await makeAccess(manager);
		const delegation = await makeRole("Delegation", ["roles:manage", "proxy_hosts:view"]);
		const allowed = await makeRole("Allowed role", ["proxy_hosts:view"]);
		const protectedRole = await makeRole("Protected role", ["streams:manage"], { scope: "all" });
		await rbac.setUserRoles(access, manager.id, [delegation.id]);
		await rbac.setUserRoles(access, member.id, [protectedRole.id]);
		await assert.rejects(rbac.setUserRoles(managerAccess, String(member.id), [allowed.id]), { status: 403 });
		assert.deepEqual(
			(await rbac.assignments(access))[member.id].map(({ id }) => id),
			[protectedRole.id],
		);
		await assert.rejects(rbac.update(managerAccess, builtin.operator.id, { oidc_groups: ["operations"] }), {
			status: 403,
		});
		await assert.rejects(rbac.setOidc(managerAccess, { claim: "groups", requestScope: true }), { status: 403 });
		await assert.rejects(
			rbac.create(managerAccess, { name: "Too broad", scope: "all", permissions: ["proxy_hosts:view"] }),
			{ status: 403 },
		);
		await assert.rejects(
			rbac.create(access, { name: "Unknown permission", scope: "own", permissions: ["unknown:view"] }),
			{ status: 400 },
		);
		await rbac.setUserRoles(access, member.id, []);
		assert.deepEqual(await rbac.setUserRoles(managerAccess, String(member.id), [allowed.id]), [allowed.id]);
		const permission = await db("user_permission").where({ user_id: member.id }).first();
		assert.equal(permission.proxy_hosts, "view");
		assert.equal(permission.streams, "hidden");
		assert.ok(
			await db("audit_log").where({ object_id: member.id, object_type: "user", action: "updated" }).first(),
		);
	});

	await t.test("OIDC refresh removes missing groups and retains the last active administrator", async () => {
		const oidcUser = await makeUser("oidc-viewer");
		await rbac.update(access, builtin.viewer.id, { oidc_groups: ["team-read"] });
		await rbac.update(access, builtin.administrator.id, { oidc_groups: ["team-admin"] });
		const membership = async () =>
			(await db("nginxions_user_role").where({ user_id: oidcUser.id })).map(({ role_id }) => role_id);
		await syncOidcGroups(oidcUser.email, { groups: ["team-read"] });
		assert.deepEqual(await membership(), [builtin.viewer.id]);
		await syncOidcGroups(oidcUser.email, {});
		assert.deepEqual(await membership(), []);
		assert.equal((await db("user_permission").where({ user_id: oidcUser.id }).first()).proxy_hosts, "hidden");
		await syncOidcGroups(administrator.email, {});
		assert.ok((await User.query().findById(administrator.id)).roles.includes("admin"));
	});

	await t.test(
		"a newly created account gets the correct permission projection after another account without a password",
		async () => {
			await makeUser("oidc-account");
			const created = await users.create(access, {
				name: "New member",
				nickname: "member",
				email: "new-member@example.test",
				auth: { type: "password", secret: "fixture-password" },
			});
			assert.equal(created.email, "new-member@example.test");
			assert.equal(created.permissions.proxy_hosts, "hidden");
			assert.ok(await db("auth").where({ user_id: created.id, type: "password" }).first());
		},
	);

	await t.test("parallel administrative changes leave an active administrator", async () => {
		const second = await makeUser("second-admin", ["admin"]);
		const secondAccess = await makeAccess(second);
		const outcomes = await Promise.allSettled([
			rbac.setUserRoles(access, String(administrator.id), []),
			rbac.setUserRoles(secondAccess, String(second.id), []),
		]);
		assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
		assert.equal(outcomes.find((result) => result.status === "rejected").reason.status, 400);
		const active = (await User.query().where({ is_disabled: 0, is_deleted: 0 })).filter((user) =>
			user.roles.includes("admin"),
		);
		assert.equal(active.length, 1);
		const finalAccess = await makeAccess(active[0]);
		await assert.rejects(users.update(finalAccess, { id: active[0].id, is_disabled: true }), { status: 400 });
	});
});
