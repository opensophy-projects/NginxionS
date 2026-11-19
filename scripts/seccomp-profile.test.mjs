// node --test scripts/seccomp-profile.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SCTP, withoutSctp } from "./seccomp-profile.mjs";

const profile = JSON.parse(readFileSync(new URL("../deploy/seccomp/nginxions.json", import.meta.url), "utf8"));
const socketRules = profile.syscalls.filter((r) => r.names.includes("socket"));

test("the profile of the stack is the default of Docker: refuse what is not allowed", () => {
	assert.equal(profile.defaultAction, "SCMP_ACT_ERRNO");
	assert.ok(profile.syscalls.length > 50);
});

test("no rule allows socket() of IPv4 or IPv6 with SCTP, nor a seqpacket socket", () => {
	assert.ok(socketRules.length > 5);
	for (const rule of socketRules) {
		assert.equal(rule.action, "SCMP_ACT_ALLOW");
		const domain = rule.args.find((a) => a.index === 0);
		assert.ok(domain, "socket() is allowed only by address family");
		const inet =
			(domain.op === "SCMP_CMP_EQ" && [2, 10].includes(domain.value)) ||
			(domain.op === "SCMP_CMP_LT" && domain.value > 2);
		if (!inet) continue;
		assert.equal(domain.op, "SCMP_CMP_EQ", JSON.stringify(rule));
		assert.deepEqual(
			rule.args.find((a) => a.index === 2),
			{ index: 2, value: SCTP, op: "SCMP_CMP_NE" },
		);
		const type = rule.args.find((a) => a.index === 1);
		assert.equal(type.op, "SCMP_CMP_MASKED_EQ");
		assert.ok([1, 2, 3].includes(type.valueTwo), "stream, datagram or raw only");
	}
	for (const domain of [2, 10]) {
		assert.equal(
			socketRules.filter((r) => r.args.some((a) => a.index === 0 && a.op === "SCMP_CMP_EQ" && a.value === domain))
				.length,
			3,
		);
	}
});

test("the transformation refuses a profile it does not know", () => {
	assert.throws(() => withoutSctp({ syscalls: [{ names: ["socket"], action: "SCMP_ACT_ALLOW" }] }));
	assert.throws(() => withoutSctp({ syscalls: [] }));
});
