// A node applies the package of its manager (docs/ROADMAP.md, phase 15, step 15.2; docs/adr/0012-nodes.md).
//   - certificates, access lists, proxy hosts and their WAF modes become rows of this server, marked as managed
//     (nginxions_managed keeps the id each has on the manager: the next package updates them, no copies);
//   - what the package no longer has is removed; rows of this server that are not managed are never touched;
//   - a host whose domain a host of this server already serves is left out and told (two servers of one name break
//     nginx);
//   - then nginx: each managed host is configured and checked (nginx -t), nginx is reloaded once. A host nginx
//     refused is in the result: the caller (member.js) applies the package before again.
import db from "../../db.js";
import internalCertificate from "../../internal/certificate.js";
import internalNginx from "../../internal/nginx.js";
import internalProxyHostAccessList from "../../internal/proxy-host-access-list.js";
import proxyModel from "../../models/proxy_host.js";
import { domainsOf, remapHost } from "./package-model.js";

const now = () => new Date();
const json = (v) => JSON.stringify(v ?? null);
const without = (row, ...keys) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));
const insertedId = (inserted) => (typeof inserted === "object" ? inserted.id : inserted);

/** the default work with nginx: configure the managed hosts (test included), reload once */
export const configureHosts = async (ids) => {
	if (ids.length) {
		const hosts = await proxyModel
			.query()
			.whereIn("id", ids)
			.where("is_deleted", 0)
			.andWhere("enabled", 1)
			.withGraphFetched(proxyModel.defaultAllowGraph);
		const ready = await Promise.all(
			hosts.map((host) =>
				internalProxyHostAccessList.populateLocationAccessLists(
					internalProxyHostAccessList.cleanAccessListTypes(host),
				),
			),
		);
		await internalNginx.bulkGenerateConfigs(proxyModel, "proxy_host", ready, { skipReload: true });
	}
	await internalNginx.reload();
};

/** the rows of a removed host leave nginx too */
export const removeHostConfig = (id) => internalNginx.deleteConfig("proxy_host", { id });

/**
 * Applies the content of a package.
 * @param {object} content  the opened package
 * @param {{configure?: (ids: number[]) => Promise, removeConfig?: (id: number) => Promise,
 *   writeCertificate?: (row: object) => Promise}} [io]  nginx and files (replaced in tests)
 * @returns {Promise<{hosts: number, skipped: object[], offline: object[]}>}
 */
