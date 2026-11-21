// Learning profiles (docs/ROADMAP.md, phase 15, step 15.5): the pure part. A profile is what the agent learned for
// some sites (the learned files of their assets, the format of a snapshot of learning), with where and when it was
// taken, signed with the Ed25519 key of the server that made it (the key of packages of a manager, nodes/package.js).
// It is applied on this server or on another one (a file, closed networks included), and a new node gets the profile
// of its sites from its manager: it starts with the norm of the cluster instead of learning from nothing.
// No files, no network here: the content, its signature, which learned files it takes and how they merge.
import { createHash, createPublicKey } from "node:crypto";
import { learnedFolders } from "./model.js";
import { openPackage, signPackage } from "../nodes/package-model.js";

export const PROFILE_FORMAT = "nginxions-learning-profile";
export const PROFILE_VERSION = 1;
const NAME = /^[\p{L}\p{N} ._()+-]{1,100}$/u;

/** the fingerprint of a public key (SHA-256 of its DER), as hex in pairs: what the GUI shows of the signer */
export const fingerprintOf = (publicKeyPem) =>
	createHash("sha256")
		.update(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }))
		.digest("hex")
		.toUpperCase()
		.match(/../g)
		.join(":");

/** a name of a profile, trimmed; null when it is not one */
export const cleanName = (name) => {
	const clean = String(name ?? "").trim();
	return NAME.test(clean) ? clean : null;
};

/**
 * The learned files of some assets: the files of each asset and of its instances below it (a location).
 * @param {{asset: string}[]} files
 * @param {string[]} assets
 */
export const filesOfAssets = (files, assets) => learnedFolders(assets, files);

/**
 * The assets a profile fills on a server: all of them, or (a new node: onlyNew) those this server has learned
 * nothing of yet: what it learned itself is never overwritten.
 * @param {string[]} profileAssets
 * @param {{asset: string}[]} localFiles  the learned files of this server
 * @param {{onlyNew?: boolean, wanted?: string[]|null}} [opts]  wanted: only the assets of these sites
 */
export const assetsToFill = (profileAssets, localFiles, { onlyNew = false, wanted = null } = {}) => {
	const local = new Set(localFiles.map((f) => f.asset));
	return profileAssets.filter((asset) => {
		if (wanted && !wanted.some((w) => asset === w || asset.startsWith(`${w}/`))) return false;
		if (!onlyNew) return true;
		return ![...local].some((l) => l === asset || l.startsWith(`${asset}/`));
	});
};

/**
 * The learned state after a profile: the files of this server, the assets the profile fills replaced by its files.
 * @param {{asset: string, name: string}[]} current
 * @param {{asset: string, name: string}[]} profileFiles
 * @param {string[]} assets  the assets filled (assetsToFill)
 */
export const mergeLearned = (current, profileFiles, assets) => {
	const covered = (f) => assets.some((a) => f.asset === a || f.asset.startsWith(`${a}/`));
	return [...current.filter((f) => !covered(f)), ...profileFiles.filter(covered)];
};

/** the assets of a profile: the top folders of its files (an asset of a location is below the one of its host) */
export const assetsOfFiles = (files) => {
	const all = [...new Set(files.map((f) => f.asset))].sort();
	return all.filter((a) => !all.some((b) => b !== a && a.startsWith(`${b}/`)));
};

/**
 * A signed profile: the envelope of a package of a manager, with the public key that checks it.
 * @param {object} content  {name, createdOn, source, sites, assets, files}
 * @param {{privateKey, publicKeyPem: string}} key
 */
export const signProfile = (content, key) => ({
	...signPackage({ format: PROFILE_FORMAT, version: PROFILE_VERSION, ...content }, key.privateKey),
	publicKey: key.publicKeyPem,
});

/**
 * The content of a profile file, checked: its form, the signature of the key inside it.
 * @param {any} envelope  the parsed file
 * @param {string} [ownKeyPem]  the key of this server: own (made here) or imported
 * @returns {{content: object, fingerprint: string, own: boolean, version: string}}
 */
export const openProfile = (envelope, ownKeyPem = "") => {
	if (!envelope || typeof envelope.publicKey !== "string") throw new Error("not a learning profile of NginxionS");
	let content;
	let fingerprint;
	try {
		fingerprint = fingerprintOf(envelope.publicKey);
		content = openPackage(envelope, envelope.publicKey);
	} catch (err) {
		throw new Error(`the profile is damaged or its signature is wrong: ${err.message}`);
	}
	if (content?.format !== PROFILE_FORMAT || content.version !== PROFILE_VERSION || !Array.isArray(content.files)) {
		throw new Error("not a learning profile of NginxionS");
	}
	const own = Boolean(ownKeyPem) && fingerprintOf(ownKeyPem) === fingerprint;
	return { content, fingerprint, own, version: envelope.version };
};
