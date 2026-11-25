// RBAC of NginxionS: roles in the database (nginxions_role, nginxions_role_permission, nginxions_user_role), the
// adapter for upstream access.can() and the API of Administration → Roles. Rules: ./model.js.

import db from "../../db.js";
import internalAuditLog from "../../internal/audit-log.js";
import errs from "../../lib/error.js";
import { debug, access as logger } from "../../logger.js";
import userModel from "../../models/user.js";
import userPermissionModel from "../../models/user_permission.js";
import { getSetting, setSetting } from "../settings.js";
import * as model from "./model.js";
import { HOST_TABLES } from "./scope.js";
import { assertActiveAdministrator, hasOtherActiveAdministrator, isAdminRoles, withRbacWrite } from "./write.js";

const parse = (value) => (typeof value === "string" ? JSON.parse(value) : value);
const roleTable = (connection = db()) => connection("nginxions_role");

/** hosts of roles (scope "hosts") */
const hostsOf = (roleIds, connection) =>
	connection("nginxions_role_host").whereIn("role_id", roleIds).select("role_id", "host_type", "host_id");

/** Role scope, grants and host bindings come from a single database snapshot. */
async function rolesOf(userId, connection) {
	const membership = connection("nginxions_user_role as membership")
		.join("nginxions_role as role", "role.id", "membership.role_id")
		.where("membership.user_id", userId)
		.select("role.id", "role.builtin", "role.scope");
	const permissions = membership
		.clone()
		.leftJoin("nginxions_role_permission as permission", "permission.role_id", "role.id")
		.select(
			"permission.resource",
			"permission.action",
			connection.raw("NULL as host_type"),
			connection.raw("NULL as host_id"),
		);
	const bindings = membership
		.clone()
		.join("nginxions_role_host as host", "host.role_id", "role.id")
		.select(connection.raw("NULL as resource"), connection.raw("NULL as action"), "host.host_type", "host.host_id");
	const roles = new Map();
	for (const row of await permissions.unionAll(bindings)) {
		// The upstream flag is authoritative for the Administrator role.
		if (row.builtin === "administrator") continue;
		const builtin = row.builtin ? model.BUILTIN[row.builtin] : undefined;
		if (!roles.has(row.id)) {
			roles.set(row.id, {
				id: row.id,
				scope: builtin?.scope ?? row.scope,
				permissions: [...(builtin?.permissions ?? [])],
				hosts: [],
			});
		}
		const role = roles.get(row.id);
		if (!builtin && row.resource) role.permissions.push(`${row.resource}:${row.action}`);
		if (!builtin && row.host_type) role.hosts.push({ host_type: row.host_type, host_id: row.host_id });
	}
	return [...roles.values()];
}

/** effective permissions of a user loaded with its upstream "roles" column */
const effectiveOf = async (user, connection = db()) => {
	const admin = isAdminRoles(user.roles);
	return model.effective(admin, admin ? [] : await rolesOf(user.id, connection));
};

/**
 * Adapter for access.js (init): the permissions of the token's user come from the roles.
 * Writes user_permission when it differs from the roles, so upstream code and UI that read
 * it directly see the same.
 * @param {object} user  with roles and permissions (upstream graph)
 * @returns {Promise<object>} upstream permissions object, plus `nginxions` (effective permissions)
 */
export async function resolve(user, connection = db()) {
	const eff = await effectiveOf(user, connection);
	const row = model.projection(eff);
	const current = user.permissions ?? {};
	const stale = Object.keys(row).some((key) => current[key] !== row[key]);
	if (stale) {
		const updated = await userPermissionModel.query(connection).where("user_id", user.id).patch(row);
		if (!updated) {
			await userPermissionModel
				.query(connection)
				.insert({ user_id: user.id, ...row })
				.onConflict("user_id")
				.ignore();
		}
		debug(logger, `user ${user.id}: user_permission follows the roles`);
	}
	return { ...current, ...row, nginxions: eff };
}

const userIsAdmin = async (id) => {
	if (!Number.isInteger(id)) return false;
	const user = await userModel.query().select("roles").where("id", id).first();
	return !!user && isAdminRoles(user.roles);
};

