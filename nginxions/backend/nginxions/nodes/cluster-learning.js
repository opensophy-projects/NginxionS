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

/** the keys of a listing of the storage (ListBucketResult) */
export const keysOfListing = (xml) =>
	[...String(xml).matchAll(/<Key>([^<]{1,1024})<\/Key>/g)].map((m) => (m[1].startsWith("/") ? m[1] : `/${m[1]}`));

/**
 * The files of the state put together by smartsync, from the storage of this server.
 * @returns {Promise<{path: string, content: string}[]>} content in base64
 */
export const readClusterState = async () => {
	const list = await fetch(`${STORAGE_URL}/api/?list-type=2&prefix=/`, {
		headers,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!list.ok) throw new Error(`the shared storage answered ${list.status} to its listing`);
	const files = [];
	let size = 0;
	for (const file of keysOfListing(await list.text()).filter(isClusterStatePath)) {
		const res = await fetch(`${STORAGE_URL}/api${file}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (!res.ok) continue;
		const content = Buffer.from(await res.arrayBuffer());
		size += content.length;
		if (size > MAX_CLUSTER_BYTES) throw new Error("the state of the cluster is larger than a snapshot keeps");
		files.push({ path: file, content: content.toString("base64") });
	}
	return files;
};

/** the files of a snapshot back in the storage: smartsync and the agents of the nodes read them from there */
export const restoreClusterState = async (files) => {
	for (const f of files) {
		if (!isClusterStatePath(f.path)) throw new Error(`not a file of the state of the cluster: ${f.path}`);
		const res = await fetch(`${STORAGE_URL}/api${f.path}`, {
			method: "PUT",
			headers: { ...headers, "Content-Type": "application/octet-stream" },
			body: Buffer.from(f.content, "base64"),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok) throw new Error(`the shared storage answered ${res.status} to ${f.path}`);
	}
	return files.length;
};
