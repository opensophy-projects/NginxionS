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
import { HEARTBEAT_MS, normalizeManagerUrl, uidOfCode } from "./model.js";

export const MEMBER_FILE = process.env.NGINXIONS_MEMBER_FILE || "/data/nginxions/cluster/member.json";
const TIMEOUT_MS = 10000;
const MAX_ANSWER = 256 * 1024;

const audit = (access, action, meta) => internalAuditLog.add(access, { action, object_type: "cluster", meta });

/** the colon form of a SHA-256 fingerprint, as Node and the PKI give it */
const sameFingerprint = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();

/**
 * A JSON request to the manager over a socket whose certificate is checked first: with a pin, a socket with another
 * certificate is closed before anything is written; without one (the first connection) its fingerprint is returned.
 * @returns {Promise<{status: number, body: any, fingerprint: string}>}
 */
export const managerRequest = (managerUrl, urlPath, { method = "POST", body, token, pin } = {}) =>
	new Promise((resolve, reject) => {
		const url = new URL(urlPath, managerUrl);
		const port = Number(url.port || 443);
		const done = (err, value) => (err ? reject(err) : resolve(value));
		const socket = tls.connect({
			host: url.hostname,
			port,
			servername: tls.isIP?.(url.hostname) ? undefined : url.hostname,
			// the trust is the pin (or the first connection), not the CAs of the system: panels of NginxionS often
			// have a certificate of their own
			rejectUnauthorized: false,
			timeout: TIMEOUT_MS,
		});
		socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("the manager did not answer in time")));
		socket.once("error", (err) => done(err));
		socket.once("secureConnect", () => {
			const fingerprint = socket.getPeerCertificate()?.fingerprint256 || "";
			if (!fingerprint || (pin && !sameFingerprint(pin, fingerprint))) {
				socket.destroy();
				return done(new Error(`the certificate of the manager changed (${fingerprint || "none"})`));
			}
			const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
			const req = http.request(
				{
					createConnection: () => socket,
					host: url.hostname,
					port,
					path: url.pathname,
					method,
					headers: {
						Host: url.host,
						Accept: "application/json",
						...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
						...(token ? { Authorization: `Bearer ${token}` } : {}),
					},
				},
				(res) => {
					const chunks = [];
					let size = 0;
					res.on("data", (chunk) => {
						size += chunk.length;
						if (size > MAX_ANSWER) return res.destroy(new Error("the answer of the manager is too big"));
						chunks.push(chunk);
					});
					res.on("error", (err) => done(err));
					res.on("end", () => {
						socket.end();
						let parsed = null;
						try {
							parsed = JSON.parse(Buffer.concat(chunks).toString() || "null");
						} catch {
							parsed = null;
						}
						done(null, { status: res.statusCode, body: parsed, fingerprint });
					});
				},
			);
			req.on("error", (err) => done(err));
			req.end(payload ?? undefined);
		});
	});

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
const ownInfo = async () => {
	let hosts = null;
	try {
		const [row] = await db()("proxy_host").where({ is_deleted: 0, enabled: 1 }).count({ n: "id" });
		hosts = Number(row?.n ?? 0);
	} catch {
		hosts = null;
	}
	return { version: pjson.version, hostname: hostname(), hosts, uptime: Math.round(process.uptime()) };
};

// ------------------------------------------------------------------------------------------------ heartbeat
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
			body: { info: await ownInfo() },
		});
		if (answer.status === 200) {
			await writeState({
				...state,
				name: answer.body?.name || state.name,
				last_ok_on: new Date(),
				last_error: "",
			});
		} else if (answer.status === 401 || answer.status === 403) {
			await writeState({ ...state, disabled: true, last_error: "disabled on the manager" });
			logger.warn("Cluster: this node was disabled on its manager; it keeps protecting its sites on its own");
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
		return statusOf(await readState());
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
				body: { code, csr_pem: csrPem, info: await ownInfo() },
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
			joined_on: now,
			last_ok_on: now,
			last_error: "",
		});
		await audit(access, "created", {
			manager_url: managerUrl,
			uid: answer.body.uid,
			fingerprint: answer.fingerprint,
		});
		return statusOf(await readState());
	},

	/** this server stops being a node (disable it on the manager too) */
	leave: async (access) => {
		await access.can("settings:manage");
		const state = await readState();
		if (!state) return statusOf(null);
		await rm(MEMBER_FILE, { force: true });
		await audit(access, "deleted", { manager_url: state.manager_url, uid: state.uid });
		return statusOf(null);
	},
};

export default internalMember;
