// This server as a node of a manager (docs/ROADMAP.md, phase 15; docs/adr/0012-nodes.md).
//   - "Connect to a manager": the address of the manager and the join code from its "Agents → Nodes"; a key is made
//     here (it never leaves), the CSR (CN = the id of the node in the code) is signed by the manager;
//   - the certificate of the panel of the manager is trusted at the first connection: its fingerprint is kept and
//     every later request goes over a socket checked against it before anything (the code, the token) is sent;
//   - a heartbeat every 30 s; the manager down or slow (timeout) changes nothing here: the node protects as before;
//   - disabled on the manager (403): the node says so in its GUI and stops calling.
// The state (token and key encrypted with the secrets of NginxionS) is a file of the data volume.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { isIP } from "node:net";
import { hostname } from "node:os";
import path from "node:path";
import tls from "node:tls";
import db from "../../db.js";
import internalAuditLog from "../../internal/audit-log.js";
import errs from "../../lib/error.js";
import { global as logger } from "../../logger.js";
import pjson from "../../package.json" with { type: "json" };
import { makeCsr } from "../pki/ops.js";
import { generateKey } from "../pki/x509.js";
import { decrypt, encrypt } from "../secrets.js";
import { applyLearningRole } from "../waf/agent-settings.js";
import { applyContent } from "./apply.js";
import { HEARTBEAT_MS, MEMBER_FILE, normalizeManagerUrl, uidOfCode } from "./model.js";
import { openPackage } from "./package-model.js";

export { MEMBER_FILE };

/** the content of the last package applied: what a failed package goes back to */
const PACKAGE_FILE = () => path.join(path.dirname(MEMBER_FILE), "package.json");
const TIMEOUT_MS = 10000;
const MAX_ANSWER = 256 * 1024;

const audit = (access, action, meta) => internalAuditLog.add(access, { action, object_type: "cluster", meta });

/** the colon form of a SHA-256 fingerprint, as Node and the PKI give it */
const sameFingerprint = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();

/**
 * A request to the manager over a socket whose certificate is checked first: with a pin, a socket with another
 * certificate is closed before anything is written; without one (the first connection) its fingerprint is returned.
 * The body and the answer are bytes (the learning relay, relay.js); managerRequest below speaks JSON.
 * @returns {Promise<{status: number, headers: object, body: Buffer, fingerprint: string}>}
 */
export const managerExchange = (
	managerUrl,
	urlPath,
	{ method = "POST", body = null, headers = {}, token, pin, maxAnswer = MAX_ANSWER, timeoutMs = TIMEOUT_MS } = {},
) =>
	new Promise((resolve, reject) => {
		const url = new URL(urlPath, managerUrl);
		const port = Number(url.port || 443);
		const done = (err, value) => (err ? reject(err) : resolve(value));
		const socket = tls.connect({
			host: url.hostname,
			port,
			servername: isIP(url.hostname) ? undefined : url.hostname,
			// the trust is the pin (or the first connection), not the CAs of the system: panels of NginxionS often
			// have a certificate of their own
			rejectUnauthorized: false,
			timeout: timeoutMs,
		});
		socket.setTimeout(timeoutMs, () => socket.destroy(new Error("the manager did not answer in time")));
		socket.once("error", (err) => done(err));
		socket.once("secureConnect", () => {
			const fingerprint = socket.getPeerCertificate()?.fingerprint256 || "";
			if (!fingerprint || (pin && !sameFingerprint(pin, fingerprint))) {
				socket.destroy();
				return done(new Error(`the certificate of the manager changed (${fingerprint || "none"})`));
			}
			const req = http.request(
				{
					createConnection: () => socket,
					host: url.hostname,
					port,
					// as given, not normalized: the relay passes the path of the agent on and the manager judges it
					path: urlPath.startsWith("/") ? urlPath : `${url.pathname}${url.search}`,
					method,
					headers: {
						Host: url.host,
						...headers,
						...(body ? { "Content-Length": body.length } : {}),
						...(token ? { Authorization: `Bearer ${token}` } : {}),
					},
				},
				(res) => {
					const chunks = [];
					let size = 0;
					res.on("data", (chunk) => {
						size += chunk.length;
						if (size > maxAnswer) return res.destroy(new Error("the answer of the manager is too big"));
						chunks.push(chunk);
					});
					res.on("error", (err) => done(err));
					res.on("end", () => {
						socket.end();
						done(null, {
							status: res.statusCode,
							headers: res.headers,
							body: Buffer.concat(chunks),
							fingerprint,
						});
					});
				},
			);
			req.on("error", (err) => done(err));
			req.end(body ?? undefined);
		});
	});

