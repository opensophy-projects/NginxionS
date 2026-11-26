// API credentials for unattended workloads. Only the digest is stored and roles resolve on every request.
import { createHash, randomBytes } from "node:crypto";
import db from "../../db.js";
import internalAuditLog from "../../internal/audit-log.js";
import errs from "../../lib/error.js";
import userModel from "../../models/user.js";
import { serviceRolePermissions } from "./index.js";
import { assertHostAccess, HOST_SECTIONS } from "./scope.js";
import { isAdminRoles, withRbacWrite } from "./write.js";

const TABLE = "nginxions_service_token";
const MEMBERSHIPS = "nginxions_service_token_role";
const PREFIX = "nxs_svc_";
const FIELDS = ["id", "name", "created_by", "created_on", "expires_on", "revoked_on"];
const DAY_MS = 24 * 60 * 60 * 1000;

const upstreamActions = { list: "view", get: "view", create: "manage", update: "manage", delete: "manage" };
const upstream = new Set([...Object.keys(HOST_SECTIONS), "access_lists", "certificates"]);
const scoped = new Set([...Object.keys(HOST_SECTIONS), "waf_policy", "waf_learning"]);
const serviceResources = new Set([
	...upstream,
	"analytics",
	"waf_events",
	"waf_policy",
	"waf_learning",
	"pki",
	"crowdsec",
]);

const digest = (value) => createHash("sha256").update(value).digest("hex");

/** undefined identifies a different authentication method, including the browser session cookie. */
export const serviceCredential = (header) => {
	const match = /^Bearer[ \t]+(nxs_svc_.*)$/i.exec(header ?? "");
	return match?.[1];
};

export async function authenticateServiceToken(secret) {
	if (!/^nxs_svc_[A-Za-z0-9_-]{43}$/.test(secret)) throw new errs.AuthError("Invalid service token");
	const knex = db();
	const account = await knex(`${TABLE} as credential`)
		.join("user as issuer", "issuer.id", "credential.created_by")
		.where({ "credential.token_digest": digest(secret), "issuer.is_deleted": 0, "issuer.is_disabled": 0 })
		.whereNull("credential.revoked_on")
		.where("credential.expires_on", ">", new Date())
		.select("credential.id", "credential.created_by")
		.first();
	if (!account) throw new errs.AuthError("Invalid service token");

	const eff = await serviceRolePermissions(account.id, knex);
	const all = eff.scope === "all";
	const scope = {
		permission_visibility: all ? "all" : "user",
		nginxions_hosts: eff.hosts,
		service_token: true,
	};
	return {
		serviceTokenId: account.id,
		token: { getUserId: () => account.created_by },
		can: async (label, data) => {
			const [resource, operation] = label.split(":");
			const grant =
				upstream.has(resource) && Object.hasOwn(upstreamActions, operation)
					? upstreamActions[operation]
					: operation;
			if (
				!serviceResources.has(resource) ||
				!eff.permissions.has(`${resource}:${grant}`) ||
				(!all && (!scoped.has(resource) || operation === "create"))
			) {
				throw new errs.PermissionError();
			}
			await assertHostAccess(label, data, scope, account.created_by);
			return scope;
		},
	};
}

const assertAdmin = async (access, connection) => {
	if (access.serviceTokenId) throw new errs.PermissionError();
	await access.can("roles:manage");
	const id = access.token.getUserId(0);
	const user = await userModel.query(connection).select("roles").findOne({ id, is_disabled: 0, is_deleted: 0 });
	if (!user || !isAdminRoles(user.roles)) throw new errs.PermissionError();
	return id;
};

const getToken = async (connection, id) => {
	const record = await connection(TABLE).select(FIELDS).where({ id }).first();
	if (!record) throw new errs.ItemNotFoundError(id);
	return record;
};

const writeRoles = async (connection, id, roleIds) => {
	const roles = await connection("nginxions_role").whereIn("id", roleIds).select("id", "builtin");
	if (!roles.length || roles.length !== roleIds.length) throw new errs.ValidationError("Choose existing roles");
	if (roles.some(({ builtin }) => builtin === "administrator")) {
		throw new errs.ValidationError("Administrator cannot be assigned to a service token");
	}
	await connection(MEMBERSHIPS).where({ token_id: id }).delete();
	await connection(MEMBERSHIPS).insert(roleIds.map((role_id) => ({ token_id: id, role_id })));
};

const audit = (access, action, token, data, trx) =>
	internalAuditLog.add(
		access,
		{
			action,
			object_type: "service_token",
			object_id: token.id,
			meta: { name: token.name, ...data },
		},
		trx,
	);

export default {
	list: async (access) => {
		const knex = db();
		await assertAdmin(access, knex);
		const rows = await knex(`${TABLE} as credential`)
			.leftJoin("user as issuer", "issuer.id", "credential.created_by")
			.select([...FIELDS.map((field) => `credential.${field}`), "issuer.is_disabled", "issuer.is_deleted"])
			.orderBy("credential.id", "desc");
		const now = new Date();
		const byToken = new Map();
		for (const { is_disabled, is_deleted, ...row } of rows) {
			const status = row.revoked_on
				? "revoked"
				: new Date(row.expires_on) <= now
					? "expired"
					: is_disabled === 0 && is_deleted === 0
						? "active"
						: "issuer_inactive";
			byToken.set(row.id, { ...row, status, roles: [] });
		}
		const memberships = await knex(MEMBERSHIPS).select("token_id", "role_id").orderBy("role_id");
		for (const { token_id, role_id } of memberships) byToken.get(token_id)?.roles.push(role_id);
		return [...byToken.values()];
	},

	create: async (access, { name, roles, expires_in_days }) => {
		await assertAdmin(access, db());
		const cleanName = name.trim();
		if (!cleanName || cleanName.includes("\0")) throw new errs.ValidationError("A service token needs a name");
		const secret = PREFIX + randomBytes(32).toString("base64url");
		return withRbacWrite(async (trx) => {
			const createdBy = await assertAdmin(access, trx);
			const now = new Date();
			const [inserted] = await trx(TABLE)
				.insert({
					name: cleanName,
					token_digest: digest(secret),
					created_by: createdBy,
					created_on: now,
					expires_on: new Date(now.getTime() + expires_in_days * DAY_MS),
				})
				.returning("id");
			const id = typeof inserted === "object" ? inserted.id : inserted;
			await writeRoles(trx, id, roles);
			const record = await getToken(trx, id);
			await audit(access, "created", record, { roles, expires_on: record.expires_on }, trx);
			return { ...record, roles, secret };
		});
	},

	updateRoles: async (access, id, roles) => {
		await assertAdmin(access, db());
		return withRbacWrite(async (trx) => {
			await assertAdmin(access, trx);
			const record = await getToken(trx, id);
			if (record.revoked_on || new Date(record.expires_on) <= new Date()) {
				throw new errs.ValidationError("Only active service tokens can be edited");
			}
			await writeRoles(trx, id, roles);
			await audit(access, "updated", record, { roles }, trx);
			return { ...record, roles };
		});
	},

	revoke: async (access, id) => {
		await assertAdmin(access, db());
		return withRbacWrite(async (trx) => {
			await assertAdmin(access, trx);
			const record = await getToken(trx, id);
			if (!record.revoked_on) {
				await trx(TABLE).where({ id }).update({ revoked_on: new Date() });
				await audit(access, "revoked", record, {}, trx);
			}
			return { revoked: true };
		});
	},
};
