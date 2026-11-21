// Servers of NginxionS connected to this one, the manager (docs/ROADMAP.md, phase 15; docs/adr/0012-nodes.md).
//   - "Agents → Nodes → Add node": a row of the node (pending) and its one-time join code (24 h, only its hash kept);
//   - the node registers with the code and a CSR (CN = its uid; its key never leaves it): the manager signs it with
//     the trust domain "NginxionS Nodes" of its PKI (made at the first registration) and gives the node its token;
//   - the node sends a heartbeat with its token every 30 s: version, hosts, the state of its agent;
//   - "Disable": the certificate of the node is revoked, its token forgotten; its next heartbeat gets 403.
// RBAC: nodes:view (the list), nodes:manage (add, new code, disable, delete).
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
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
	nodeLogsOf,
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
import { readClusterLearning } from "./cluster-learning.js";
import {
	contentOf,
	hostIdsOf,
	keepPackage,
	keptContent,
	labelHosts,
	packageOf,
	packagesOf,
	signingKey,
} from "./package.js";
import { signPackage } from "./package-model.js";
import { getSetting, setSetting } from "../settings.js";
import { learningRole } from "./role.js";

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
	// taken out of work: its package has no hosts (step 15.6)
	drained: Boolean(row.drained),
	// a command waiting for the next heartbeat of the node (step 15.6)
	command: row.command ? { action: row.command, on: row.command_on } : null,
	// reached first by a staged rollout (step 15.2)
	canary: Boolean(row.canary),
	// held on a package it was given before: "manual" (a rollback) or "staged" (a staged rollout has not reached it)
	pinned: row.pinned_version ? { version: row.pinned_version, by: row.pinned_by } : null,
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
/** what a manager can ask of a node (done by the node with its next heartbeat) */
export const NODE_COMMANDS = ["restart_agent", "collect_logs"];
/** where a manager keeps the last logs each node sent (step 15.6) */
const NODE_LOGS_DIR = process.env.NGINXIONS_NODE_LOGS_DIR || "/data/nginxions/cluster/node-logs";
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

	/**
	 * A command to an active node, done with its next heartbeat (step 15.6): restart_agent restarts its agent. One at a
	 * time; a new one replaces the one that waits.
	 * @param {Access} access
	 * @param {number} id
	 * @param {string} action
	 */
	command: async (access, id, action) => {
		await access.can("nodes:manage");
		if (!NODE_COMMANDS.includes(action)) throw new errs.ValidationError(`Unknown command: ${action}`);
		const row = await rowOf(id);
		if (row.status !== "active") throw new errs.ValidationError("The node is not active");
		await db()(TABLE)
			.where({ id })
			.update({ command: action, command_id: randomBytes(8).toString("hex"), command_on: new Date() });
		await audit(access, "updated", id, { name: row.name, command: action });
		return toNode(await rowOf(id), Date.now(), await hostIdsOf(id));
	},

	/**
	 * A node out of work and back (step 15.6): drained, its next package has no hosts and the node removes them; back,
	 * the hosts given to it come back with the next package.
	 * @param {Access} access
	 * @param {number} id
	 * @param {boolean} drained
	 */
	drain: async (access, id, drained) => {
		await access.can("nodes:manage");
		const row = await rowOf(id);
		await db()(TABLE)
			.where({ id })
			.update({ drained: Boolean(drained), modified_on: new Date() });
		await audit(access, "updated", id, { name: row.name, drained: Boolean(drained) });
		return toNode(await rowOf(id), Date.now(), await hostIdsOf(id));
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
		// the command of the manager is done: told once in the rollout, then the node has none
		if (row.command_id && next.command_done === row.command_id) {
			rollout.push({
				kind: "command",
				version: row.command,
				result: next.command_error ? "failed" : "applied",
				error: next.command_error,
			});
			await db()(TABLE).where({ id: row.id }).update({ command: null, command_id: null, command_on: null });
			row.command = null;
		}
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
			...(row.command ? { command: { id: row.command_id, action: row.command } } : {}),
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
	 * Without login: the logs a node collected for its manager (command collect_logs), kept until the next ones.
	 * @returns {Promise<{stored: number}|null>} null: unknown or disabled node
	 */
	storeLogs: async (token, logs) => {
		const row = await nodeOfToken(token);
		if (!row) return null;
		const clean = nodeLogsOf(logs);
		if (!clean) throw new errs.ValidationError("logs: {service: [{stream, line}]}");
		await mkdir(NODE_LOGS_DIR, { recursive: true, mode: 0o700 });
		const file = path.join(NODE_LOGS_DIR, `${row.uid}.json`);
		await writeFile(`${file}.tmp`, JSON.stringify({ collectedOn: new Date().toISOString(), logs: clean }), {
			mode: 0o600,
		});
		await rename(`${file}.tmp`, file);
		return { stored: Object.keys(clean).length };
	},

	/**
	 * The last logs a node sent: {collectedOn, logs: {service: [{stream, line}]}}, or null before any.
	 * @param {Access} access
	 * @param {number} id
	 */
	logs: async (access, id) => {
		await access.can("nodes:view");
		await access.can("services:view");
		const row = await rowOf(id);
		try {
			return JSON.parse(await readFile(path.join(NODE_LOGS_DIR, `${row.uid}.json`), "utf8"));
		} catch (err) {
			if (err.code === "ENOENT") return null;
			throw err;
		}
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

	/**
	 * The learning of the cluster (step 15.6): per site of the shared storage of this manager, the data of windows each
	 * node sent and those of this server, and when smartsync last put them together. Only on a manager with nodes.
	 * @param {Access} access
	 */
	clusterLearning: async (access) => {
		await access.can("nodes:view");
		if (!(await learningRole()).smartsync) return { available: false, assets: [] };
		const nodes = await db()(TABLE).whereNot({ status: "pending" }).select("uid", "name");
		try {
			return { available: true, assets: await readClusterLearning(nodes), error: "" };
		} catch (err) {
			return { available: true, assets: [], error: String(err.message).slice(0, 300) };
		}
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

	/**
	 * The proxy hosts given to labels: every node with a label serves them (step 15.2). A list (a label is not a key: the
	 * client of the GUI would change its case): [{label, host_ids}], every label of a node or of hosts.
	 */
	labelHosts: async (access) => {
		await access.can("nodes:view");
		const given = await labelHosts();
		const labels = new Set(Object.keys(given));
		for (const row of await db()(TABLE).whereNot({ status: "revoked" }).select("labels")) {
			for (const l of parse(row.labels) ?? []) labels.add(l);
		}
		return [...labels].sort().map((label) => ({ label, host_ids: given[label] ?? [] }));
	},

	/**
	 * @param {Access} access
	 * @param {string} label
	 * @param {number[]} hostIds  the proxy hosts of this manager every node with the label serves from now on
	 */
	setLabelHosts: async (access, label, hostIds) => {
		await access.can("nodes:manage");
		const [name] = normalizeLabels([label]);
		if (!name || name !== String(label)) throw new errs.ValidationError(`Not a label: ${label}`);
		const found = await knownHosts(hostIds);
		await db().transaction(async (trx) => {
			await trx("nginxions_label_host").where({ label: name }).delete();
			if (found.length)
				await trx("nginxions_label_host").insert(found.map((h) => ({ label: name, proxy_host_id: h })));
		});
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "cluster",
			meta: { name: `hosts of the label ${name}`, hosts: found },
		});
		return (await labelHosts())[name] ?? [];
	},

	/** the staged rollout: on or off (step 15.2) */
	rolloutSettings: async (access) => {
		await access.can("nodes:view");
		return getSetting(ROLLOUT_KEY);
	},

	/**
	 * A staged rollout on: the nodes that are not canaries are held on the package they run, a change reaches the
	 * canaries only, until "Roll out to all nodes". Off: every node follows the configuration again.
	 * @param {Access} access
	 * @param {boolean} staged
	 */
	setStaged: async (access, staged) => {
		await access.can("nodes:manage");
		const settings = await setSetting(ROLLOUT_KEY, { staged: Boolean(staged) });
		for (const row of await db()(TABLE).where({ status: "active" })) {
			if (settings.staged && !row.canary && !row.pinned_version) await holdOnRunning(row);
			if (!settings.staged && row.pinned_by === STAGED) await unpin(row.id);
		}
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "cluster",
			meta: { name: "staged rollout", staged: settings.staged },
		});
		return settings;
	},

	/** the staged rollout reaches every node: the nodes held by it get the configuration now (and stay held on it) */
	promote: async (access) => {
		await access.can("nodes:manage");
		const rows = await db()(TABLE).where({ status: "active", pinned_by: STAGED });
		for (const row of rows) await holdOn(row.id, STAGED, await currentPackage(row.id));
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "cluster",
			meta: { name: "staged rollout", promoted: rows.map((r) => r.name) },
		});
		return { promoted: rows.length };
	},

	/** a canary is reached first by a staged rollout */
	setCanary: async (access, id, canary) => {
		await access.can("nodes:manage");
		const row = await rowOf(id);
		await db()(TABLE)
			.where({ id })
			.update({ canary: Boolean(canary), modified_on: new Date() });
		const { staged } = await getSetting(ROLLOUT_KEY);
		if (staged && canary && row.pinned_by === STAGED) await unpin(id);
		if (staged && !canary && !row.pinned_version && row.status === "active") await holdOnRunning(row);
		await audit(access, "updated", id, { name: row.name, canary: Boolean(canary) });
		return toNode(await rowOf(id), Date.now(), await hostIdsOf(id));
	},

	/** the packages kept for a node (the last ones it was given), the newest first */
	packages: async (access, id) => {
		await access.can("nodes:view");
		const row = await rowOf(id);
		const applied = parse(row.info)?.package_version ?? "";
		return (await packagesOf(id)).map((p) => ({
			version: p.version,
			created_on: p.created_on,
			applied: p.version === applied,
			pinned: p.version === row.pinned_version,
		}));
	},

	/**
	 * A node held on a package it was given before (a rollback), or back to following the configuration (version
	 * null; during a staged rollout a node that is not a canary is held on the configuration now).
	 * @param {Access} access
	 * @param {number} id
	 * @param {string|null} version
	 */
	hold: async (access, id, version) => {
		await access.can("nodes:manage");
		const row = await rowOf(id);
		if (version) {
			if (!(await keptContent(id, version)))
				throw new errs.ValidationError("This node was never given this package");
			await holdOn(id, MANUAL, version);
		} else {
			const { staged } = await getSetting(ROLLOUT_KEY);
			if (staged && !row.canary) await holdOn(id, STAGED, await currentPackage(id));
			else await unpin(id);
		}
		await audit(access, "updated", id, { name: row.name, package: version ?? "follows the configuration" });
		return toNode(await rowOf(id), Date.now(), await hostIdsOf(id));
	},
};

