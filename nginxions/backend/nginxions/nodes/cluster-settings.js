// Thresholds of the learning of the nodes put together by smartsync on a manager (step 15.4, docs/adr/0012-nodes.md
// 5c), edited in "Agents → Nodes → Learning of the nodes": how many different sources must see a value before it is
// normal (parameters and types of values), in how many windows, and which share of the sources. NginxionS writes them
// to a JSON file next to the settings of the agent; smartsync reads it before each sync (no restart).
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import internalAuditLog from "../../internal/audit-log.js";
import errs from "../../lib/error.js";
import { global as logger } from "../../logger.js";
import { getSetting, setSetting } from "../settings.js";

const LOCALCONFIG_DIR = path.dirname(process.env.NGINXIONS_APPSEC_POLICY_FILE || "/ext/appsec/local_policy.yaml");
export const SMARTSYNC_SETTINGS_FILE = path.join(LOCALCONFIG_DIR, "nginxions-smartsync.json");
const KEY = "cluster.learning";

const writeFileOf = async (settings) => {
	await mkdir(LOCALCONFIG_DIR, { recursive: true });
	const tmp = `${SMARTSYNC_SETTINGS_FILE}.tmp`;
	await writeFile(tmp, `${JSON.stringify(settings)}\n`);
	await rename(tmp, SMARTSYNC_SETTINGS_FILE);
};

/** at backend start: smartsync reads the file at its next sync */
export const bootstrap = async () => {
	try {
		await writeFileOf(await getSetting(KEY));
	} catch (err) {
		logger.warn(`Cluster: the settings of smartsync were not written: ${err.message}`);
	}
};

const internalClusterSettings = {
	/** @param {Access} access */
	get: async (access) => {
		await access.can("nodes:view");
		return getSetting(KEY);
	},

	/**
	 * @param {Access} access
	 * @param {{minSources: number, minSourcesTypes: number, minIntervals: number, ratioThreshold: number}} data
	 */
	set: async (access, data) => {
		await access.can("waf_learning:sync");
		const value = {
			minSources: Number(data?.minSources),
			minSourcesTypes: Number(data?.minSourcesTypes),
			minIntervals: Number(data?.minIntervals),
			ratioThreshold: Number(data?.ratioThreshold),
		};
		let settings;
		try {
			settings = await setSetting(KEY, value);
		} catch (err) {
			throw new errs.ValidationError(
				`Learning of the nodes: sources 2–1000, windows 1–100, share 0.1–1 (${err.message})`,
			);
		}
		await writeFileOf(settings);
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "cluster",
			meta: { name: "learning of the nodes", ...settings },
		});
		return settings;
	},
};

export default internalClusterSettings;
