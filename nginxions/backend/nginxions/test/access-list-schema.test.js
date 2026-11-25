import assert from "node:assert/strict";
import { before, test } from "node:test";
import errs from "../../lib/error.js";
import apiValidator from "../../lib/validator/api.js";
import { getCompiledSchema, getValidationSchema } from "../../schema/index.js";

before(getCompiledSchema);

const routes = [
	["/nginx/access-lists", "post"],
	["/nginx/access-lists/{listID}", "put"],
];
const fixture = { name: "Office", items: [{ username: "alice", password: "fixture" }], clients: [] };

for (const [path, method] of routes) {
	test(`${method} rejects invalid access-list values before writing to the database`, async () => {
		const schema = getValidationSchema(path, method);
		assert.ok(schema);
		const long = "a".repeat(256);
		for (const change of [
			{ name: long },
			{ name: "Office\u0000" },
			{ items: [{ username: long, password: "fixture" }] },
			{ items: [{ username: "alice\u0000", password: "fixture" }] },
			{ items: [{ username: "alice:admin", password: "fixture" }] },
			{ items: [{ username: "alice\n", password: "fixture" }] },
			{ clients: [{ address: long, directive: "allow" }] },
			{ clients: [{ address: "192.0.2.10\u0000", directive: "allow" }] },
		]) {
			await assert.rejects(apiValidator(schema, { ...fixture, ...change }), errs.ValidationError);
		}
		const allowed = {
			...fixture,
			name: "a".repeat(255),
			clients: [{ address: "192.0.2.0/24", directive: "allow" }],
		};
		assert.deepEqual(await apiValidator(schema, allowed), allowed);
	});
}

test("an update can keep the current password of a login", async () => {
	const schema = getValidationSchema("/nginx/access-lists/{listID}", "put");
	const body = { items: [{ username: "alice" }] };
	assert.deepEqual(await apiValidator(schema, body), body);
});
