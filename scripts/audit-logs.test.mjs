import assert from "node:assert/strict";
import { test } from "node:test";
import { audit, classify, normalize, parseAllowlist } from "./audit-logs.mjs";

test("lines of each source are classified, the rest is left out", () => {
	assert.deepEqual(
		classify("[2026-11-14T16:17:35.243749: : <26> getUpdate@declarative_policy_utils.cc:206 | ###] policy tried again"),
		{ level: "warning", where: "getUpdate@declarative_policy_utils.cc", message: "policy tried again" },
	);
	assert.equal(classify("[2026-11-14T16:17:35: : <26> f@x.cc:1 | ---] fine"), null);
	assert.equal(
		classify('{"eventLogLevel":"error","eventSource":{"issuingFunction":"pkg.f"},"eventData":{"eventMessage":"boom"}}')
			.message,
		"boom",
	);
	assert.equal(classify('{"eventLogLevel":"info","eventData":{}}'), null);
	assert.equal(classify('time="x" level=error msg="no \\"file\\""').message, 'no \\"file\\"');
	assert.equal(
		classify("2026/11/14 10:00:00 [error] 12#12: *34 connect() failed (111: Connection refused), client: 1.2.3.4")
			.message,
		"connect() failed (111: Connection refused)",
	);
	assert.equal(classify("[Global        ] › ✖  error     Could not write").level, "error");
	assert.equal(classify('2026 UTC [1] ERROR:  relation "appsec" does not exist').where, "postgres");
	assert.equal(classify("panic: runtime error").level, "error");
	assert.equal(classify("all good"), null);
});

test("a signature has no times, addresses, ids or numbers", () => {
	assert.equal(
		normalize("2026-11-14T10:00:00.123Z 10.0.0.5:443 id 3f2a9c1e-1111-2222-3333-444455556666 took 42 ms abcdef0123456789"),
		"<time> <ip> id <uuid> took N ms <hex>",
	);
});

test("known signatures carry their reason, new ones come first", () => {
	const allow = parseAllowlist("# comment\nagent-debug\t^f@x\\.cc: known\tby design\n");
	const entries = audit(
		[
			{ source: "agent-debug", text: "[t: : <1> f@x.cc:1 | ###] known\n[t: : <1> f@x.cc:2 | ###] known" },
			{ source: "nginxions", text: "[Global] › ✖  error     new thing 7" },
		],
		allow,
	);
	assert.equal(entries.length, 2);
	assert.deepEqual(
		entries.map((e) => [e.source, e.known, e.count, e.signature]),
		[
			["nginxions", false, 1, "Global: new thing N"],
			["agent-debug", true, 2, "f@x.cc: known"],
		],
	);
	assert.equal(entries[1].reason, "by design");
});
