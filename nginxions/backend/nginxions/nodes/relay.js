// The learning relay of a node (step 15.4, docs/adr/0012-nodes.md 5c). On a node the agent learns together with the
// other servers: its SHARED_STORAGE_HOST and LEARNING_HOST are this relay (deploy/openappsec/agent/nginxions-entry.sh),
// which takes each request to the manager over the pinned TLS of the node, with its token:
//   127.0.0.1:7817  the shared storage of the manager (/api/<path> → /api/nginxions/nodes/learning/storage/<path>)
//   127.0.0.1:7818  smartsync of the manager (POST /api/sync → /api/nginxions/nodes/learning/sync)
// The ports are in the network namespace of the openappsec container, which NginxionS shares; nothing listens outside.
// Not a node (or disabled): 503, the agent keeps what it learned and tries again later. The manager down: 502, the same.
import http from "node:http";
import { global as logger } from "../../logger.js";
import { decrypt } from "../secrets.js";
import { MAX_LEARNING_BODY, storageTarget, syncTarget } from "./learning-model.js";
import { clientOf, managerExchange, readState } from "./member.js";

const STORAGE_PORT = Number(process.env.NGINXIONS_RELAY_STORAGE_PORT || 7817);
const SYNC_PORT = Number(process.env.NGINXIONS_RELAY_SYNC_PORT || 7818);
const TIMEOUT_MS = 60000;

/** what the relay did last: shown with the state of the node ("Agents → Nodes → This server") */
const stats = { requests: 0, last_ok_on: null, last_error: "" };
export const relayStatus = () => ({ ...stats });

/** an HTTP status as a number in its range, else 502 */
const statusOf = (status) => (Number.isInteger(status) && status >= 100 && status <= 599 ? status : 502);

const reply = (res, status, message) => {
	res.statusCode = statusOf(status);
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify({ error: { code: res.statusCode, message: String(message) } }));
};

/** the body of a request, refused above the limit */
const bodyOf = (req) =>
	new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_LEARNING_BODY) {
				reject(Object.assign(new Error("the body is too big"), { status: 413 }));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});

/**
 * A relay: requests of the local agent to a path of the manager.
 * @param {(raw: string, method: string) => string|null} targetOf  the path on the manager from the path and query as
 *   the agent sent them (not normalized: the manager judges them); null: not relayed (404)
 */
export const relayHandler = (targetOf) => async (req, res) => {
	try {
		const raw = String(req.url ?? "");
		const target = targetOf(raw, req.method);
		if (!target) return reply(res, 404, "not a learning request");
		const state = await readState();
		if (!state || state.disabled) return reply(res, 503, "this server is not a node of a manager");
		const body = await bodyOf(req);
		const answer = await managerExchange(state.manager_url, target, {
			method: req.method,
			// bytes for the manager: its JSON parser never reads them
			body: body.length ? body : null,
			headers: body.length ? { "Content-Type": "application/octet-stream" } : {},
			token: decrypt(state.token_enc),
			pin: state.fingerprint,
			client: clientOf(state),
			maxAnswer: MAX_LEARNING_BODY,
			timeoutMs: TIMEOUT_MS,
		});
		stats.requests += 1;
		// the storage answered (a file not there yet is 404 of the storage): the chain works; 401 and 5xx do not
		if (answer.status < 500 && answer.status !== 401) {
			stats.last_ok_on = new Date();
			stats.last_error = "";
		} else {
			stats.last_error = `the manager answered ${answer.status} to ${req.method} ${raw.split("?")[0]}`.slice(
				0,
				300,
			);
		}
		res.statusCode = statusOf(answer.status);
		// the type of the answer of the manager: JSON or bytes of the storage, nothing else is passed on
		res.setHeader(
			"Content-Type",
			String(answer.headers["content-type"] || "").startsWith("application/json")
				? "application/json"
				: "application/octet-stream",
		);
		res.end(answer.body);
	} catch (err) {
		stats.last_error = `the manager is not reachable: ${err.message}`.slice(0, 300);
		if (!res.headersSent) reply(res, err.status || 502, `the manager is not reachable: ${err.message}`);
		else res.destroy();
	}
};

const servers = [];

/** both relays on 127.0.0.1; a port taken is logged, never stops the start */
export const startRelay = ({ storagePort = STORAGE_PORT, syncPort = SYNC_PORT } = {}) =>
	Promise.all(
		[
			[storagePort, storageTarget, "storage"],
			[syncPort, syncTarget, "smartsync"],
		].map(
			([port, targetOf, name]) =>
				new Promise((resolve) => {
					const server = http.createServer(relayHandler(targetOf));
					server.requestTimeout = TIMEOUT_MS + 5000;
					server.once("error", (err) => {
						logger.warn(
							`Cluster: the learning relay (${name}) cannot listen on 127.0.0.1:${port}: ${err.message}`,
						);
						resolve(null);
					});
					server.listen(port, "127.0.0.1", () => {
						servers.push(server);
						resolve(server.address().port);
					});
				}),
		),
	);

export const stopRelay = async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
};
