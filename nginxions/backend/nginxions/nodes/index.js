// Servers of NginxionS connected to this one, the manager (docs/ROADMAP.md, phase 15; docs/adr/0012-nodes.md).
//   - "Agents → Nodes → Add node": a row of the node (pending) and its one-time join code (24 h, only its hash kept);
//   - the node registers with the code and a CSR (CN = its uid; its key never leaves it): the manager signs it with
//     the trust domain "NginxionS Nodes" of its PKI (made at the first registration) and gives the node its token;
//   - the node sends a heartbeat with its token every 30 s: version, hosts, the state of its agent;
//   - "Disable": the certificate of the node is revoked, its token forgotten; its next heartbeat gets 403.
// RBAC: nodes:view (the list), nodes:manage (add, new code, disable, delete).
import db from "../../db.js";
import internalAuditLog from "../../internal/audit-log.js";
import errs from "../../lib/error.js";
import { EVENT_TABLE, store } from "../events/store.js";
import internalPki, { SYSTEM } from "../pki/index.js";
import { readCsr } from "../pki/ops.js";
import { parseCert } from "../pki/x509.js";
import { applyLearningRole } from "../waf/agent-settings.js";
import { forwardStorage, forwardSync } from "./learning.js";
import {
	CODE_HOURS,
	hash,
	newCode,
	newToken,
	newUid,
	normalizeInfo,
	rolloutOf,
	normalizeLabels,
	sameHash,
	stateOf,
	TOKEN,
	uidOfCode,
} from "./model.js";
import { profileBytes, profileForNewNodes } from "../learning/profile-store.js";
import { MODEL_FILE, modelRef } from "../waf/model-file.js";
import { hostIdsOf, packageOf, signingKey } from "./package.js";

const TABLE = "nginxions_node";
export const NODES_ROOT = "NginxionS Nodes Root CA";
export const NODES_DOMAIN = "NginxionS Nodes";
const parse = (value) => (typeof value === "string" ? JSON.parse(value || "null") : value) ?? null;

const audit = (access, action, id, meta) =>
	internalAuditLog.add(access, { action, object_type: "node", object_id: id, meta });

const toNode = (row, now = Date.now(), hostIds = []) => ({
	id: row.id,
	uid: row.uid,
	name: row.name,
	status: row.status,
	state: stateOf(row, now),
	labels: parse(row.labels) ?? [],
	fingerprint: row.fingerprint,
	address: row.address,
	info: parse(row.info) ?? {},
	created_on: row.created_on,
	registered_on: row.registered_on,
	last_seen_on: row.last_seen_on,
	code_expires_on: row.status === "pending" ? row.code_expires_on : null,
	host_ids: hostIds,
});

const rowOf = async (id) => {
	const row = await db()(TABLE).where({ id }).first();
	if (!row) throw new errs.ItemNotFoundError(id);
	return row;
};

/** the trust domain that signs the certificates of nodes, made with its own root the first time */
const nodesDomain = async () => {
	const cas = await db()("nginxions_pki_ca");
	const now = new Date();
	const usable = (ca) => ca.key_enc && !ca.revoked_on && new Date(ca.not_after) > now;
	const domain = cas.find((ca) => ca.kind === "intermediate" && ca.name === NODES_DOMAIN && usable(ca));
	if (domain) return domain.id;
	let root = cas.find((ca) => ca.kind === "root" && ca.name === NODES_ROOT && usable(ca));
	if (!root) {
		root = await internalPki.createCa(SYSTEM, {
			kind: "root",
			name: NODES_ROOT,
			subject: { common_name: NODES_ROOT, organization: "NginxionS" },
		});
	}
	const created = await internalPki.createCa(SYSTEM, {
		kind: "intermediate",
		name: NODES_DOMAIN,
		parent_id: root.id,
		subject: { common_name: NODES_DOMAIN, organization: "NginxionS" },
	});
	return created.id;
};

const issueCode = async (id, uid) => {
	const code = newCode(uid);
	const expires = new Date(Date.now() + CODE_HOURS * 3600000);
	await db()(TABLE)
		.where({ id })
		.update({ code_hash: hash(code), code_expires_on: expires, modified_on: new Date() });
	return { code, code_expires_on: expires };
};

const ROLLOUT_TABLE = "nginxions_node_rollout";
/** the rollout is kept this long */
const ROLLOUT_KEEP_DAYS = 180;

