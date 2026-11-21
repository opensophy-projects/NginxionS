// Learning profiles (step 15.5): the signature, which learned files a profile takes, how it merges on a server.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, test } from "node:test";
import { signPackage } from "../nodes/package-model.js";
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

const realKey = () => {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	return { privateKey, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
};
const file = (asset, name = "5.data", content = "AA==") => ({ asset, name, content });

describe("learning profiles", () => {
	test("a profile is signed with the key of its server and opened with the key inside it", () => {
		const key = realKey();
		const envelope = signProfile({ name: "shop", files: [file("shop.example")] }, key);
		const opened = openProfile(envelope, key.publicKeyPem);
		assert.equal(opened.content.name, "shop");
		assert.equal(opened.own, true);
		assert.equal(opened.fingerprint, fingerprintOf(key.publicKeyPem));
		assert.match(opened.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
		// imported: signed by another server
		assert.equal(openProfile(envelope, realKey().publicKeyPem).own, false);
	});

	test("a changed profile, another key or another form are refused", () => {
		const key = realKey();
		const envelope = signProfile({ name: "shop", files: [file("shop.example")] }, key);
		const body = JSON.parse(envelope.body);
		body.files[0].content = "BB==";
		assert.throws(() => openProfile({ ...envelope, body: JSON.stringify(body) }), /damaged or its signature/);
		// the key inside replaced: the signature is not of it
		assert.throws(() => openProfile({ ...envelope, publicKey: realKey().publicKeyPem }), /signature/);
		assert.throws(() => openProfile({ ...envelope, publicKey: undefined }), /not a learning profile/);
		assert.throws(() => openProfile(null), /not a learning profile/);
		// a package of a node, signed by the same key, is not a profile
		const pkg = { ...signPackage({ hosts: [], files: [] }, key.privateKey), publicKey: key.publicKeyPem };
		assert.throws(() => openProfile(pkg), /not a learning profile/);
	});

	test("the files of the assets of chosen sites, locations included", () => {
		const files = [file("shop.example"), file("shop.example/api"), file("blog.example"), file("shop.example.org")];
		assert.deepEqual(
			filesOfAssets(files, ["shop.example"]).map((f) => f.asset),
			["shop.example", "shop.example/api"],
		);
		assert.deepEqual(assetsOfFiles(files), ["blog.example", "shop.example", "shop.example.org"]);
	});

	test("a new node fills only the sites it has learned nothing of, and only its own sites", () => {
		const local = [file("shop.example/api")];
		assert.deepEqual(assetsToFill(["shop.example", "blog.example"], local), ["shop.example", "blog.example"]);
		assert.deepEqual(assetsToFill(["shop.example", "blog.example"], local, { onlyNew: true }), ["blog.example"]);
		assert.deepEqual(assetsToFill(["shop.example", "blog.example"], [], { wanted: ["blog.example"] }), [
			"blog.example",
		]);
		assert.deepEqual(assetsToFill(["shop.example"], [], { wanted: [] }), []);
	});

	test("merge: the files of the filled assets are replaced, the others stay", () => {
		const current = [file("shop.example", "5.data", "OLD"), file("shop.example/api"), file("blog.example")];
		const profile = [file("shop.example", "5.data", "NEW"), file("shop.example", "4.data"), file("other.example")];
		const merged = mergeLearned(current, profile, ["shop.example"]);
		assert.deepEqual(
			merged.map((f) => `${f.asset}/${f.name}=${f.content}`).sort(),
			["blog.example/5.data=AA==", "shop.example/4.data=AA==", "shop.example/5.data=NEW"],
			"the location of the site goes too: the profile is the whole site; other.example is not filled",
		);
	});

	test("names", () => {
		assert.equal(cleanName("  Shop (prod) 2026.11  "), "Shop (prod) 2026.11");
		assert.equal(cleanName("Магазин"), "Магазин");
		assert.equal(cleanName(""), null);
		assert.equal(cleanName("a/b"), null);
		assert.equal(cleanName("x".repeat(101)), null);
	});
});