/**
 * Adapter for access.js (can): decides NginxionS labels and opens admin-only upstream sections to
 * roles. undefined: the upstream permission schema decides.
 * @returns {Promise<object|false|undefined>}
 */
export async function check(permissions, label, data) {
	const eff = permissions?.nginxions ?? { admin: false, scope: "own", permissions: new Set() };
	const grant = model.UPSTREAM_GRANTS[label];
	let targetIsAdmin = false;
	if (grant?.target && !eff.admin && eff.permissions.has(grant.permission)) {
		targetIsAdmin =
			label === "users:create"
				? (data?.roles ?? []).includes("admin")
				: await userIsAdmin(Number(typeof data === "object" ? data?.id : data));
	}
	const decision = model.decide(label, eff, { targetIsAdmin });
	if (decision === "grant") {
		return { permission_visibility: eff.scope === "all" ? "all" : "user", nginxions_hosts: eff.hosts ?? {} };
	}
	if (decision === "deny") return false;
	return undefined;
}

// ---- API ----

/** permissions of the actor (the checks below need them, access.js does not expose them) */
const actorOf = async (access, connection) => {
	const user = await userModel
		.query(connection)
		.select("id", "roles")
		.where({ id: access.token.getUserId(0), is_deleted: 0, is_disabled: 0 })
		.first();
	if (!user) throw new errs.PermissionError();
	return effectiveOf(user, connection);
};

export const assertUserCreation = async (access, roles, connection) => {
	const actor = await actorOf(access, connection);
	if (!actor.admin && (!actor.permissions.has("users:manage") || isAdminRoles(roles))) {
		throw new errs.PermissionError();
	}
};

/** Recheck the account and the actor under the role write lock. */
export const assertUserMutation = async (access, user, connection, changes = {}) => {
	const actor = await actorOf(access, connection);
	if (actor.admin) return;
	if (changes.roles !== undefined) throw new errs.PermissionError();
	if (access.token.getUserId(0) === user.id) return;
	if (isAdminRoles(user.roles) || !actor.permissions.has("users:manage")) throw new errs.PermissionError();
	const target = await effectiveOf(user, connection);
	forbid(model.missing(actor, [...target.permissions], target.scope));
};

const roleManager = async (access, connection) => {
	const actor = await actorOf(access, connection);
	if (!actor.permissions.has("roles:manage")) throw new errs.PermissionError();
	return actor;
};

const forbid = (lacking) => {
	if (lacking.length) {
		throw new errs.PermissionError(`Permission Denied: you do not have ${lacking.join(", ")}`);
	}
};

const roleRows = async (where, connection = db()) => {
	const roles = await roleTable(connection)
		.where(where ?? {})
		.select();
	const ids = roles.map((r) => r.id);
	const permissions = ids.length ? await connection("nginxions_role_permission").whereIn("role_id", ids) : [];
	const hosts = ids.length ? await hostsOf(ids, connection) : [];
	const members = ids.length
		? await connection("nginxions_user_role")
				.join("user", "user.id", "nginxions_user_role.user_id")
				.where("user.is_deleted", 0)
				.whereIn("role_id", ids)
				.select("role_id", "user.id", "user.name", "user.email")
		: [];
	const admins = await userModel.query(connection).select("id", "name", "email", "roles").where("is_deleted", 0);
	const order = Object.keys(model.BUILTIN);
	return roles
		.map((role) => {
			const builtin = role.builtin ? model.BUILTIN[role.builtin] : null;
			return {
				id: role.id,
				name: role.name,
				description: role.description ?? "",
				builtin: role.builtin || null,
				scope: builtin ? builtin.scope : role.scope,
				oidc_groups: parse(role.oidc_groups) ?? [],
				hosts: hosts
					.filter((h) => h.role_id === role.id)
					.map(({ host_type, host_id }) => ({ host_type, host_id })),
				permissions: builtin
					? model.normalize(builtin.permissions)
					: model.normalize(
							permissions.filter((p) => p.role_id === role.id).map((p) => `${p.resource}:${p.action}`),
						),
				users:
					role.builtin === "administrator"
						? admins
								.filter((u) => isAdminRoles(u.roles))
								.map(({ id, name, email }) => ({ id, name, email }))
						: members
								.filter((m) => m.role_id === role.id)
								.map(({ id, name, email }) => ({ id, name, email })),
				created_on: role.created_on,
				modified_on: role.modified_on,
			};
		})
		.sort((a, b) => {
			const x = a.builtin ? order.indexOf(a.builtin) : order.length;
			const y = b.builtin ? order.indexOf(b.builtin) : order.length;
			return x - y || a.name.localeCompare(b.name);
		});
};

