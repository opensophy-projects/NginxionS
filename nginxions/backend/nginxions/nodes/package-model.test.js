import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import {
	accessListIdsOf,
	canonical,
	domainsOf,
	openPackage,
	remapHost,
	signPackage,
	versionOf,
} from "./package-model.js";

const keys = () => {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	return { privateKey, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) };
};

test("canonical form: the order of keys does not change the content or its version", () => {
	const a = { b: 1, a: [{ y: 2, x: 1 }], c: undefined, d: new Date("2026-11-20T00:00:00Z") };
	const b = { d: new Date("2026-11-20T00:00:00Z"), a: [{ x: 1, y: 2 }], b: 1 };
	assert.equal(canonical(a), canonical(b));
	assert.equal(canonical(a), '{"a":[{"x":1,"y":2}],"b":1,"d":"2026-11-20T00:00:00.000Z"}');
	assert.equal(versionOf(a), versionOf(b));
	assert.notEqual(versionOf(a), versionOf({ ...b, b: 2 }));
});

test("a signed package opens with the key of its manager only, and not once changed", () => {
	const manager = keys();
	const other = keys();
	const envelope = signPackage({ hosts: [{ id: 1 }] }, manager.privateKey);
	assert.deepEqual(openPackage(envelope, manager.publicKeyPem), { hosts: [{ id: 1 }] });
	assert.throws(() => openPackage(envelope, other.publicKeyPem), /signature/);
	const changed = { ...envelope, body: envelope.body.replace('"id":1', '"id":2') };
	assert.throws(() => openPackage(changed, manager.publicKeyPem), /version/);
	// the body and its version changed together: the signature still holds them
	const forged = signPackage({ hosts: [{ id: 2 }] }, other.privateKey);
	assert.throws(() => openPackage({ ...forged }, manager.publicKeyPem), /signature/);
	assert.throws(() => openPackage({ ...envelope, schema: 2 }, manager.publicKeyPem), /form/);
	assert.throws(() => openPackage(null, manager.publicKeyPem), /form/);
});

test("the access lists of a host: its own, the custom ones, those of its locations", () => {
	const host = {
		access_list_id: 3,
		npmplus_access_list_ids: [5, 3, "x", -1],
		locations: [{ npmplus_access_list_ids: [7] }, { access_list_id: 9 }, null],
	};
	assert.deepEqual(accessListIdsOf(host), [3, 5, 7, 9]);
	assert.deepEqual(accessListIdsOf({}), []);
});

test("a host with the ids of the node; what the node lacks becomes none and is told", () => {
	const host = {
		id: 10,
		domain_names: ["App.Example.com"],
		certificate_id: 4,
		access_list_id: 3,
		npmplus_access_list_ids: [3, 8],
		locations: [{ path: "/a", npmplus_access_list_ids: [8] }, { path: "/b" }],
	};
	const { row, missing } = remapHost(host, {
		certificates: new Map([[4, 40]]),
		accessLists: new Map([[3, 30]]),
	});
	assert.equal(row.certificate_id, 40);
	assert.equal(row.access_list_id, 30);
	assert.deepEqual(row.npmplus_access_list_ids, [30]);
	assert.deepEqual(row.locations, [{ path: "/a", npmplus_access_list_ids: [] }, { path: "/b" }]);
	assert.deepEqual(missing, ["access list 8", "access list 8"]);
	const none = remapHost({ ...host, certificate_id: 4 }, { certificates: new Map(), accessLists: new Map() });
	assert.equal(none.row.certificate_id, 0);
	assert.ok(none.missing.includes("certificate 4"));
	assert.deepEqual(domainsOf(host), ["app.example.com"]);
});
