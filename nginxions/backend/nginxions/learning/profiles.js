// Learning profiles (docs/ROADMAP.md, phase 15, step 15.5): "put a trained one". A profile is what the agent learned
// for chosen sites, taken from the learned state now or from a snapshot, signed with the key of this server and kept
// in its data volume (/data/nginxions/learning/profiles). It is
//   - applied here: the learned files of its sites replace those of this server (a snapshot of the state before is
//     taken first, the agent restarts, as a restore of a snapshot);
//   - downloaded and uploaded on another NginxionS (a closed network too): the signature is checked, the key that
//     signed it is shown;
//   - given to new nodes: one profile of a manager is "for new nodes"; its id is in the package of every node, a node
//     fetches it once and fills the sites it has learned nothing of yet (what it learned itself is never replaced),
//     then learns on together with the others (step 15.4).
// The pure part (the form, the signature, the merge): profile-model.js.
// RBAC: who sees learning sees the profiles; who labels takes and downloads them; apply, upload and delete also need
// waf_policy:manage (they change what the WAF blocks), the profile for new nodes waf_learning:sync.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import db from "../../db.js";
import internalAuditLog from "../../internal/audit-log.js";
import errs from "../../lib/error.js";
import { global as logger } from "../../logger.js";
import control from "../control/client.js";
import { checkSnapshot, LearningError, MAX_SNAPSHOT_BYTES } from "../control/learning.js";
import { signingKey } from "../nodes/package.js";
import { assetsOf } from "./model.js";
import {
	assetsOfFiles,
	assetsToFill,
	cleanName,
	filesOfAssets,
	fingerprintOf,
	mergeLearned,
	openProfile,
	signProfile,
} from "./profile-model.js";
import { listProfiles, PROFILE_DIR, PROFILE_ID, profileBytes } from "./profile-store.js";
import { loadSnapshot, summaryOf, takeSnapshot } from "./snapshots.js";

const ID = PROFILE_ID;

const fileOf = (id, ext) => {
	if (!ID.test(String(id))) throw new errs.ValidationError("invalid profile id");
	return path.join(PROFILE_DIR, `${id}.${ext}`);
};

const writeAtomic = async (file, content) => {
	const tmp = `${file}.tmp`;
	await writeFile(tmp, content, { mode: 0o600 });
	await rename(tmp, file);
};

const parseJson = (value, fallback) => {
	if (typeof value !== "string") return value ?? fallback;
	try {
		return JSON.parse(value);
	} catch {
		return fallback;
	}
};

/** the content of a profile file (gzip JSON), checked; the key of this server says whether it is our own */
export const readProfile = async (bytes) => {
	let envelope;
	try {
		envelope = JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_SNAPSHOT_BYTES * 2 }).toString("utf8"));
	} catch {
		throw new errs.ValidationError("not a learning profile of NginxionS");
	}
	let opened;
	try {
		opened = openProfile(envelope, (await signingKey()).publicKeyPem);
	} catch (err) {
		throw new errs.ValidationError(err.message);
	}
	try {
		// the same rules as a snapshot: assets inside the data folder of the agent, learned files only, sizes in bounds
		checkSnapshot({ files: opened.content.files }, "/etc/cp/conf/waap");
	} catch (err) {
		if (err instanceof LearningError) throw new errs.ValidationError(`the profile: ${err.message}`);
		throw err;
	}
	return { ...opened, envelope };
};

/** the meta of a profile from its content */
const metaOf = (id, opened, extra) => ({
	id,
	name: opened.content.name,
	createdOn: opened.content.createdOn,
	source: opened.content.source ?? null,
	sites: opened.content.sites ?? [],
	assets: opened.content.summary ?? [],
	files: opened.content.files.length,
	version: opened.version,
	fingerprint: opened.fingerprint,
	own: opened.own,
	forNewNodes: false,
	appliedOn: null,
	...extra,
});

const keep = async (envelope, meta) => {
	const payload = gzipSync(JSON.stringify(envelope));
	await mkdir(PROFILE_DIR, { recursive: true, mode: 0o700 });
	await writeAtomic(fileOf(meta.id, "json.gz"), payload);
	await writeAtomic(fileOf(meta.id, "meta.json"), JSON.stringify({ ...meta, size: payload.length }));
	return { ...meta, size: payload.length };
};