const getRole = async (id, connection) => {
	const [role] = await roleRows({ id }, connection);
	if (!role) throw new errs.ItemNotFoundError(id);
	return role;
};

const cleanGroups = (groups) => [...new Set((groups ?? []).map((g) => String(g).trim()).filter(Boolean))];

const validateRole = async (data, id, connection) => {
	const name = String(data.name ?? "").trim();
	if (!name || name.length > 100) throw new errs.ValidationError("A role needs a name (up to 100 characters)");
	if (!model.SCOPES.includes(data.scope)) throw new errs.ValidationError("scope must be all, own or hosts");
	const hosts = data.scope === "hosts" ? await validHosts(data.hosts ?? [], connection) : [];
	if (data.scope === "hosts" && !hosts.length) throw new errs.ValidationError("Choose the hosts of the role");
	const same = await roleTable(connection)
		.whereRaw("lower(name) = ?", [name.toLowerCase()])
		.whereNot("id", id ?? 0)
		.first();
	if (same) throw new errs.ValidationError(`A role named ${name} already exists`);
	return {
		name,
		description: String(data.description ?? "").slice(0, 500),
		scope: data.scope,
		oidc_groups: cleanGroups(data.oidc_groups),
		permissions: validatePermissions(data.permissions ?? []),
		hosts,
	};
};

const validatePermissions = (permissions) => {
	const normalized = model.normalize(permissions);
	if (permissions.some((permission) => !normalized.includes(permission))) {
		throw new errs.ValidationError("Unknown permission");
	}
	return normalized;
};

/** existing hosts only, each once */
const validHosts = async (list, connection) => {
	const result = [];
	for (const table of HOST_TABLES) {
		const wanted = [...new Set(list.filter((h) => h.host_type === table).map((h) => Number(h.host_id)))];
		if (!wanted.length) continue;
		const found = await connection(table).whereIn("id", wanted).where("is_deleted", 0).select("id");
		if (found.length !== wanted.length) throw new errs.ValidationError(`Unknown ${table} in the role`);
		for (const { id } of found) result.push({ host_type: table, host_id: id });
	}
	if (list.some((h) => !HOST_TABLES.includes(h.host_type))) throw new errs.ValidationError("Unknown host type");
	return result;
};

const writeHosts = async (trx, roleId, hosts) => {
	await trx("nginxions_role_host").where("role_id", roleId).delete();
	if (hosts.length) await trx("nginxions_role_host").insert(hosts.map((h) => ({ role_id: roleId, ...h })));
};

const writePermissions = async (trx, roleId, permissions) => {
	await trx("nginxions_role_permission").where("role_id", roleId).delete();
	if (permissions.length) {
		await trx("nginxions_role_permission").insert(
			permissions.map((p) => {
				const [resource, action] = p.split(":");
				return { role_id: roleId, resource, action };
			}),
		);
	}
};

/** user_permission of members follows the role within the same transaction. */
const resyncUsers = async (connection, ids) => {
	if (!ids.length) return;
	const users = await userModel
		.query(connection)
		.whereIn("id", ids)
		.allowGraph("[permissions]")
		.withGraphFetched("[permissions]");
	for (const user of users) await resolve(user, connection);
};

const audit = (access, action, objectType, objectId, meta, connection) =>
	internalAuditLog.add(access, { action, object_type: objectType, object_id: objectId, meta }, connection);

const findUser = (connection, userId) => userModel.query(connection).where({ id: userId, is_deleted: 0 }).first();