const ROLLOUT_KEY = "cluster.rollout";
const STAGED = "staged";
const MANUAL = "manual";

/** the proxy hosts of this manager among these ids; an unknown one is refused */
const knownHosts = async (hostIds) => {
	const wanted = [...new Set((Array.isArray(hostIds) ? hostIds : []).map(Number))];
	const found = wanted.length
		? (await db()("proxy_host").whereIn("id", wanted).where({ is_deleted: 0 })).map((h) => h.id)
		: [];
	const unknown = wanted.filter((h) => !found.includes(h));
	if (unknown.length) throw new errs.ValidationError(`Unknown proxy hosts: ${unknown.join(", ")}`);
	return found.sort((a, b) => a - b);
};

/** the package of the configuration now for a node, kept; its version */
const currentPackage = async (id) => {
	const pkg = signPackage(await contentOf(id), (await signingKey()).privateKey);
	await keepPackage(id, pkg);
	return pkg.version;
};

const holdOn = (id, by, version) =>
	db()(TABLE).where({ id }).update({ pinned_version: version, pinned_by: by, modified_on: new Date() });
const unpin = (id) =>
	db()(TABLE).where({ id }).update({ pinned_version: null, pinned_by: null, modified_on: new Date() });

/** held on the package the node runs (kept), or on the configuration now when it runs none of the kept ones */
const holdOnRunning = async (row) => {
	const running = parse(row.info)?.package_version;
	const version = running && (await keptContent(row.id, running)) ? running : await currentPackage(row.id);
	await holdOn(row.id, STAGED, version);
};

export default internalNodes;
