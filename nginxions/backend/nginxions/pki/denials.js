// Requests refused by mTLS → nginxions_security_event (kind "mtls"): nginx writes them to their own log
// (_nginxions_mtls.conf, format nginxions_mtls of conf.d/nginxions-mtls-log.conf), read here every few seconds.
// The position is the cursor "mtls:denied" in nginxions_log_cursor, stored with the rows.
// A browser without a certificate refused on one page sends the page, its scripts and API calls at once: refusals of
// the same source, host and reason within a minute are one event with the number of requests (repeats).
import db from "../../db.js";
import { pollJsonLog, startJsonLog } from "../events/jsonlog.js";
import { EVENT_TABLE } from "../events/store.js";

export const LOG_FILE = process.env.NGINXIONS_MTLS_LOG || "/data/nginx/logs/nginxions-mtls.log";
const CURSOR = "mtls:denied";

const str = (v, max = 255) => String(v ?? "").slice(0, max);

/**
 * @param {object} line  a line of the log (JSON)
 * @returns {object|null} row of nginxions_security_event
 */
export const toEvent = (line, nodeId = "local") => {
	if (!line?.time || !line.ip) return null;
	const time = new Date(line.time);
	if (Number.isNaN(time.getTime())) return null;
	const verify = str(line.verify, 255);
	const missing = verify === "NONE" || verify === "";
	const [uri, query = ""] = str(line.uri, 4096).split(/\?(.*)/s);
	return {
		node_id: nodeId,
		time,
		kind: "mtls",
		name: missing ? "mTLS: no client certificate" : "mTLS: client certificate not accepted",
		severity: "medium",
		priority: "",
		confidence: "",
		action: "denied",
		incident_type: missing ? "mTLS no certificate" : "mTLS certificate",
		source_ip: str(line.ip, 64),
		source_port: null,
		proxy_ip: "",
		source_country: "",
		host: str(line.host).toLowerCase(),
		asset: "",
		method: str(line.method, 16),
		uri: uri.slice(0, 2048),
		query: query.slice(0, 2048),
		// the answer the host chose (denied_page): 403, 404 or 444 (closed); older lines have none
		response_code: Number.parseInt(line.status, 10) || 403,
		location: "",
		parameter: "",
		// SUCCESS here: the certificate is valid, but its issuer or a rule of the host refused it
		sample: str(
			[line.s_dn && `subject: ${line.s_dn}`, line.serial && `serial: ${line.serial}`].filter(Boolean).join("; "),
			2048,
		),
		indicators: "",
		score: null,
		rule: verify,
		practice: "",
		override: "",
		service: "nginx",
		raw: JSON.stringify(line).slice(0, 64 * 1024),
	};
};

/** refusals within this time of the first one of a run are counted in it */
export const WINDOW_MS = 60000;

const RUN_FIELDS = ["source_ip", "host", "incident_type", "sample", "response_code"];
const runKey = (e) => RUN_FIELDS.map((f) => e[f] ?? "").join("\u0000");

/** the stored event that starts a run this refusal belongs to (the newest within the window), or null */
const storedRun = async (e) => {
	const row = await db()(EVENT_TABLE)
		.select("id", "time")
		.where({ kind: "mtls", ...Object.fromEntries(RUN_FIELDS.map((f) => [f, e[f]])) })
		.where("time", ">=", new Date(e.time.getTime() - WINDOW_MS))
		.where("time", "<=", e.time)
		.orderBy([
			{ column: "time", order: "desc" },
			{ column: "id", order: "desc" },
		])
		.first();
	return row ? { id: row.id, time: new Date(row.time) } : null;
};

/**
 * Refusals of one round → new events and the stored events they repeat.
 * @param {object[]} events  in the order of the log
 * @param {(e: object) => Promise<{id, time: Date}|null>} [findStored]
 * @returns {Promise<{events: object[], repeats: {id, time: Date, add: number}[]}>}
 */
export const collapseRuns = async (events, findStored = storedRun) => {
	const runs = new Map();
	const fresh = [];
	const stored = [];
	for (const e of events) {
		const key = runKey(e);
		let run = runs.get(key);
		if (run && e.time - run.start > WINDOW_MS) run = null;
		if (!run) {
			const found = runs.has(key) ? null : await findStored(e);
			run = found
				? { start: found.time, stored: { ...found, add: 0 } }
				: { start: e.time, event: { ...e, repeats: 1 } };
			if (run.stored) stored.push(run.stored);
			else fresh.push(run.event);
			runs.set(key, run);
			if (!found) continue;
		}
		if (run.stored) run.stored.add += 1;
		else run.event.repeats += 1;
	}
	return { events: fresh, repeats: stored.filter((r) => r.add > 0) };
};

/** one round: new lines of the log → events */
export const pollOnce = ({ file = LOG_FILE, now = new Date() } = {}) =>
	pollJsonLog({ file, cursor: CURSOR, toEvent, now, collapse: collapseRuns });

export const startDenials = () =>
	startJsonLog({ name: "mTLS denials", file: LOG_FILE, cursor: CURSOR, toEvent, collapse: collapseRuns });