/**
 * A JSON request to the manager (managerExchange).
 * @returns {Promise<{status: number, body: any, fingerprint: string}>}
 */
export const managerRequest = async (managerUrl, urlPath, { method = "POST", body, token, pin } = {}) => {
	const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
	const answer = await managerExchange(managerUrl, urlPath, {
		method,
		body: payload,
		headers: { Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}) },
		token,
		pin,
	});
	let parsed = null;
	try {
		parsed = JSON.parse(answer.body.toString() || "null");
	} catch {
		parsed = null;
	}
	return { status: answer.status, body: parsed, fingerprint: answer.fingerprint };
};

// --------------------------------------------------------------------------------------------- the state file
export const readState = async () => {
	try {
		return JSON.parse(await readFile(MEMBER_FILE, "utf8"));
	} catch {
		return null;
	}
};
const writeState = async (state) => {
	await mkdir(path.dirname(MEMBER_FILE), { recursive: true, mode: 0o700 });
	const tmp = `${MEMBER_FILE}.tmp`;
	await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
	await rename(tmp, MEMBER_FILE);
};

const statusOf = (state) =>
	state
		? {
				joined: true,
				manager_url: state.manager_url,
				uid: state.uid,
				name: state.name,
				fingerprint: state.fingerprint,
				joined_on: state.joined_on,
				last_ok_on: state.last_ok_on ?? null,
				last_error: state.last_error ?? "",
				disabled: Boolean(state.disabled),
			}
		: { joined: false };

/** what the node tells the manager in its heartbeat */
const ownInfo = async (state) => {
	let hosts = null;
	try {
		const [row] = await db()("proxy_host").where({ is_deleted: 0, enabled: 1 }).count({ n: "id" });
		hosts = Number(row?.n ?? 0);
	} catch {
		hosts = null;
	}
	return {
		version: pjson.version,
		hostname: hostname(),
		hosts,
		uptime: Math.round(process.uptime()),
		package_version: state?.applied_version ?? "",
		package_skipped: state?.package_skipped ?? null,
		package_error: state?.package_error ?? "",
	};
};

// ------------------------------------------------------------------------------------------------ heartbeat
/** events of this server sent per request, and the most per heartbeat (a long outage catches up step by step) */
const EVENTS_BATCH = 500;
const EVENTS_PER_BEAT = 5000;

/** the id of the last event of this server: where sending starts (no history before the join) */
const lastEventId = async () => {
	const row = await db()("nginxions_security_event").where({ node_id: "local" }).max({ id: "id" }).first();
	return Number(row?.id ?? 0);
};

/**
 * The security events of this server since the last sent one go to the manager (step 15.3). A manager down keeps the
 * cursor where it is: nothing is lost, the next heartbeats send it.
 * @returns {Promise<object>} what changes in the state
 */
