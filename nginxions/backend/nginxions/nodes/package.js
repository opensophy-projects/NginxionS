// The package of configuration of a node, made on its manager (docs/ROADMAP.md, phase 15, step 15.2;
// docs/adr/0012-nodes.md): the proxy hosts given to the node in "Agents → Nodes", the certificates and access lists
// they use, their WAF modes. Signed with the Ed25519 key of the manager (made on first use in the data volume, its
// public key given to the node at its registration and pinned there); the version is the SHA-256 of the content, so
// a node fetches it again only when something changed.
// What a node cannot serve on its own is left out and told: a certificate of ACME (its renewal is on the manager).
import { generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import db from "../../db.js";
import { accessListIdsOf, PACKAGE_SCHEMA, signPackage } from "./package-model.js";

export const SIGNING_KEY_FILE = process.env.NGINXIONS_SIGNING_KEY_FILE || "/data/nginxions/cluster/manager-signing.key";

const JSON_COLUMNS = {
	proxy_host: ["domain_names", "meta", "locations", "npmplus_access_list_ids"],
	certificate: ["domain_names", "meta"],
	access_list: ["meta"],
	access_list_auth: ["meta"],
	access_list_client: ["meta"],
};
/** columns a node sets itself: never copied */
const LOCAL_COLUMNS = ["owner_user_id", "created_on", "modified_on"];

const parsed = (table, row) => {
	const out = { ...row };
	for (const column of JSON_COLUMNS[table] ?? []) {
		if (typeof out[column] === "string") {
			try {
				out[column] = JSON.parse(out[column]);
			} catch {
				out[column] = null;
			}
		}
	}
	for (const column of LOCAL_COLUMNS) delete out[column];
	for (const [k, v] of Object.entries(out)) if (v instanceof Date) out[k] = v.toISOString();
	return out;
};

let keyPromise = null;
/** the signing key of this manager, made on first use */
export const signingKey = () => {
	keyPromise ??= (async () => {
		let pem;
		try {
			pem = await readFile(SIGNING_KEY_FILE, "utf8");
		} catch {
			const { privateKey } = generateKeyPairSync("ed25519");
			pem = privateKey.export({ type: "pkcs8", format: "pem" });
			await mkdir(path.dirname(SIGNING_KEY_FILE), { recursive: true, mode: 0o700 });
			await writeFile(SIGNING_KEY_FILE, pem, { mode: 0o600, flag: "wx" }).catch(async (err) => {
				// another start made it at the same moment: take that one
				if (err.code !== "EEXIST") throw err;
				pem = await readFile(SIGNING_KEY_FILE, "utf8");
			});
		}
		const privateKey = createPrivateKey(pem);
		return {
			privateKey,
			publicKeyPem: createPublicKey(privateKey).export({ type: "spki", format: "pem" }),
		};
	})();
	keyPromise.catch(() => {
		keyPromise = null;
	});
	return keyPromise;
};

/** the proxy hosts of a node (ids of this manager) */
export const hostIdsOf = async (nodeId) =>
	(await db()("nginxions_node_host").where({ node_id: nodeId }).orderBy("proxy_host_id")).map((r) => r.proxy_host_id);

/** the content of the package of a node */
export const contentOf = async (nodeId) => {
	const hostIds = await hostIdsOf(nodeId);
	const hosts = hostIds.length
		? (await db()("proxy_host").whereIn("id", hostIds).where({ is_deleted: 0 }).orderBy("id")).map((r) =>
				parsed("proxy_host", r),
			)
		: [];
	const skipped = [];
	// certificates: the ones with their files in the database (own and PKI); ACME ones renew on the manager
	const certIds = [...new Set(hosts.map((h) => h.certificate_id).filter((id) => Number.isInteger(id) && id > 0))];
	const certRows = certIds.length
		? await db()("certificate").whereIn("id", certIds).where({ is_deleted: 0 }).orderBy("id")
		: [];
	const certificates = [];
	for (const row of certRows.map((r) => parsed("certificate", r))) {
		if (row.provider === "other" && row.meta?.certificate && row.meta?.certificate_key) certificates.push(row);
		else skipped.push({ kind: "certificate", id: row.id, name: row.nice_name, reason: row.provider });
	}
	const listIds = [...new Set(hosts.flatMap(accessListIdsOf))].sort((a, b) => a - b);
	const accessLists = listIds.length
		? (await db()("access_list").whereIn("id", listIds).where({ is_deleted: 0 }).orderBy("id")).map((r) =>
				parsed("access_list", r),
			)
		: [];
	const found = accessLists.map((l) => l.id);
	const auth = found.length
		? (await db()("access_list_auth").whereIn("access_list_id", found).orderBy("id")).map((r) =>
				parsed("access_list_auth", r),
			)
		: [];
	const clients = found.length
		? (await db()("access_list_client").whereIn("access_list_id", found).orderBy("id")).map((r) =>
				parsed("access_list_client", r),
			)
		: [];
	const found_hosts = hosts.map((h) => h.id);
	const strip = (row) => {
		const { modified_on: _m, ...rest } = row;
		return rest;
	};
	const wafHosts = found_hosts.length
		? (await db()("nginxions_waf_host").whereIn("proxy_host_id", found_hosts).orderBy("proxy_host_id")).map(strip)
		: [];
	const wafLocations = found_hosts.length
		? (await db()("nginxions_waf_location").whereIn("proxy_host_id", found_hosts).orderBy("id")).map((r) => {
				const { id: _id, ...rest } = strip(r);
				return rest;
			})
		: [];
	return {
		schema: PACKAGE_SCHEMA,
		hosts,
		certificates,
		access_lists: accessLists.map((l) => ({
			...l,
			items: auth.filter((a) => a.access_list_id === l.id).map(({ id: _id, access_list_id: _a, ...a }) => a),
			clients: clients.filter((c) => c.access_list_id === l.id).map(({ id: _id, access_list_id: _a, ...c }) => c),
		})),
		waf_hosts: wafHosts,
		waf_locations: wafLocations,
		skipped,
	};
};

/** the signed package of a node */
export const packageOf = async (nodeId) => signPackage(await contentOf(nodeId), (await signingKey()).privateKey);
