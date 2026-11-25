// Which hosts a user sees: all, or their own plus the hosts given to their roles (role scope
// "hosts", table nginxions_role_host). Used by the upstream host modules instead of their owner filter.

import db from "../../db.js";
import errs from "../../lib/error.js";

const HOST_SECTIONS = {
	proxy_hosts: "proxy_host",
	redirection_hosts: "redirection_host",
	dead_hosts: "dead_host",
	streams: "stream",
};
export const HOST_TABLES = Object.values(HOST_SECTIONS);

/**
 * Limits a host query to what the user may see.
 * @param {object} query  knex/objection query on `table`
 * @param {{permission_visibility: string, nginxions_hosts?: Record<string, number[]>}} accessData
 * @param {string} table  proxy_host | redirection_host | dead_host | stream
 * @param {number} userId
 */
export const scopeHosts = (query, accessData, table, userId) => {
	if (allHosts(accessData)) return query;
	const ids = accessData?.nginxions_hosts?.[table] ?? [];
	return query.andWhere((q) => {
		q.where(`${table}.owner_user_id`, userId);
		if (ids.length) q.orWhereIn(`${table}.id`, ids);
	});
};

/** Apply the same scope to every host item permission, including calls from WAF, mTLS and audit. */
export const assertHostAccess = async (label, id, accessData, userId) => {
	const [section, action] = label.split(":");
	const table = Object.hasOwn(HOST_SECTIONS, section) ? HOST_SECTIONS[section] : null;
	if (!table || !["get", "update", "delete"].includes(action)) return;
	if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new errs.ItemNotFoundError();
	const query = db()(table).where({ id, is_deleted: 0 }).select("id");
	const host = await scopeHosts(query, accessData, table, userId).first();
	if (!host) throw new errs.ItemNotFoundError(id);
};

export const allHosts = (scope) => scope === true || scope?.permission_visibility === "all";

/** A deployment-wide operation cannot be limited to a subset of hosts. */
export const assertGlobalAccess = async (access, permission) => {
	const scope = await access.can(permission);
	if (!allHosts(scope)) throw new errs.PermissionError();
};