export const forwardEvents = async (state) => {
	let cursor = Number(state.events_cursor ?? 0);
	let sent = 0;
	try {
		while (sent < EVENTS_PER_BEAT) {
			const rows = await db()("nginxions_security_event")
				.where({ node_id: "local" })
				.where("id", ">", cursor)
				.orderBy("id")
				.limit(EVENTS_BATCH);
			if (!rows.length) break;
			const answer = await managerRequest(state.manager_url, "/api/nginxions/nodes/events", {
				token: decrypt(state.token_enc),
				pin: state.fingerprint,
				body: { events: rows.map(({ id: _id, node_id: _node, ...event }) => event) },
			});
			if (answer.status !== 200) throw new Error(`the manager answered ${answer.status} to the events`);
			cursor = Number(rows.at(-1).id);
			sent += rows.length;
			if (rows.length < EVENTS_BATCH) break;
		}
		return { events_cursor: cursor, events_error: "" };
	} catch (err) {
		return { events_cursor: cursor, events_error: String(err.message).slice(0, 300) };
	}
};

/** the package applied last, or none (no managed rows) */
const lastContent = async () => {
	try {
		return JSON.parse(await readFile(PACKAGE_FILE(), "utf8"));
	} catch {
		return { hosts: [], certificates: [], access_lists: [], waf_hosts: [], waf_locations: [] };
	}
};

/**
 * The package of the manager: fetched, its signature checked against the pinned key, applied; a package nginx
 * refuses is replaced by the one before (the node keeps serving what worked) and is not tried again.
 * @returns {Promise<object>} what changes in the state
 */
export const sync = async (state) => {
	try {
		if (!state.signing_key) throw new Error("no key of the manager to check its package");
		const answer = await managerRequest(state.manager_url, "/api/nginxions/nodes/package", {
			method: "GET",
			token: decrypt(state.token_enc),
			pin: state.fingerprint,
		});
		if (answer.status !== 200) throw new Error(`the manager answered ${answer.status}`);
		const content = openPackage(answer.body, state.signing_key);
		const result = await applyContent(content);
		if (result.offline.length) {
			const before = await lastContent();
			await applyContent(before);
			const error = `nginx refused ${result.offline.length} host(s): ${result.offline[0].error}`;
			logger.warn(`Cluster: the package ${answer.body.version.slice(0, 12)} was rolled back: ${error}`);
			return { failed_version: answer.body.version, package_error: error.slice(0, 300) };
		}
		await mkdir(path.dirname(PACKAGE_FILE()), { recursive: true, mode: 0o700 });
		await writeFile(PACKAGE_FILE(), JSON.stringify(content), { mode: 0o600 });
		logger.info(`Cluster: package ${answer.body.version.slice(0, 12)} applied (${result.hosts} host(s))`);
		return {
			applied_version: answer.body.version,
			failed_version: "",
			package_error: "",
			package_skipped: result.skipped.length,
		};
	} catch (err) {
		return { package_error: String(err.message).slice(0, 300) };
	}
};

let timer = null;
let running = false;

export const beat = async () => {
	if (running) return;
	const state = await readState();
	if (!state || state.disabled) return;
	running = true;
	try {
		const answer = await managerRequest(state.manager_url, "/api/nginxions/nodes/heartbeat", {
			token: decrypt(state.token_enc),
			pin: state.fingerprint,
			body: { info: await ownInfo(state) },
		});
		if (answer.status === 200) {
			let next = {
				...state,
				name: answer.body?.name || state.name,
				// a node joined before step 15.2 learns the key of its manager here, over the pinned channel
				signing_key: state.signing_key || answer.body?.signing_key || "",
				last_ok_on: new Date(),
				last_error: "",
			};
			const version = answer.body?.package_version;
			if (version && version !== next.applied_version && version !== next.failed_version) {
				next = { ...next, ...(await sync(next)) };
			}
			next = { ...next, ...(await forwardEvents(next)) };
			await writeState(next);
		} else if (answer.status === 401 || answer.status === 403) {
			await writeState({ ...state, disabled: true, last_error: "disabled on the manager" });
			logger.warn("Cluster: this node was disabled on its manager; it keeps protecting its sites on its own");
			// the agent learns here again (step 15.4)
			await applyLearningRole();
		} else {
			await writeState({ ...state, last_error: `the manager answered ${answer.status}` });
		}
	} catch (err) {
		await writeState({ ...state, last_error: String(err.message).slice(0, 300) });
	} finally {
		running = false;
	}
};

