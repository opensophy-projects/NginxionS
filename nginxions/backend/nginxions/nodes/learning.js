// The learning of several servers on the manager (step 15.4, docs/adr/0012-nodes.md 5c): what the agent of a node
// asks of the shared storage and smartsync of its manager arrives here (the relay of the node, relay.js, over the
// pinned TLS of the node with its token) and goes to the local services of the openappsec container, whose network
// namespace NginxionS shares. What a node may ask: learning-model.js.
import { randomUUID } from "node:crypto";
import { storageRequestOf, syncNotificationOf } from "./learning-model.js";

const STORAGE_URL = process.env.NGINXIONS_APPSEC_STORAGE_URL || "http://127.0.0.1:7811";
const SMARTSYNC_URL = process.env.NGINXIONS_APPSEC_SMARTSYNC_URL || "http://127.0.0.1:7815";
const TIMEOUT_MS = 30000;
/** the agent of NginxionS has no tenant: "local" (its files are at the root of the storage) */
const TENANT = "local";

const answerOf = (status, message) => ({
	status,
	type: "application/json",
	body: Buffer.from(JSON.stringify({ error: { code: status, message } })),
});

const forward = async (url, method, body, type) => {
	let response;
	try {
		response = await fetch(url, {
			method,
			headers: {
				"X-Tenant-Id": TENANT,
				"X-Correlation-Id": randomUUID(),
				...(body?.length ? { "Content-Type": type || "application/octet-stream" } : {}),
			},
			body: body?.length ? body : undefined,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (err) {
		return answerOf(502, `the learning service of the manager is not reachable: ${err.cause?.code || err.message}`);
	}
	return {
		status: response.status,
		type: response.headers.get("content-type") || "application/octet-stream",
		body: Buffer.from(await response.arrayBuffer()),
	};
};

/**
 * A request of the agent of node uid to the shared storage of this manager.
 * @param {string} uid
 * @param {{method: string, rawPath: string, query: URLSearchParams, body: Buffer|null, type?: string}} req
 * @returns {Promise<{status: number, type: string, body: Buffer}>}
 */
export const forwardStorage = async (uid, { method, rawPath, query, body, type }) => {
	const target = storageRequestOf(method, rawPath, query, uid);
	if (target.error) return answerOf(target.status, target.error);
	return forward(`${STORAGE_URL}/api${target.path}${target.search}`, method, method === "GET" ? null : body, type);
};

/**
 * The notification of the agent of a node to smartsync: the data of a window is in the storage, put it together.
 * @returns {Promise<{status: number, type: string, body: Buffer}>}
 */
export const forwardSync = async (body) => {
	let parsed = null;
	try {
		parsed = JSON.parse(body?.toString() || "null");
	} catch {
		parsed = null;
	}
	const notification = syncNotificationOf(parsed);
	if (!notification) return answerOf(400, "assetId, type and windowId of the agent");
	return forward(`${SMARTSYNC_URL}/api/sync`, "POST", Buffer.from(JSON.stringify(notification)), "application/json");
};