export const applyContent = async (content, io = {}) => {
	const configure = io.configure ?? configureHosts;
	const removeConfig = io.removeConfig ?? removeHostConfig;
	const writeCertificate = io.writeCertificate ?? ((row) => internalCertificate.writeCustomCert(row));
	const skipped = [...(content.skipped ?? [])];
	const certificatesToWrite = [];
	const removedHosts = [];
	const hostIds = [];

	await db().transaction(async (trx) => {
		const managed = await trx("nginxions_managed");
		const localOf = (kind) => new Map(managed.filter((m) => m.kind === kind).map((m) => [m.source_id, m.local_id]));
		const remember = async (kind, sourceId, localId) => {
			await trx("nginxions_managed")
				.insert({ kind, source_id: sourceId, local_id: localId })
				.onConflict(["kind", "source_id"])
				.merge();
		};
		/** an update of the managed row, or a new one */
		const upsert = async (table, kind, sourceId, row) => {
			const local = localOf(kind).get(sourceId);
			if (local && (await trx(table).where({ id: local }).first())) {
				await trx(table)
					.where({ id: local })
					.update({ ...row, modified_on: now() });
				return local;
			}
			const [inserted] = await trx(table)
				.insert({ ...row, created_on: now(), modified_on: now() })
				.returning("id");
			const id = insertedId(inserted);
			await remember(kind, sourceId, id);
			return id;
		};

		// certificates
		const certificates = new Map();
		for (const c of content.certificates ?? []) {
			const meta = { ...(c.meta ?? {}), nginxions_managed: true };
			const id = await upsert("certificate", "certificate", c.id, {
				...without(c, "id"),
				owner_user_id: 1,
				domain_names: json(c.domain_names),
				meta: json(meta),
			});
			certificates.set(c.id, id);
			certificatesToWrite.push({ ...c, id, meta });
		}

		// access lists with their logins and addresses
		const accessLists = new Map();
		for (const l of content.access_lists ?? []) {
			const id = await upsert("access_list", "access_list", l.id, {
				...without(l, "id", "items", "clients"),
				owner_user_id: 1,
				meta: json({ ...(l.meta ?? {}), nginxions_managed: true }),
			});
			accessLists.set(l.id, id);
			await trx("access_list_auth").where({ access_list_id: id }).delete();
			await trx("access_list_client").where({ access_list_id: id }).delete();
			for (const item of l.items ?? []) {
				await trx("access_list_auth").insert({
					...item,
					access_list_id: id,
					meta: json(item.meta ?? {}),
					created_on: now(),
					modified_on: now(),
				});
			}
			for (const client of l.clients ?? []) {
				await trx("access_list_client").insert({
					...client,
					access_list_id: id,
					meta: json(client.meta ?? {}),
					created_on: now(),
					modified_on: now(),
				});
			}
		}

		// proxy hosts: a domain a host of this server serves already is left out
		const managedHosts = new Set(localOf("proxy_host").values());
		const taken = new Set();
		for (const table of ["proxy_host", "redirection_host", "dead_host"]) {
			for (const row of await trx(table).where({ is_deleted: 0 })) {
				if (table === "proxy_host" && managedHosts.has(row.id)) continue;
				const names = typeof row.domain_names === "string" ? JSON.parse(row.domain_names) : row.domain_names;
				for (const d of names ?? []) taken.add(String(d).toLowerCase());
			}
		}
		const hosts = new Map();
		for (const h of content.hosts ?? []) {
			const clash = domainsOf(h).filter((d) => taken.has(d));
			if (clash.length) {
				skipped.push({
					kind: "proxy_host",
					id: h.id,
					name: domainsOf(h).join(", "),
					reason: `taken: ${clash[0]}`,
				});
				continue;
			}
			const { row, missing } = remapHost(h, { certificates, accessLists });
			for (const m of missing)
				skipped.push({ kind: "proxy_host", id: h.id, name: domainsOf(h).join(", "), reason: m });
			const meta = { ...(row.meta ?? {}), nginxions_managed: true };
			delete meta.nginx_online;
			delete meta.nginx_err;
			const id = await upsert("proxy_host", "proxy_host", h.id, {
				...without(row, "id"),
				owner_user_id: 1,
				domain_names: json(row.domain_names),
				meta: json(meta),
				locations: json(row.locations),
				npmplus_access_list_ids: json(row.npmplus_access_list_ids),
			});
			await internalProxyHostAccessList.syncAccessListRelations(trx, id, row);
			hosts.set(h.id, id);
			hostIds.push(id);
		}

		// WAF modes of the managed hosts
		const local = [...hosts.values()];
		if (local.length) {
			await trx("nginxions_waf_host").whereIn("proxy_host_id", local).delete();
			await trx("nginxions_waf_location").whereIn("proxy_host_id", local).delete();
		}
		for (const w of content.waf_hosts ?? []) {
			if (!hosts.has(w.proxy_host_id)) continue;
			await trx("nginxions_waf_host").insert({
				...w,
				proxy_host_id: hosts.get(w.proxy_host_id),
				modified_on: now(),
			});
		}
		for (const w of content.waf_locations ?? []) {
			if (!hosts.has(w.proxy_host_id)) continue;
			await trx("nginxions_waf_location").insert({
				...w,
				proxy_host_id: hosts.get(w.proxy_host_id),
				modified_on: now(),
			});
		}

		// what the package no longer has
		const keep = { proxy_host: hosts, access_list: accessLists, certificate: certificates };
		for (const kind of ["proxy_host", "access_list", "certificate"]) {
			for (const m of managed.filter((r) => r.kind === kind && !keep[kind].has(r.source_id))) {
				if (kind === "proxy_host") {
					await trx("nginxions_waf_host").where({ proxy_host_id: m.local_id }).delete();
					await trx("nginxions_waf_location").where({ proxy_host_id: m.local_id }).delete();
					await trx("npmplus_proxy_host_access_list").where({ proxy_host_id: m.local_id }).delete();
					removedHosts.push(m.local_id);
				}
				if (kind === "access_list") {
					await trx("access_list_auth").where({ access_list_id: m.local_id }).delete();
					await trx("access_list_client").where({ access_list_id: m.local_id }).delete();
				}
				await trx(kind).where({ id: m.local_id }).delete();
				await trx("nginxions_managed").where({ id: m.id }).delete();
			}
		}
	});

	for (const c of certificatesToWrite) await writeCertificate(c);
	for (const id of removedHosts) await removeConfig(id);
	// nothing managed before or now: nginx is left as it is
	if (hostIds.length || removedHosts.length) await configure(hostIds);
	const rows = hostIds.length ? await db()("proxy_host").whereIn("id", hostIds) : [];
	const offline = rows
		.map((r) => ({ id: r.id, meta: typeof r.meta === "string" ? JSON.parse(r.meta || "{}") : (r.meta ?? {}) }))
		.filter((r) => r.meta.nginx_online === false)
		.map((r) => ({ id: r.id, error: String(r.meta.nginx_err ?? "").slice(0, 300) }));
	return { hosts: hostIds.length, skipped, offline };
};