export const start = () => {
	if (timer) clearInterval(timer);
	// the learning relay of a node (step 15.4): listens on every server, answers 503 while it is not a node
	import("./relay.js")
		.then(({ startRelay }) => startRelay())
		.catch((err) => logger.warn(`Cluster: the learning relay: ${err.message}`));
	const tick = () => beat().catch((err) => logger.warn(`Cluster heartbeat: ${err.message}`));
	timer = setInterval(tick, HEARTBEAT_MS);
	timer.unref?.();
	// at the start too, without waiting: a node that restarted shows up again at once (it never blocks the start)
	setTimeout(tick, 1000).unref?.();
};

// ------------------------------------------------------------------------------------------------------- API
const internalMember = {
	/** @param {Access} access */
	status: async (access) => {
		await access.can("settings:view");
		const status = statusOf(await readState());
		if (!status.joined) return status;
		// the learning of the agent through the manager (step 15.4): what its relay did last
		const { relayStatus } = await import("./relay.js");
		return { ...status, learning: relayStatus() };
	},

	/**
	 * Connects this server to a manager with a join code.
	 * @param {Access} access
	 * @param {{manager_url: string, code: string}} data
	 */
	join: async (access, data) => {
		await access.can("settings:manage");
		if ((await readState()) && !(await readState()).disabled) {
			throw new errs.ValidationError("This server is a node of a manager already: disconnect it first");
		}
		const managerUrl = normalizeManagerUrl(data.manager_url);
		if (!managerUrl) throw new errs.ValidationError("The address of the manager: https://host[:port]");
		const code = String(data.code ?? "").trim();
		const uid = uidOfCode(code);
		if (!uid) throw new errs.ValidationError("The join code is not valid: copy it again from the manager");
		const keyPem = generateKey("ec-p256");
		const csrPem = await makeCsr({ keyPem, subject: { common_name: uid, organization: "NginxionS" } });
		let answer;
		try {
			answer = await managerRequest(managerUrl, "/api/nginxions/nodes/register", {
				body: { code, csr_pem: csrPem, info: await ownInfo(null) },
			});
		} catch (err) {
			throw new errs.ValidationError(`The manager is not reachable: ${err.message}`);
		}
		if (answer.status !== 200 || !answer.body?.token) {
			const reason = answer.body?.error?.message || `the manager answered ${answer.status}`;
			throw new errs.ValidationError(`The manager refused the code: ${reason}`);
		}
		const now = new Date();
		await writeState({
			manager_url: managerUrl,
			uid: answer.body.uid,
			name: answer.body.name,
			fingerprint: answer.fingerprint,
			token_enc: encrypt(answer.body.token),
			key_enc: encrypt(keyPem),
			cert_pem: answer.body.cert_pem,
			chain_pem: answer.body.chain_pem,
			signing_key: answer.body.signing_key || "",
			events_cursor: await lastEventId(),
			joined_on: now,
			last_ok_on: now,
			last_error: "",
		});
		await audit(access, "created", {
			manager_url: managerUrl,
			uid: answer.body.uid,
			fingerprint: answer.fingerprint,
		});
		// the agent learns together with the other servers, through the manager (step 15.4)
		await applyLearningRole(access.token.getUserId(1));
		return statusOf(await readState());
	},

	/** this server stops being a node (disable it on the manager too) */
	leave: async (access) => {
		await access.can("settings:manage");
		const state = await readState();
		if (!state) return statusOf(null);
		await rm(MEMBER_FILE, { force: true });
		await audit(access, "deleted", { manager_url: state.manager_url, uid: state.uid });
		await applyLearningRole(access.token.getUserId(1));
		return statusOf(null);
	},
};

export default internalMember;
