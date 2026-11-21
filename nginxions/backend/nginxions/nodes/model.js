// Servers of NginxionS connected to one manager (docs/ROADMAP.md, phase 15; docs/adr/0012-nodes.md): the pure part.
// No database, no network: the ids, the join code, the hashes and the state of a node shown in the GUI.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** the node_id of the rows of a node; "local" is this server */
/** the state of this server as a node of a manager (member.js): token and key encrypted, in the data volume */
export const MEMBER_FILE = process.env.NGINXIONS_MEMBER_FILE || "/data/nginxions/cluster/member.json";

export const UID = /^n-[0-9a-f]{16}$/;
/** the join code: <uid>.<secret>; the node puts the uid into its CSR, the manager keeps the hash of the code */
export const CODE = /^(n-[0-9a-f]{16})\.([A-Za-z0-9_-]{32,64})$/;
/** the token of a node: its heartbeat until the channel with mTLS (step 15.2) */
export const TOKEN = /^nt_[A-Za-z0-9_-]{43}$/;
export const CODE_HOURS = 24;
/** a heartbeat every 30 s: a node not heard for 3 of them is offline */
export const HEARTBEAT_MS = 30000;
export const OFFLINE_MS = 3 * HEARTBEAT_MS;
export const STATUSES = ["pending", "active", "revoked"];

export const newUid = () => `n-${randomBytes(8).toString("hex")}`;
export const newCode = (uid) => `${uid}.${randomBytes(32).toString("base64url")}`;
export const newToken = () => `nt_${randomBytes(32).toString("base64url")}`;
export const hash = (value) => createHash("sha256").update(String(value)).digest("hex");

/** the hash of a secret is the stored one, in constant time */
export const sameHash = (value, stored) => {
	if (typeof stored !== "string" || stored.length !== 64) return false;
	const a = Buffer.from(hash(value), "hex");
	const b = Buffer.from(stored, "hex");
	return a.length === b.length && timingSafeEqual(a, b);
};

/** the uid in a join code, or null */
export const uidOfCode = (code) => CODE.exec(String(code ?? "").trim())?.[1] ?? null;

/** labels of a node: short words, at most 20 */
export const normalizeLabels = (labels) =>
	[
		...new Set(
			(Array.isArray(labels) ? labels : [])
				.map((l) => String(l).trim().toLowerCase())
				.filter((l) => /^[a-z0-9][a-z0-9._-]{0,31}$/.test(l)),
		),
	].slice(0, 20);

/** what the node tells in a heartbeat, kept short and typed: nothing else is stored */
export const normalizeInfo = (info) => {
	const src = info && typeof info === "object" ? info : {};
	const text = (v, max = 64) => (typeof v === "string" ? v.slice(0, max) : "");
	const int = (v) => (Number.isInteger(v) && v >= 0 && v < 2 ** 31 ? v : null);
	return {
		version: text(src.version, 32),
		hostname: text(src.hostname),
		hosts: int(src.hosts),
		uptime: int(src.uptime),
		agent: ["ok", "down", "off"].includes(src.agent) ? src.agent : "",
		// the package of configuration the node applied (step 15.2), what it left out, its last error
		package_version: /^[0-9a-f]{64}$/.test(src.package_version ?? "") ? src.package_version : "",
		package_skipped: int(src.package_skipped),
		package_error: text(src.package_error, 300),
		// the learning profile for new nodes it started with (step 15.5), its last error
		profile_version: /^[0-9a-f]{64}$/.test(src.profile_version ?? "") ? src.profile_version : "",
		profile_error: text(src.profile_error, 300),
		// the model of the agent it took from the manager, its last error
		model_sha256: /^[0-9a-f]{64}$/.test(src.model_sha256 ?? "") ? src.model_sha256 : "",
		model_error: text(src.model_error, 300),
	};
};

/**
 * The state of a node for the GUI: pending (its code valid or expired), online, offline, revoked.
 * @param {{status: string, code_expires_on?: Date|string|null, last_seen_on?: Date|string|null}} row
 */
export const stateOf = (row, now = Date.now()) => {
	if (row.status === "revoked") return "revoked";
	if (row.status === "pending") {
		return row.code_expires_on && new Date(row.code_expires_on).getTime() > now ? "pending" : "expired";
	}
	const seen = row.last_seen_on ? new Date(row.last_seen_on).getTime() : 0;
	return now - seen <= OFFLINE_MS ? "online" : "offline";
};

/** the address of a manager: https only, a host and an optional port, no path */
export const normalizeManagerUrl = (value) => {
	let url;
	try {
		url = new URL(String(value ?? "").trim());
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
	if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
	return `https://${url.host}`;
};

/** what a node applies of its manager: the field of its version and of its error in the heartbeat */
const ROLLOUT_KINDS = [
	["package", "package_version", "package_error"],
	["model", "model_sha256", "model_error"],
	["profile", "profile_version", "profile_error"],
];

/**
 * The rollout a heartbeat tells (step 15.6): a version applied that the node did not have, or a new error. Nothing
 * when the info is the same as before.
 * @param {object} before  the info of the heartbeat before (normalizeInfo)
 * @param {object} after   the info of this heartbeat
 * @returns {{kind: string, version: string, result: "applied"|"failed", error: string}[]}
 */
export const rolloutOf = (before, after) => {
	const out = [];
	for (const [kind, versionKey, errorKey] of ROLLOUT_KINDS) {
		const version = after?.[versionKey] ?? "";
		const error = after?.[errorKey] ?? "";
		if (error && error !== (before?.[errorKey] ?? "")) {
			out.push({ kind, version, result: "failed", error });
		} else if (version && version !== (before?.[versionKey] ?? "")) {
			out.push({ kind, version, result: "applied", error: "" });
		}
	}
	return out;
};