const loadMeta = async (id) => {
	try {
		return JSON.parse(await readFile(fileOf(id, "meta.json"), "utf8"));
	} catch (err) {
		if (err.code === "ENOENT") throw new errs.ItemNotFoundError(id);
		throw err;
	}
};

const saveMeta = (meta) => writeAtomic(fileOf(meta.id, "meta.json"), JSON.stringify(meta));

/** the proxy hosts (all, or these ids) as sites: [{id, domains, assets}] */
const sitesOf = async (hostIds = null) => {
	let query = db()("proxy_host").where({ is_deleted: 0 }).select("id", "domain_names");
	if (hostIds) query = query.whereIn("id", hostIds);
	const hosts = await query.orderBy("id");
	const locations = hosts.length
		? await db()("nginxions_waf_location")
				.whereIn(
					"proxy_host_id",
					hosts.map((h) => h.id),
				)
				.select("proxy_host_id", "path")
		: [];
	return hosts.map((h) => {
		const domains = parseJson(h.domain_names, []).map((d) => String(d).toLowerCase());
		const paths = locations.filter((l) => l.proxy_host_id === h.id).map((l) => l.path);
		return { id: h.id, domains, assets: assetsOf(domains, paths) };
	});
};

/**
 * The learned state of this server with the files of a profile in place of those of its assets; null: nothing to fill.
 * @param {object} content  an opened profile
 * @param {{onlyNew?: boolean, wanted?: string[]|null}} opts
 */
const mergedState = async (content, opts) => {
	const current = (await control.snapshotAgentLearning()).files ?? [];
	const assets = assetsToFill(assetsOfFiles(content.files), current, opts);
	if (!assets.length) return null;
	return { assets, current, files: mergeLearned(current, content.files, assets) };
};

/** the merged state in place of the learned one: a snapshot of the state before first, then the agent restarts */
const restoreMerged = async (merged, userId) => {
	const before = merged.current.length ? await takeSnapshot("before-restore", userId) : null;
	await control.restoreAgentLearning({ files: merged.files }, userId);
	return before?.id ?? null;
};

/**
 * On a node: the profile for new nodes its manager gives (step 15.5). Signed by the manager (the key the node pinned),
 * it fills the sites of this server it has learned nothing of yet.
 * @param {Buffer} bytes  the profile file
 * @param {string} managerKeyPem  the pinned key of the manager
 * @returns {Promise<{assets: string[], before: string|null}>}
 */
export const applyFromManager = async (bytes, managerKeyPem) => {
	const opened = await readProfile(bytes);
	if (opened.fingerprint !== fingerprintOf(managerKeyPem)) {
		throw new Error("the profile is not signed by the manager of this node");
	}
	const wanted = (await sitesOf()).flatMap((s) => s.assets);
	const merged = await mergedState(opened.content, { onlyNew: true, wanted });
	if (!merged) return { assets: [], before: null };
	const before = await restoreMerged(merged, 0);
	logger.info(`Cluster: the learning profile "${opened.content.name}" filled ${merged.assets.length} site(s)`);
	return { assets: merged.assets, before };
};

// ------------------------------------------------------------------ API
const audit = (access, meta) =>
	internalAuditLog.add(access, { action: "updated", object_type: "waf_learning", meta: { profile: meta } });

const canManage = async (access) => {
	await access.can("waf_learning:label");
	await access.can("waf_policy:manage");
};

