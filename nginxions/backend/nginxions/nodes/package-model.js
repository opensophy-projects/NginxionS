// The package of configuration a manager gives a node (docs/ROADMAP.md, phase 15, step 15.2; docs/adr/0012-nodes.md):
// the pure part. No database, no network: the canonical form (the same content is the same bytes, so the same
// version), the signature with the Ed25519 key of the manager, and the ids of the manager turned into the ids of the
// node (certificates, access lists, hosts).
import { createHash, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";

/** the form of the package; a node refuses another one */
export const PACKAGE_SCHEMA = 1;

/** JSON with the keys of every object sorted: one content, one string */
export const canonical = (value) => {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object" && !(value instanceof Date)) {
		return `{${Object.keys(value)
			.filter((k) => value[k] !== undefined)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value instanceof Date ? value.toISOString() : value);
};

/** the version of a content: its SHA-256 */
export const versionOf = (content) => createHash("sha256").update(canonical(content)).digest("hex");

/** a signed package: the content as a string, its version and the signature of both */
export const signPackage = (content, privateKey) => {
	const body = canonical(content);
	const version = createHash("sha256").update(body).digest("hex");
	const signature = cryptoSign(null, Buffer.from(`${version}\n${body}`), privateKey).toString("base64");
	return { schema: PACKAGE_SCHEMA, version, body, signature };
};

/**
 * The content of a signed package, or an error: another schema, a version that is not of its body, a signature
 * that is not of the key the node pinned.
 * @param {{schema, version, body, signature}} envelope
 * @param {string} publicKeyPem  the key of the manager the node pinned
 */
export const openPackage = (envelope, publicKeyPem) => {
	if (!envelope || envelope.schema !== PACKAGE_SCHEMA) throw new Error("unknown form of package");
	if (typeof envelope.body !== "string" || typeof envelope.signature !== "string") throw new Error("broken package");
	const version = createHash("sha256").update(envelope.body).digest("hex");
	if (version !== envelope.version) throw new Error("the version is not the one of the content");
	const ok = cryptoVerify(
		null,
		Buffer.from(`${envelope.version}\n${envelope.body}`),
		createPublicKey(publicKeyPem),
		Buffer.from(envelope.signature, "base64"),
	);
	if (!ok) throw new Error("the signature is not the one of the manager");
	return JSON.parse(envelope.body);
};

const ids = (list) => (Array.isArray(list) ? list.filter((id) => Number.isInteger(id) && id > 0) : []);

/** the access lists a proxy host uses: its own, the custom ones and those of its locations */
export const accessListIdsOf = (host) => {
	const out = new Set();
	if (Number.isInteger(host.access_list_id) && host.access_list_id > 0) out.add(host.access_list_id);
	for (const id of ids(host.npmplus_access_list_ids)) out.add(id);
	for (const location of Array.isArray(host.locations) ? host.locations : []) {
		for (const id of ids(location?.npmplus_access_list_ids)) out.add(id);
		if (Number.isInteger(location?.access_list_id) && location.access_list_id > 0) out.add(location.access_list_id);
	}
	return [...out].sort((a, b) => a - b);
};

/**
 * A proxy host of the manager with the ids of the node: its certificate and its access lists; one the node does not
 * have becomes 0 (none) and the host is told so.
 * @param {object} host  the row of the manager (JSON columns parsed)
 * @param {{certificates: Map<number, number>, accessLists: Map<number, number>}} maps  manager id → node id
 * @returns {{row: object, missing: string[]}}
 */
export const remapHost = (host, maps) => {
	const missing = [];
	const accessList = (id) => {
		if (!(Number.isInteger(id) && id > 0)) return id;
		const local = maps.accessLists.get(id);
		if (!local) missing.push(`access list ${id}`);
		return local ?? 0;
	};
	const accessLists = (list) =>
		ids(list)
			.map(accessList)
			.filter((id) => id > 0);
	let certificateId = host.certificate_id;
	if (Number.isInteger(certificateId) && certificateId > 0) {
		certificateId = maps.certificates.get(certificateId) ?? 0;
		if (!certificateId) missing.push(`certificate ${host.certificate_id}`);
	}
	const row = {
		...host,
		certificate_id: certificateId,
		access_list_id: accessList(host.access_list_id) ?? 0,
		npmplus_access_list_ids: accessLists(host.npmplus_access_list_ids),
		locations: (Array.isArray(host.locations) ? host.locations : []).map((location) => ({
			...location,
			...(location?.npmplus_access_list_ids !== undefined
				? { npmplus_access_list_ids: accessLists(location.npmplus_access_list_ids) }
				: {}),
			...(location?.access_list_id !== undefined ? { access_list_id: accessList(location.access_list_id) } : {}),
		})),
	};
	return { row, missing };
};

/** the domains a host serves, lowercase */
export const domainsOf = (host) =>
	(Array.isArray(host.domain_names) ? host.domain_names : []).map((d) => String(d).toLowerCase());
