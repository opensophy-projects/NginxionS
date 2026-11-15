import assert from "node:assert/strict";
import { test } from "node:test";
import { contractCases } from "./contract.js";
import { danglingRefs } from "./format.js";
import { KINDS } from "./model.js";

const cases = contractCases();

test("contract: the cases build, every object passes the model", () => {
	assert.deepEqual(
		cases.map((c) => c.name),
		["templates", "everything", "example-default", "example-example", "example-prevent"],
	);
});

test("contract: no rule names a missing object", () => {
	for (const c of cases) assert.deepEqual(danglingRefs(c.doc), [], c.name);
});

test("contract: the policy with everything has every kind of object and every engine on", () => {
	const { doc } = cases.find((c) => c.name === "everything");
	for (const section of Object.values(KINDS)) assert.ok(doc[section].length, section);
	const all = doc.threatPreventionPractices.find((p) => p.name === "all-engines");
	for (const engine of [
		"webAttacks",
		"intrusionPrevention",
		"fileSecurity",
		"snortSignatures",
		"schemaValidation",
		"antiBot",
	])
		assert.equal(all[engine].overrideMode, "prevent", engine);
});

test("contract: the file for the agent is v1beta2, engines of CrowdSec and nginx off, syslog through the relay", () => {
	const { policy, relays } = cases.find((c) => c.name === "everything");
	assert.equal(policy.apiVersion, "v1beta2");
	const all = policy.threatPreventionPractices.find((p) => p.name === "all-engines");
	assert.deepEqual(all.antiBot, { overrideMode: "inactive" });
	assert.deepEqual(all.schemaValidation, { overrideMode: "inactive" });
	assert.equal(all.fileSecurity.overrideMode, "inactive");
	assert.equal(all.intrusionPrevention.overrideMode, "prevent");
	assert.equal(relays.length, 2);
	const trigger = policy.logTriggers.find((t) => t.name === "all-destinations");
	assert.deepEqual(trigger.logDestination.syslogService, [{ address: "192.0.2.10", port: 514, proto: "udp" }]);
	assert.equal(trigger.logDestination.cefService[0].address, "127.0.0.1");
});
