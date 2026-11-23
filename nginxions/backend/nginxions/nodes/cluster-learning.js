// The state of the learning of several servers put together by smartsync on a manager (step 15.4,
// docs/adr/0012-nodes.md 5c): the files smartsync writes in the shared storage (<asset>/<type>/remote/...). A snapshot
// of learning on a manager keeps them too (learning/snapshots.js), and restoring it puts them back: a poisoned norm
// of the nodes is rolled back with the norm of this server.
import { cleanStoragePath } from "./learning-model.js";

const STORAGE_URL = process.env.NGINXIONS_APPSEC_STORAGE_URL || "http://127.0.0.1:7811";
const TIMEOUT_MS = 30000;
/** the most a snapshot keeps of the state of the cluster */
export const MAX_CLUSTER_BYTES = 64 * 1024 * 1024;

const headers = { "X-Tenant-Id": "local", "X-Correlation-Id": "nginxions-snapshot" };

/** a file of the state put together: under remote/ of an asset, a clean path */
export const isClusterStatePath = (file) => {
	const clean = cleanStoragePath(file);
	return clean !== null && clean === file && /^\/[^/]+\/.+\/remote\/[^/]+$/.test(file);
};

const xmlEscapes = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&#34;": '"', "&#39;": "'" };
const storageKey = (key) => {
	const decoded = key.replace(/&(?:amp|lt|gt|#34|#39);/g, (entity) => xmlEscapes[entity]);
	return decoded.startsWith("/") ? decoded : `/${decoded}`;
};

const storageFileUrl = (file) => `${STORAGE_URL}/api${file.split("/").map(encodeURIComponent).join("/")}`;

const readStorageListing = async () => {
	const list = await fetch(`${STORAGE_URL}/api/?list-type=2&prefix=/`, {
		headers,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!list.ok) throw new Error(`the shared storage answered ${list.status} to its listing`);
	return list.text();
};

/** the keys of a listing of the storage (ListBucketResult) */
export const keysOfListing = (xml) =>
	[...String(xml).matchAll(/<Key>([^<]{1,1024})<\/Key>/g)].map((m) => storageKey(m[1]));

/**
 * The files of the state put together by smartsync, from the storage of this server.
 * @returns {Promise<{path: string, content: string}[]>} content in base64
 */
export const readClusterState = async () => {
	const files = [];
	let size = 0;
	for (const file of keysOfListing(await readStorageListing()).filter(isClusterStatePath)) {
		const res = await fetch(storageFileUrl(file), { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (res.status === 404) continue;
		if (!res.ok) throw new Error(`the shared storage answered ${res.status} to ${file}`);
		const content = Buffer.from(await res.arrayBuffer());
		size += content.length;
		if (size > MAX_CLUSTER_BYTES) throw new Error("the state of the cluster is larger than a snapshot keeps");
		files.push({ path: file, content: content.toString("base64") });
	}
	return files;
};

/** Replaces the merged state with the snapshot, leaving learning windows and other storage data in place. */
export const restoreClusterState = async (files) => {
	const retained = new Set();
	for (const { path } of files) {
		if (!isClusterStatePath(path)) throw new Error(`not a file of the state of the cluster: ${path}`);
		retained.add(path);
	}
	const stale = keysOfListing(await readStorageListing()).filter(
		(file) => isClusterStatePath(file) && !retained.has(file),
	);
	for (const f of files) {
		const res = await fetch(storageFileUrl(f.path), {
			method: "PUT",
			headers: { ...headers, "Content-Type": "application/octet-stream" },
			body: Buffer.from(f.content, "base64"),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok) throw new Error(`the shared storage answered ${res.status} to ${f.path}`);
	}
	for (const file of stale) {
		const res = await fetch(storageFileUrl(file), {
			method: "DELETE",
			headers,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok && res.status !== 404)
			throw new Error(`the shared storage answered ${res.status} to delete ${file}`);
	}
	return files.length;
};

// ---------------------------------------------------------------------------- the learning of the cluster (15.6)
// What the shared storage of a manager shows of the learning of each site: the data of windows each node sent (under
// its id, nodes/learning-model.js), those of the agent of this server, and when smartsync last put them together
// (the files under remote/). Shown in "Agents → Nodes → Learning of the cluster".

/** the entries of a listing of the storage: [{key, modified}] (modified: ISO time or null) */
export const entriesOfListing = (xml) =>
	[...String(xml).matchAll(/<Contents>([\s\S]{0,4096}?)<\/Contents>/g)].map((m) => {
		const key = /<Key>([^<]{1,1024})<\/Key>/.exec(m[1])?.[1] ?? "";
		const modified = /<LastModified>([^<]{1,64})<\/LastModified>/.exec(m[1])?.[1] ?? null;
		return { key: storageKey(key), modified };
	});

const WINDOW_FILE = /^\/([^/]+)\/(.+)\/window_\d{1,6}(?:_\d{1,6})?\/([^/]+)(?:\/.+)?\/data\.data\d{0,6}$/;
const MERGED_FILE = /^\/([^/]+)\/(.+)\/remote\/[^/]+$/;

const later = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * The learning of each asset of the cluster from the entries of the storage.
 * @param {{key: string, modified: string|null}[]} entries
 * @param {{uid: string, name: string}[]} nodes  the nodes of this manager
 * @returns {{asset: string, local: {windows: number, lastOn: string|null},
 *   nodes: {uid: string, name: string, windows: number, lastOn: string|null}[], mergedOn: string|null}[]}
 */
export const clusterLearningOf = (entries, nodes) => {
	const names = new Map(nodes.map((n) => [n.uid, n.name]));
	const assets = new Map();
	const assetOf = (asset) => {
		if (!assets.has(asset)) {
			assets.set(asset, { asset, local: { windows: 0, lastOn: null }, nodes: new Map(), mergedOn: null });
		}
		return assets.get(asset);
	};
	for (const { key, modified } of entries) {
		const merged = MERGED_FILE.exec(key);
		if (merged) {
			const a = assetOf(merged[1]);
			a.mergedOn = later(a.mergedOn, modified);
			continue;
		}
		const window = WINDOW_FILE.exec(key);
		if (!window) continue;
		const a = assetOf(window[1]);
		const owner = window[3];
		// a node writes under its id; anything else is an agent of this server
		const slot = names.has(owner)
			? (a.nodes.get(owner) ??
				a.nodes.set(owner, { uid: owner, name: names.get(owner), windows: 0, lastOn: null }).get(owner))
			: a.local;
		slot.windows += 1;
		slot.lastOn = later(slot.lastOn, modified);
	}
	return [...assets.values()]
		.map((a) => ({ ...a, nodes: [...a.nodes.values()].sort((x, y) => x.name.localeCompare(y.name)) }))
		.sort((x, y) => x.asset.localeCompare(y.asset));
};

/** the learning of the cluster as the storage of this server shows it */
export const readClusterLearning = async (nodes) =>
	clusterLearningOf(entriesOfListing(await readStorageListing()), nodes);