const administratorRole = (connection) => roleTable(connection).where({ builtin: "administrator" }).first();

const readMemberships = async (connection, user, administratorId) => {
	const rows = await connection("nginxions_user_role").where("user_id", user.id);
	const memberships = new Map(
		rows.map(({ role_id, manual_grant, oidc_grant }) => [
			role_id,
			{ manual_grant: Boolean(manual_grant), oidc_grant: Boolean(oidc_grant) },
		]),
	);
	if (isAdminRoles(user.roles) && !memberships.has(administratorId)) {
		memberships.set(administratorId, { manual_grant: true, oidc_grant: false });
	}
	return memberships;
};

const writeMemberships = async (connection, user, chosen, administratorId, source) => {
	const memberships = await readMemberships(connection, user, administratorId);
	const selected = new Set(chosen.map(({ id }) => id));
	for (const id of selected) {
		if (!memberships.has(id)) memberships.set(id, { manual_grant: false, oidc_grant: false });
	}
	for (const [id, grants] of memberships) grants[source] = selected.has(id);
	const admin = memberships.get(administratorId);
	if (
		source === "oidc_grant" &&
		admin &&
		!admin.manual_grant &&
		!admin.oidc_grant &&
		isAdminRoles(user.roles) &&
		!user.is_disabled &&
		!(await hasOtherActiveAdministrator(connection, user.id))
	) {
		admin.oidc_grant = true;
	}
	const administrator = Boolean(admin?.manual_grant || admin?.oidc_grant);
	const flags = (parse(user.roles) ?? []).filter((role) => role !== "admin");
	const roles = administrator ? [...flags, "admin"] : flags;
	await assertActiveAdministrator(connection, user, { roles });
	await connection("nginxions_user_role").where("user_id", user.id).delete();
	const rows = [...memberships]
		.filter(([, grants]) => grants.manual_grant || grants.oidc_grant)
		.map(([role_id, grants]) => ({ user_id: user.id, role_id, ...grants }));
	if (rows.length) await connection("nginxions_user_role").insert(rows);
	if (isAdminRoles(user.roles) !== administrator) {
		await userModel.query(connection).patch({ roles }).where("id", user.id);
	}
	await resyncUsers(connection, [user.id]);
	return rows.map(({ role_id }) => role_id);
};

/** Keep the upstream account editor and manual Administrator membership in sync. */
export const updateManualAdministrator = async (connection, user, requested) => {
	const { id } = await administratorRole(connection);
	const membership = connection("nginxions_user_role").where({ user_id: user.id, role_id: id });
	const current = await membership.clone().first();
	if (!current) return requested;
	const manual = isAdminRoles(requested);
	if (current.oidc_grant) {
		await membership.update({ manual_grant: manual });
		return manual ? requested : [...requested, "admin"];
	}
	if (!manual) await membership.delete();
	return requested;
};

