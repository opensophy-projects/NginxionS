// The file of the advanced model of the agent (WAF -> Agent): where it is, the one before it, its SHA-256. Kept apart
// from agent-settings.js: the package of a node (nodes/package.js) names the model of its manager by its hash.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import errs from "../../lib/error.js";
import { extract } from "../migration/tar.js";

export const MODEL_DIR = process.env.NGINXIONS_APPSEC_MODEL_DIR || "/ext/appsec-model";
export const MODEL_FILE = path.join(MODEL_DIR, "open-appsec-advanced-model.tgz");
/** the model before the last upload (or the model of the manager before the last one, on a node) */
export const PREVIOUS_FILE = `${MODEL_FILE}.previous`;
// The model in the image is about 7 MiB. Bound the inflated JSON before reading and parsing it.
const MAX_MODEL_DATA_BYTES = 128 * 1024 * 1024;
const isMapping = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const isScorePool = (pool) => Array.isArray(pool?.keyword_data) && isMapping(pool.keyword_stats);

export const validateModelArchive = async (file) => {
	const dir = await mkdtemp(path.join(path.dirname(file), ".validate-"));
	try {
		const result = await extract(file, dir, {
			gzip: true,
			accept: (name) => name === "waap.data",
			maxBytes: MAX_MODEL_DATA_BYTES,
			maxEntries: 1,
			strict: true,
		});
		if (result.files !== 1) throw new Error("waap.data is missing");
		const text = await readFile(path.join(dir, "waap.data"));
		const model = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(text));
		const signatures = model?.waap_signatures;
		const scores = model?.waap_scores;
		if (
			!isMapping(signatures) ||
			!["words_regex_list", "pattern_regex_list", "specific_acuracy_keywords_regex_list"].every((name) =>
				Array.isArray(signatures[name]),
			)
		) {
			throw new Error("waap.data must contain WAAP signatures");
		}
		const pools =
			scores?.version === 1 &&
			Array.isArray(scores.scorePools) &&
			scores.scorePools.every((pool) => typeof pool?.key === "string" && isScorePool(pool.value)) &&
			scores.scorePools.some((pool) => pool.key === "base_scores");
		const legacyPool = (scores?.version === undefined || scores.version === 0) && isScorePool(scores);
		if (!pools && !legacyPool) {
			throw new Error("waap.data must contain WAAP score pools");
		}
	} catch (err) {
		throw new errs.ValidationError(`Invalid advanced model archive: ${err.message}`);
	} finally {
		await rm(dir, { force: true, recursive: true });
	}
};

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
