// Bans shared by the servers of a cluster (docs/ROADMAP.md, phase 15, step 15.3; docs/adr/0012-nodes.md 5b): a ban of
// CrowdSec or of the agent on one server is a ban on all of them.
//   - the bans of a server ("own"): its active decisions on addresses and ranges, except blocklists (each server has
//     them from its settings), the bans of the central API and the bans it took from the cluster;
//   - a node sends its own bans to its manager when they change; the manager keeps them per node;
//   - the bans of the cluster for a server: the own bans of the manager and of every other node, the longest of each
//     address; each server keeps them in its CrowdSec as decisions of origin "nginxions-cluster" (added, and removed
//     when they leave the list: an unban where the ban was made reaches every server).
import { createHash } from "node:crypto";

export const CLUSTER_ORIGIN = "nginxions-cluster";
const SCENARIO = "nginxions/cluster";
/** at most this many bans go around: the newest first */
export const MAX_BANS = 5000;
const NOT_SHARED = ["lists", "CAPI", CLUSTER_ORIGIN];

/** seconds of a duration of CrowdSec ("3h59m56.3s", "-1s", "720h"); 0 for an expired or broken one */
export const secondsOf = (duration) => {
	const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?$/.exec(String(duration ?? "").trim());
	if (!m || !(m[1] || m[2] || m[3])) return 0;
	return Math.floor(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0));
};

/**
 * The bans of a server to share, from its active decisions.
 * @param {{origin, scope, value, type, duration, scenario}[]} decisions
 * @returns {{value: string, scope: string, type: string, until: string, scenario: string}[]}
 */
export const ownBans = (decisions, now = Date.now()) => {
	const out = new Map();
	for (const d of decisions ?? []) {
		if (NOT_SHARED.includes(d.origin) || String(d.scenario ?? "").startsWith("nginxions/blocklist/")) continue;
		if (!["Ip", "Range"].includes(d.scope) || !["ban", "captcha"].includes(d.type)) continue;
		const seconds = secondsOf(d.duration);
		if (seconds <= 0) continue;
		const until = new Date(now + seconds * 1000).toISOString();
		const key = `${d.value}\u0000${d.type}`;
		if (!out.has(key) || out.get(key).until < until) {
			out.set(key, {
				value: String(d.value),
				scope: d.scope,
				type: d.type,
				until,
				scenario: String(d.scenario ?? "").slice(0, 255),
			});
		}
	}
	return [...out.values()].sort((a, b) => b.until.localeCompare(a.until)).slice(0, MAX_BANS);
};

/** a list of bans received from another server: only well formed, future ones */
export const cleanBans = (list, now = Date.now()) =>
	(Array.isArray(list) ? list : [])
		.filter(
			(b) =>
				b &&
				typeof b.value === "string" &&
				/^[0-9a-fA-F:.]{2,45}(\/\d{1,3})?$/.test(b.value) &&
				["Ip", "Range"].includes(b.scope) &&
				["ban", "captcha"].includes(b.type) &&
				new Date(b.until).getTime() > now,
		)
		.slice(0, MAX_BANS)
		.map((b) => ({
			value: b.value,
			scope: b.scope,
			type: b.type,
			until: new Date(b.until).toISOString(),
			scenario: String(b.scenario ?? "").slice(0, 255),
		}));

/** several lists of bans in one: the longest of each address and type */
export const mergeBans = (...lists) => {
	const out = new Map();
	for (const b of lists.flat()) {
		const key = `${b.value}\u0000${b.type}`;
		if (!out.has(key) || out.get(key).until < b.until) out.set(key, b);
	}
	return [...out.values()].sort((a, b) => a.value.localeCompare(b.value) || a.type.localeCompare(b.type));
};

/** the version of a list of bans: a change of addresses or of their end (to the minute) */
export const versionOfBans = (list) =>
	createHash("sha256")
		.update(
			list
				.map((b) => `${b.value}|${b.type}|${b.until.slice(0, 16)}`)
				.sort()
				.join("\n"),
		)
		.digest("hex");

/**
 * What a server does to its CrowdSec to hold the bans of the cluster: the ones it lacks, the ones to remove.
 * @param {{id, origin, value, type, duration}[]} decisions  its active decisions
 * @param {{value, scope, type, until}[]} bans  the bans of the cluster for it
 */
export const plan = (decisions, bans, now = Date.now()) => {
	const held = (decisions ?? []).filter((d) => d.origin === CLUSTER_ORIGIN);
	const wanted = new Map(bans.map((b) => [`${b.value}\u0000${b.type}`, b]));
	const add = [];
	for (const b of bans) {
		const seconds = Math.floor((new Date(b.until).getTime() - now) / 1000);
		if (seconds <= 0) continue;
		const has = held.find((d) => d.value === b.value && d.type === b.type);
		// held already, ending about then (a minute either way): left as it is
		if (has && Math.abs(secondsOf(has.duration) - seconds) <= 60) continue;
		add.push({ scope: b.scope, value: b.value, type: b.type, duration: `${seconds}s`, replace: has?.id ?? null });
	}
	const remove = held.filter((d) => !wanted.has(`${d.value}\u0000${d.type}`)).map((d) => d.id);
	return { add, remove };
};

/** the CrowdSec of this server (replaced in tests) */
export const io = {
	decisions: async () => (await import("./lapi.js")).decisions(),
	push: async (list) =>
		(await import("./lapi.js")).pushDecisions({
			scenario: SCENARIO,
			origin: CLUSTER_ORIGIN,
			message: "NginxionS: a ban of another server of the cluster",
			decisions: list,
		}),
	remove: async (id) => (await import("./lapi.js")).deleteDecision(id),
};

/** the own bans of this server now */
export const readOwnBans = async () => ownBans(await io.decisions());

/**
 * This server holds these bans of the cluster in its CrowdSec.
 * @returns {Promise<{added: number, removed: number}>}
 */
export const holdBans = async (bans) => {
	const { add, remove } = plan(await io.decisions(), bans);
	for (const id of [...remove, ...add.map((a) => a.replace).filter(Boolean)]) await io.remove(id);
	for (let i = 0; i < add.length; i += 500) {
		await io.push(add.slice(i, i + 500).map(({ replace: _r, ...d }) => d));
	}
	return { added: add.length, removed: remove.length };
};