const internalRbac = {
	/**
	 * Resources, actions and built-in roles (the role editor is built from it). Lists, not maps:
	 * the API client camelizes keys, and resource names are matched as values.
	 */
	model: () => ({
		resources: Object.entries(model.RESOURCES).map(([id, actions]) => ({ id, actions })),
		scopes: model.SCOPES,
		builtin: Object.entries(model.BUILTIN).map(([key, role]) => ({
			key,
			name: role.name,
			scope: role.scope,
			permissions: model.normalize(role.permissions),
		})),
	}),

	/** permissions of the current user, for the UI */
	me: async (access) => {
		const userId = access.token.getUserId(0);
		const user = await userModel
			.query()
			.select("id", "roles")
			.where({ id: userId, is_deleted: 0, is_disabled: 0 })
			.first();
		if (!user) throw new errs.PermissionError();
		const eff = await effectiveOf(user);
		const memberships = await db()("nginxions_user_role")
			.join("nginxions_role", "nginxions_role.id", "nginxions_user_role.role_id")
			.where("nginxions_user_role.user_id", userId)
			.select("nginxions_role.id", "nginxions_role.name", "nginxions_role.builtin");
		const roles = memberships.filter(({ builtin }) => builtin !== "administrator");
		if (eff.admin) {
			const admin =
				memberships.find(({ builtin }) => builtin === "administrator") ??
				(await roleTable().where("builtin", "administrator").select("id", "name", "builtin").first());
			if (admin) roles.unshift(admin);
		}
		return { admin: eff.admin, scope: eff.scope, hosts: eff.hosts, permissions: [...eff.permissions], roles };
	},

	list: async (access) => {
		await access.can("roles:view");
		return roleRows();
	},

	get: async (access, id) => {
		await access.can("roles:view");
		return getRole(id);
	},

	create: async (access, data) => {
		await access.can("roles:manage");
		return withRbacWrite(async (trx) => {
			const actor = await roleManager(access, trx);
			const role = await validateRole(data, undefined, trx);
			forbid(model.missing(actor, role.permissions, role.scope));
			const [inserted] = await roleTable(trx)
				.insert({
					name: role.name,
					description: role.description,
					scope: role.scope,
					oidc_groups: JSON.stringify(role.oidc_groups),
					builtin: null,
					created_on: new Date(),
					modified_on: new Date(),
				})
				.returning("id");
			const id = typeof inserted === "object" ? inserted.id : inserted;
			await writePermissions(trx, id, role.permissions);
			await writeHosts(trx, id, role.hosts);
			await audit(access, "created", "role", id, role, trx);
			return getRole(id, trx);
		});
	},

	update: async (access, id, data) => {
		await access.can("roles:manage");
		return withRbacWrite(async (trx) => {
			const actor = await roleManager(access, trx);
			const current = await getRole(id, trx);
			if (current.builtin === "administrator" && !actor.admin) forbid(["roles:administrator"]);
			forbid(model.missing(actor, current.permissions, current.scope));
			if (current.builtin) {
				const oidc_groups = cleanGroups(data.oidc_groups);
				await roleTable(trx)
					.where({ id })
					.update({ oidc_groups: JSON.stringify(oidc_groups), modified_on: new Date() });
				await audit(access, "updated", "role", id, { name: current.name, oidc_groups }, trx);
			} else {
				const role = await validateRole(data, id, trx);
				forbid(model.missing(actor, role.permissions, role.scope));
				await roleTable(trx)
					.where({ id })
					.update({
						name: role.name,
						description: role.description,
						scope: role.scope,
						oidc_groups: JSON.stringify(role.oidc_groups),
						modified_on: new Date(),
					});
				await writePermissions(trx, id, role.permissions);
				await writeHosts(trx, id, role.hosts);
				await resyncUsers(
					trx,
					current.users.map(({ id }) => id),
				);
				await audit(access, "updated", "role", id, role, trx);
			}
			return getRole(id, trx);
		});
	},

	delete: async (access, id) => {
		await access.can("roles:manage");
		return withRbacWrite(async (trx) => {
			const actor = await roleManager(access, trx);
			const current = await getRole(id, trx);
			if (current.builtin) throw new errs.ValidationError("Built-in roles cannot be deleted");
			forbid(model.missing(actor, current.permissions, current.scope));
			await trx("nginxions_user_role").where("role_id", id).delete();
			await trx("nginxions_role_permission").where("role_id", id).delete();
			await trx("nginxions_role_host").where("role_id", id).delete();
			await roleTable(trx).where({ id }).delete();
			await resyncUsers(
				trx,
				current.users.map(({ id }) => id),
			);
			await audit(access, "deleted", "role", id, { name: current.name }, trx);
			return true;
		});
	},

	/** {user id: [{id, name, builtin}]} of all users, the Administrator role for admins */
	assignments: async (access) => {
		try {
			await access.can("users:list");
		} catch {
			await access.can("roles:view");
		}
		const roles = await roleTable().select("id", "name", "builtin");
		const admin = roles.find((r) => r.builtin === "administrator");
		const result = {};
		for (const user of await userModel.query().select("id", "roles").where("is_deleted", 0)) {
			result[user.id] =
				isAdminRoles(user.roles) && admin ? [{ ...admin, manual_grant: true, oidc_grant: false }] : [];
		}
		for (const row of await db()("nginxions_user_role").select(
			"user_id",
			"role_id",
			"manual_grant",
			"oidc_grant",
		)) {
			const role = roles.find((r) => r.id === row.role_id);
			if (!result[row.user_id] || !role) continue;
			const assignment = {
				...role,
				manual_grant: Boolean(row.manual_grant),
				oidc_grant: Boolean(row.oidc_grant),
			};
			const userRoles = result[row.user_id];
			if (role.builtin !== "administrator") userRoles.push(assignment);
			else if (userRoles[0]?.builtin === "administrator") userRoles[0] = assignment;
		}
		return result;
	},

	/**
	 * Roles of a user. The Administrator role is the upstream admin flag.
	 * @param {number[]} roleIds
	 */
	setUserRoles: async (access, userId, roleIds) => {
		await access.can("roles:manage");
		const id = Number(userId);
		if (!Number.isSafeInteger(id) || id < 1) throw new errs.ValidationError("Invalid user ID");
		return withRbacWrite(async (trx) => {
			const actor = await roleManager(access, trx);
			const user = await findUser(trx, id);
			if (!user) throw new errs.ItemNotFoundError(id);
			const roles = await roleRows(undefined, trx);
			const chosen = roles.filter((role) => roleIds.includes(role.id));
			if (chosen.length !== new Set(roleIds).size) throw new errs.ValidationError("Unknown role");
			const administrator = roles.find((role) => role.builtin === "administrator");
			if (!actor.admin && (isAdminRoles(user.roles) || chosen.includes(administrator)))
				forbid(["roles:administrator"]);
			const before = roles.filter((role) => role.users.some((member) => member.id === user.id));
			for (const role of [...before, ...chosen]) forbid(model.missing(actor, role.permissions, role.scope));
			const effectiveIds = await writeMemberships(trx, user, chosen, administrator.id, "manual_grant");
			await audit(
				access,
				"updated",
				"user",
				user.id,
				{ name: user.name, roles: chosen.map((role) => role.name) },
				trx,
			);
			return effectiveIds;
		});
	},

	getOidc: async (access) => {
		await access.can("roles:view");
		return getSetting("rbac.oidc");
	},

	setOidc: async (access, value) => {
		await access.can("roles:manage");
		return withRbacWrite(async (trx) => {
			const actor = await roleManager(access, trx);
			if (!actor.admin) forbid(["roles:administrator"]);
			const saved = await setSetting("rbac.oidc", value, trx);
			await audit(access, "updated", "role", 0, { name: "OIDC", ...saved }, trx);
			return saved;
		});
	},
};