const internalLearningProfiles = {
	/** @param {Access} access */
	list: async (access) => {
		await access.can("waf_learning:view");
		const key = await signingKey();
		return { profiles: await listProfiles(), fingerprint: fingerprintOf(key.publicKeyPem) };
	},

	/**
	 * A profile of the sites given, from what the agent learned now or from a snapshot.
	 * @param {Access} access
	 * @param {{name: string, host_ids: number[], snapshot_id?: string}} data
	 */
	create: async (access, data) => {
		await access.can("waf_learning:label");
		const name = cleanName(data.name);
		if (!name) throw new errs.ValidationError("The name of the profile: letters, digits, spaces, . _ ( ) + -");
		const hostIds = [...new Set(data.host_ids ?? [])];
		if (!hostIds.length) throw new errs.ValidationError("Choose the sites of the profile");
		const sites = await sitesOf(hostIds);
		if (sites.length !== hostIds.length) throw new errs.ValidationError("A site of the profile does not exist");
		const snapshotId = data.snapshot_id ? String(data.snapshot_id) : null;
		const all = snapshotId ? (await loadSnapshot(snapshotId)).files : (await control.snapshotAgentLearning()).files;
		const files = filesOfAssets(
			all ?? [],
			sites.flatMap((s) => s.assets),
		).map((f) => ({ asset: f.asset, name: f.name, modifiedAt: f.modifiedAt ?? null, content: f.content }));
		if (!files.length) throw new errs.ValidationError("The agent has learned nothing of these sites yet");
		const key = await signingKey();
		const envelope = signProfile(
			{
				name,
				createdOn: new Date().toISOString(),
				source: { server: hostname().slice(0, 100), snapshot: snapshotId },
				sites: sites.map((s) => ({ domains: s.domains })),
				summary: summaryOf(files),
				files,
			},
			key,
		);
		const opened = { content: JSON.parse(envelope.body), version: envelope.version };
		const meta = await keep(
			envelope,
			metaOf(`p-${randomBytes(6).toString("hex")}`, opened, {
				fingerprint: fingerprintOf(key.publicKeyPem),
				own: true,
				origin: "taken",
				userId: access.token.getUserId(0),
			}),
		);
		await audit(access, { action: "created", id: meta.id, name });
		return meta;
	},

	/**
	 * A profile file of this or another NginxionS: its signature is checked, it is kept (applied separately).
	 * @param {Access} access
	 * @param {Buffer|null} content
	 */
	upload: async (access, content) => {
		await canManage(access);
		if (!content?.length) throw new errs.ValidationError("no file");
		const opened = await readProfile(content);
		const known = (await listProfiles()).find((m) => m.version === opened.version);
		if (known) throw new errs.ValidationError(`This profile is here already: ${known.name}`);
		const meta = await keep(
			opened.envelope,
			metaOf(`p-${randomBytes(6).toString("hex")}`, opened, {
				origin: "import",
				userId: access.token.getUserId(0),
			}),
		);
		await audit(access, { action: "uploaded", id: meta.id, fingerprint: meta.fingerprint });
		return meta;
	},

	/**
	 * The profile in place of the learned state of its sites here (all of them, or the sites of these hosts).
	 * @param {Access} access
	 * @param {string} id
	 * @param {{host_ids?: number[]}} [data]
	 */
	apply: async (access, id, data = {}) => {
		await canManage(access);
		const meta = await loadMeta(id);
		const opened = await readProfile(await profileBytes(id));
		const wanted = data.host_ids?.length ? (await sitesOf(data.host_ids)).flatMap((s) => s.assets) : null;
		const merged = await mergedState(opened.content, { wanted });
		if (!merged) throw new errs.ValidationError("The profile has nothing of these sites");
		const before = await restoreMerged(merged, access.token.getUserId(0));
		await saveMeta({ ...meta, appliedOn: new Date().toISOString() });
		await audit(access, { action: "applied", id, assets: merged.assets.length, before });
		return { applied: id, assets: merged.assets, before, restarting: true };
	},

	/**
	 * The profile new nodes get (one at a time), or none.
	 * @param {Access} access
	 * @param {string} id
	 * @param {boolean} on
	 */
	setForNewNodes: async (access, id, on) => {
		await access.can("waf_learning:sync");
		const meta = await loadMeta(id);
		for (const other of await listProfiles()) {
			if (other.forNewNodes && other.id !== id) await saveMeta({ ...other, forNewNodes: false });
		}
		const next = { ...meta, forNewNodes: Boolean(on) };
		await saveMeta(next);
		await audit(access, { action: on ? "for-new-nodes" : "not-for-new-nodes", id });
		return next;
	},

	/**
	 * @param {Access} access
	 * @param {string} id
	 */
	download: async (access, id) => {
		await access.can("waf_learning:label");
		const meta = await loadMeta(id);
		await audit(access, { action: "downloaded", id });
		const safe = meta.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 60);
		return { name: `nginxions-profile-${safe}-${id}.json.gz`, content: await profileBytes(id) };
	},

	/**
	 * @param {Access} access
	 * @param {string} id
	 */
	remove: async (access, id) => {
		await canManage(access);
		await loadMeta(id);
		await rm(fileOf(id, "json.gz"), { force: true });
		await rm(fileOf(id, "meta.json"), { force: true });
		await audit(access, { action: "deleted", id });
		return true;
	},
};

export default internalLearningProfiles;
