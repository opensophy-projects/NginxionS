// Where the learning profiles of this server are kept (step 15.5, learning/profiles.js), read only: the package of a
// node (nodes/package.js) names the profile for new nodes from here without the rest of learning.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import errs from "../../lib/error.js";

export const PROFILE_DIR = process.env.NGINXIONS_LEARNING_PROFILE_DIR || "/data/nginxions/learning/profiles";
export const PROFILE_ID = /^p-[0-9a-f]{12}$/;

/** the profiles, the newest first: [{id, name, createdOn, origin, fingerprint, own, sites, assets, files, size, ...}] */
export const listProfiles = async () => {
	let names;
	try {
		names = await readdir(PROFILE_DIR);
	} catch (err) {
		if (err.code === "ENOENT") return [];
		throw err;
	}
	const metas = [];
	for (const name of names.filter((n) => n.endsWith(".meta.json"))) {
		try {
			metas.push(JSON.parse(await readFile(path.join(PROFILE_DIR, name), "utf8")));
		} catch {
			// a broken description: the profile is not listed
		}
	}
	return metas
		.filter((m) => PROFILE_ID.test(m?.id ?? "") && typeof m.createdOn === "string")
		.sort((a, b) => b.createdOn.localeCompare(a.createdOn));
};

/** the profile for new nodes of this manager: {id, version}, or null (none, or the folder cannot be read) */
export const profileForNewNodes = async () => {
	try {
		const meta = (await listProfiles()).find((m) => m.forNewNodes);
		return meta ? { id: meta.id, version: meta.version } : null;
	} catch {
		return null;
	}
};

/** the signed file of a profile */
export const profileBytes = async (id) => {
	if (!PROFILE_ID.test(String(id))) throw new errs.ValidationError("invalid profile id");
	try {
		return await readFile(path.join(PROFILE_DIR, `${id}.json.gz`));
	} catch (err) {
		if (err.code === "ENOENT") throw new errs.ItemNotFoundError(id);
		throw err;
	}
};