const groupNames = (value) => {
	if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean);
	return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
};

/** Refresh privileges before issuing a session: a missing claim gives no mapped roles. */
export async function syncOidcGroups(email, claims) {
	return withRbacWrite(async (trx) => {
		const { claim } = await getSetting("rbac.oidc", trx);
		const roles = await roleTable(trx).select("id", "name", "builtin", "oidc_groups");
		const administrator = roles.find((role) => role.builtin === "administrator");
		const user = await userModel.query(trx).where({ email, is_deleted: 0, is_disabled: 0 }).first();
		if (!user) throw new errs.AuthError("User not found");
		const groups = new Set(groupNames(claims && Object.hasOwn(claims, claim) ? claims[claim] : undefined));
		const chosen = roles.filter((role) => (parse(role.oidc_groups) ?? []).some((group) => groups.has(group)));
		const prior = await trx("nginxions_user_role").where({ user_id: user.id, oidc_grant: true }).select("role_id");
		if (prior.length === chosen.length && prior.every(({ role_id }) => chosen.some(({ id }) => id === role_id))) {
			return;
		}
		const ids = await writeMemberships(trx, user, chosen, administrator.id, "oidc_grant");
		const names = roles.filter((role) => ids.includes(role.id)).map((role) => role.name);
		await internalAuditLog.add(
			null,
			{
				user_id: user.id,
				action: "updated",
				object_type: "user",
				object_id: user.id,
				meta: { name: user.name, roles: names, source: "oidc" },
			},
			trx,
		);
	});
}

export default internalRbac;