/** a node with this token, active; null otherwise */
const nodeOfToken = async (token) => {
	if (!TOKEN.test(String(token ?? ""))) return null;
	const row = await db()(TABLE)
		.where({ token_hash: hash(token) })
		.first();
	return row && row.status === "active" && sameHash(token, row.token_hash) ? row : null;
};

/** at most this many events per request of a node (it sends the rest with the next ones) */
export const MAX_EVENTS = 500;
let eventColumns = null;
/** the columns of the events a node may send: those of the table, never id (ours) or node_id (its token says) */
const columnsOfEvents = async () => {
	eventColumns ??= Object.keys(await db()(EVENT_TABLE).columnInfo()).filter((c) => !["id", "node_id"].includes(c));
	return eventColumns;
};

const internalNodes = {
	/** @param {Access} access */
	list: async (access) => {
		await access.can("nodes:view");
		const rows = await db()(TABLE).orderBy("id");
		const links = await db()("nginxions_node_host");
		const now = Date.now();
		return rows.map((row) =>
			toNode(
				row,
				now,
				links.filter((l) => l.node_id === row.id).map((l) => l.proxy_host_id),
			),
		);
	},

	/**
	 * A node to come: its row and its join code (shown once).
	 * @param {Access} access
	 * @param {{name: string, labels?: string[]}} data
	 */
	add: async (access, data) => {
		await access.can("nodes:manage");
		const name = String(data.name ?? "").trim();
		if (!name) throw new errs.ValidationError("The node needs a name");
		if (await db()(TABLE).where({ name }).whereNot({ status: "revoked" }).first()) {
			throw new errs.ValidationError(`A node named ${name} exists`);
		}
		const now = new Date();
		const uid = newUid();
		const [inserted] = await db()(TABLE)
			.insert({
				created_on: now,
				modified_on: now,
				uid,
				name: name.slice(0, 100),
				status: "pending",
				labels: JSON.stringify(normalizeLabels(data.labels)),
				info: "{}",
				created_by: access.token.getUserId(0),
			})
			.returning("id");
		const id = typeof inserted === "object" ? inserted.id : inserted;
		const code = await issueCode(id, uid);
		await audit(access, "created", id, { name, uid });
		return { node: toNode(await rowOf(id)), ...code };
	},

	/** a new join code for a node that has not registered yet (the old one stops working) */
	newCode: async (access, id) => {
		await access.can("nodes:manage");
		const row = await rowOf(id);
		if (row.status !== "pending")
			throw new errs.ValidationError("Only a node that waits for its registration gets a code");
		const code = await issueCode(id, row.uid);
		await audit(access, "updated", id, { name: row.name, code: "new" });
		return { node: toNode(await rowOf(id)), ...code };
	},

	/** labels and name of a node */
	update: async (access, id, data) => {
		await access.can("nodes:manage");
		const row = await rowOf(id);
		const patch = { modified_on: new Date() };
		if (data.name !== undefined) {
			const name = String(data.name).trim();
			if (!name) throw new errs.ValidationError("The node needs a name");
			patch.name = name.slice(0, 100);
		}
		if (data.labels !== undefined) patch.labels = JSON.stringify(normalizeLabels(data.labels));
		await db()(TABLE).where({ id }).update(patch);
		await audit(access, "updated", id, { name: patch.name ?? row.name });
		return toNode(await rowOf(id));
	},

	/** the node stops being trusted: its certificate revoked, its token forgotten */
	revoke: async (access, id) => {
		await access.can("nodes:manage");
		const row = await rowOf(id);
		if (row.status === "revoked") return toNode(row);
		if (row.cert_id) await internalPki.revoke(SYSTEM, [row.cert_id], "cessationOfOperation");
		await db()(TABLE).where({ id }).update({
			status: "revoked",
			token_hash: null,
			code_hash: null,
			code_expires_on: null,
			modified_on: new Date(),
		});
		await audit(access, "disabled", id, { name: row.name, uid: row.uid });
		// the last active node gone: smartsync is not needed here any more (step 15.4)
		await applyLearningRole(access.token.getUserId(1));
		return toNode(await rowOf(id));
	},

	/** a node that is not active (waits for its registration or is disabled) is removed */
	remove: async (access, id) => {
		await access.can("nodes:manage");
		const row = await rowOf(id);
		if (row.status === "active") throw new errs.ValidationError("Disable the node first");
		await db()("nginxions_node_host").where({ node_id: id }).delete();
		await db()(TABLE).where({ id }).delete();
		await audit(access, "deleted", id, { name: row.name, uid: row.uid });
		return true;
	},

	/**
	 * Without login: a node registers with its join code and its CSR (CN = its uid).
	 * @param {{code: string, csr_pem: string, info?: object}} data
	 * @param {string} address  the address the request came from
	 * @returns {Promise<{uid, name, token, cert_pem, chain_pem}|null>} null: unknown, used or expired code
	 */
	register: async (data, address = "") => {
		const uid = uidOfCode(data.code);
		if (!uid) return null;
		const row = await db()(TABLE).where({ uid }).first();
		if (row?.status !== "pending" || !sameHash(String(data.code).trim(), row.code_hash)) return null;
		if (!row.code_expires_on || new Date(row.code_expires_on) <= new Date()) return null;
		if (typeof data.csr_pem !== "string") throw new errs.ValidationError("csr_pem is required");
		await readCsr(data.csr_pem);
		// the code is spent before the certificate is signed: a second request with it gets nothing
		const spent = await db()(TABLE)
			.where({ id: row.id, status: "pending", code_hash: row.code_hash })
			.update({ code_hash: null, code_expires_on: null, modified_on: new Date() });
		if (!spent) return null;
		const caId = await nodesDomain();
		const issued = await internalPki.issue(SYSTEM, {
			ca_id: caId,
			profile: "client",
			csr_pem: data.csr_pem,
			days: 825,
			notes: `node ${row.name} (${uid})`,
		});
		const info = parseCert(issued.files.cert_pem);
		if (info.subject.common_name !== uid) {
			await internalPki.revoke(SYSTEM, [issued.certificate.id], "unspecified");
			throw new errs.ValidationError("The CN of the request must be the id of the node");
		}
		const token = newToken();
		const now = new Date();
		await db()(TABLE)
			.where({ id: row.id })
			.update({
				status: "active",
				token_hash: hash(token),
				cert_id: issued.certificate.id,
				fingerprint: info.fingerprint,
				registered_on: now,
				last_seen_on: now,
				address: String(address).slice(0, 64),
				info: JSON.stringify(normalizeInfo(data.info)),
				modified_on: now,
			});
		await audit(SYSTEM, "updated", row.id, { name: row.name, uid, registered: true });
		// the first active node: smartsync of this manager puts the learning of the nodes together (step 15.4)
		await applyLearningRole();
		return {
			uid,
			name: row.name,
			token,
			cert_pem: issued.files.cert_pem,
			chain_pem: issued.files.chain_pem,
			signing_key: (await signingKey()).publicKeyPem,
		};
	},

	/**
	 * Without login: the heartbeat of a node, with its token.
	 * @returns {Promise<{uid, name, labels, server_time}|null>} null: unknown or disabled node
	 */
	heartbeat: async (token, info, address = "") => {
		const row = await nodeOfToken(token);
		if (!row) return null;
		const now = new Date();
		const next = normalizeInfo(info);
		await db()(TABLE)
			.where({ id: row.id })
			.update({
				last_seen_on: now,
				address: String(address).slice(0, 64),
				info: JSON.stringify(next),
			});
		// what the node applied (or failed) since its heartbeat before: the rollout in "Agents → Nodes"
		const rollout = rolloutOf(parse(row.info) ?? {}, next);
		if (rollout.length) {
			await db()(ROLLOUT_TABLE).insert(rollout.map((r) => ({ ...r, node_id: row.id, created_on: now })));
			await db()(ROLLOUT_TABLE)
				.where("created_on", "<", new Date(now.getTime() - ROLLOUT_KEEP_DAYS * 86400000))
				.delete();
		}
		const pkg = await packageOf(row.id);
		return {
			uid: row.uid,
			name: row.name,
			labels: parse(row.labels) ?? [],
			server_time: now.toISOString(),
			package_version: pkg.version,
			signing_key: (await signingKey()).publicKeyPem,
		};
	},

	/**
	 * Without login: security events of a node (step 15.3), stored as events of this server with the id of the node,
	 * so that Events, Analytics and notifications see them.
	 * @returns {Promise<{stored: number}|null>} null: unknown or disabled node
	 */
	events: async (token, rows) => {
		const row = await nodeOfToken(token);
		if (!row) return null;
		if (!Array.isArray(rows)) throw new errs.ValidationError("events: a list");
		if (rows.length > MAX_EVENTS) throw new errs.ValidationError(`events: at most ${MAX_EVENTS} at once`);
		const columns = await columnsOfEvents();
		const events = [];
		for (const event of rows) {
			if (!event || typeof event !== "object") continue;
			const time = new Date(event.time);
			if (Number.isNaN(time.getTime()) || typeof event.kind !== "string") continue;
			const clean = Object.fromEntries(columns.filter((c) => event[c] !== undefined).map((c) => [c, event[c]]));
			events.push({ ...clean, time, node_id: row.uid });
		}
		if (events.length) await store({ events, telemetry: [], cursors: [] });
		return { stored: events.length };
	},

	/** Without login: the signed package of the node with this token; null for an unknown or disabled node */
	package: async (token) => {
		const row = await nodeOfToken(token);
		return row ? packageOf(row.id) : null;
	},

	/**
	 * Without login: the file of the advanced model of the agent of this manager (step 15.5); null for an unknown or
	 * disabled node, {none: true} without a model.
	 * @returns {Promise<{file: string, size: number}|{none: true}|null>}
	 */
	wafModel: async (token) => {
		const row = await nodeOfToken(token);
		if (!row) return null;
		const ref = await modelRef();
		return ref ? { file: MODEL_FILE, size: ref.size } : { none: true };
	},

	/**
	 * Without login: the learning profile for new nodes (step 15.5), the signed file; null for an unknown or disabled
	 * node, {none: true} when this manager has none.
	 * @returns {Promise<{bytes: Buffer}|{none: true}|null>}
	 */
	learningProfile: async (token) => {
		const row = await nodeOfToken(token);
		if (!row) return null;
		const ref = await profileForNewNodes();
		if (!ref) return { none: true };
		return { bytes: await profileBytes(ref.id) };
	},

	/**
	 * Without login: a request of the agent of a node to the shared storage of this manager (step 15.4).
	 * @returns {Promise<{status: number, type: string, body: Buffer}|null>} null: unknown or disabled node
	 */
	learningStorage: async (token, request) => {
		const row = await nodeOfToken(token);
		return row ? forwardStorage(row.uid, request) : null;
	},

	/** Without login: the agent of a node tells smartsync of this manager that the data of a window is there */
	learningSync: async (token, body) => {
		const row = await nodeOfToken(token);
		return row ? forwardSync(body) : null;
	},

	/**
	 * The rollout to the nodes, the newest first: what each applied of this manager (a package, the model of the agent,
	 * a learning profile) or what failed.
	 * @param {Access} access
	 * @param {{node_id?: number, limit?: number}} [query]
	 */
	rollout: async (access, query = {}) => {
		await access.can("nodes:view");
		let rows = db()(ROLLOUT_TABLE)
			.join(TABLE, `${TABLE}.id`, `${ROLLOUT_TABLE}.node_id`)
			.select(`${ROLLOUT_TABLE}.*`, `${TABLE}.name as node_name`)
			.orderBy(`${ROLLOUT_TABLE}.created_on`, "desc")
			.orderBy(`${ROLLOUT_TABLE}.id`, "desc")
			.limit(Math.min(Math.max(Number(query.limit) || 200, 1), 1000));
		if (query.node_id) rows = rows.where(`${ROLLOUT_TABLE}.node_id`, query.node_id);
		return rows;
	},

	/** the proxy hosts a node serves (ids of this manager) */
	hosts: async (access, id) => {
		await access.can("nodes:view");
		await rowOf(id);
		return hostIdsOf(id);
	},

	/** @param {number[]} hostIds  the proxy hosts of this manager the node serves from now on */
	setHosts: async (access, id, hostIds) => {
		await access.can("nodes:manage");
		const row = await rowOf(id);
		const wanted = [...new Set(hostIds)];
		const found = wanted.length
			? (await db()("proxy_host").whereIn("id", wanted).where({ is_deleted: 0 })).map((h) => h.id)
			: [];
		const unknown = wanted.filter((h) => !found.includes(h));
		if (unknown.length) throw new errs.ValidationError(`Unknown proxy hosts: ${unknown.join(", ")}`);
		await db().transaction(async (trx) => {
			await trx("nginxions_node_host").where({ node_id: id }).delete();
			if (found.length)
				await trx("nginxions_node_host").insert(found.map((h) => ({ node_id: id, proxy_host_id: h })));
		});
		await audit(access, "updated", id, { name: row.name, hosts: found });
		return hostIdsOf(id);
	},
};

export default internalNodes;
