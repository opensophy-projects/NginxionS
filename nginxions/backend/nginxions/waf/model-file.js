// The file of the advanced model of the agent (WAF -> Agent): where it is, the one before it, its SHA-256. Kept apart
// from agent-settings.js: the package of a node (nodes/package.js) names the model of its manager by its hash.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export const MODEL_DIR = process.env.NGINXIONS_APPSEC_MODEL_DIR || "/ext/appsec-model";
export const MODEL_FILE = path.join(MODEL_DIR, "open-appsec-advanced-model.tgz");
/** the model before the last upload (or the model of the manager before the last one, on a node) */
export const PREVIOUS_FILE = `${MODEL_FILE}.previous`;

/** the SHA-256 of a file, kept while its size and time do not change (a model is up to 1 GB) */
const hashes = new Map();
export const sha256Of = async (file) => {
	const s = await stat(file);
	const key = `${file}\n${s.size}\n${s.mtimeMs}`;
	if (!hashes.has(key)) {
		const hash = createHash("sha256");
		await pipeline(createReadStream(file), hash);
		hashes.set(key, hash.digest("hex"));
	}
	return hashes.get(key);
};

/** {present, size, modifiedOn, sha256} of a model file, {present: false} without one */
export const fileInfo = async (file) => {
	try {
		const s = await stat(file);
		return { present: true, size: s.size, modifiedOn: s.mtime.toISOString(), sha256: await sha256Of(file) };
	} catch {
		return { present: false };
	}
};

/** the model for the package of the nodes: {sha256, size}, or null (the model of the image) */
export const modelRef = async () => {
	const info = await fileInfo(MODEL_FILE);
	return info.present ? { sha256: info.sha256, size: info.size } : null;
};
