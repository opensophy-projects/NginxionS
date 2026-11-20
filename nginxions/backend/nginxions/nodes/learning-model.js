// What a node may ask of the shared storage and smartsync of its manager (step 15.4, docs/adr/0012-nodes.md 5c).
// The agent of a node reads and writes the storage of its manager through the relay of NginxionS (relay.js); the
// manager lets through:
//   - reads (GET) of any learning file and listings (list-type=2&prefix=...): the state put together, the labels;
//   - writes (PUT) of the data of a window only: <asset>/<type>/window_<d>_<n>/<agent>/data.data[<i>]. The manager
//     puts the id of the node in front of the agent part, so the data of a node is always under its own id: smartsync
//     sees which node a source came from, and a node cannot write as another one;
//   - nothing else: the state put together (remote/), the state of an agent (processed/), the labels
//     (tuning/decisions.data) are written on the manager only. A node that learns alone for a while (no smartsync
//     answer yet) keeps its processed state at home.

/** a segment of a path of the storage: no control characters, no backslash (traversal: cleanStoragePath) */
const safeSegment = (segment) =>
	[...segment].every((c) => {
		const code = c.codePointAt(0);
		return code > 0x1f && code !== 0x7f && c !== "\\";
	});

/** the data of a window: <prefix>/window_<d>_<n>/<agent...>/data.data[<i>] */
const WINDOW_DATA = /^(.+\/window_\d{1,6}(?:_\d{1,6})?)\/(.+)\/(data\.data\d{0,6})$/;

const WINDOW_ID = /^(window_\d{1,6}(_\d{1,6})?|remote|processed)$/;
const SYNC_TYPE = /^[A-Za-z]{1,64}(\/[A-Za-z]{1,64})?$/;

/** the most of one request body of the relay (the data of one window of a busy site is a few MB) */
export const MAX_LEARNING_BODY = 32 * 1024 * 1024;

/**
 * The path of the storage a request names, cleaned: one slash between segments (an agent without a tenant asks
 * /api//<asset>/...), no "." or "..".
 * @param {string} raw  the path after /api (may be empty for a listing)
 * @returns {string|null} "/a/b/c", "/" for the root, null when not allowed
 */
export const cleanStoragePath = (raw) => {
	let decoded;
	try {
		decoded = decodeURIComponent(String(raw ?? ""));
	} catch {
		return null;
	}
	const segments = decoded.split("/").filter(Boolean);
	for (const segment of segments) {
		if (segment === "." || segment === ".." || !safeSegment(segment)) return null;
	}
	return `/${segments.join("/")}`;
};

/**
 * What the manager does with a request of the agent of a node to its storage.
 * @param {string} method
 * @param {string} rawPath   the path after /api
 * @param {URLSearchParams} query
 * @param {string} uid       the id of the node (from its token)
 * @returns {{path: string, search: string} | {error: string, status: number}}
 */
export const storageRequestOf = (method, rawPath, query, uid) => {
	const path = cleanStoragePath(rawPath);
	if (path === null) return { status: 400, error: "the path is not allowed" };
	if (method === "GET") {
		// a listing: list-type=2 and a prefix, cleaned the same way; nothing else is passed on
		if (query.get("list-type") === "2") {
			const prefix = cleanStoragePath(query.get("prefix") ?? "");
			if (prefix === null) return { status: 400, error: "the prefix is not allowed" };
			const keepSlash = (query.get("prefix") ?? "").endsWith("/") && prefix !== "/" ? "/" : "";
			const search = new URLSearchParams({ "list-type": "2", prefix: `${prefix}${keepSlash}` });
			return { path: "/", search: `?${search}` };
		}
		if (path === "/") return { status: 400, error: "a file or a listing" };
		return { path, search: "" };
	}
	if (method === "PUT" || method === "POST") {
		const match = WINDOW_DATA.exec(path);
		if (!match) return { status: 403, error: "a node writes the data of its windows only" };
		return { path: `${match[1]}/${uid}/${match[2]}/${match[3]}`, search: "" };
	}
	return { status: 405, error: "GET or PUT" };
};

/**
 * The notification of the agent of a node to smartsync (POST /api/sync): its known fields only.
 * @returns {{assetId: string, type: string, windowId: string} | null}
 */
export const syncNotificationOf = (body) => {
	const assetId = typeof body?.assetId === "string" ? body.assetId : "";
	const type = typeof body?.type === "string" ? body.type : "";
	const windowId = typeof body?.windowId === "string" ? body.windowId : "";
	// the agent takes the slashes out of the id of an asset (Serializator.cc): one segment
	if (!assetId || assetId.length > 512 || assetId.includes("/") || cleanStoragePath(assetId) !== `/${assetId}`) {
		return null;
	}
	if (!SYNC_TYPE.test(type) || !WINDOW_ID.test(windowId)) return null;
	return { assetId, type, windowId };
};
