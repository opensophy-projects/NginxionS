import assert from "node:assert/strict";
import { test } from "node:test";
import { flaky } from "./flaky-report.mjs";

const step = (name, result, seconds = 5) => ({ group: "waf", name, result, seconds });

test("a step that failed and passed on one commit is flaky, one that fails after a change is not", () => {
	const rows = flaky([
		{ run: "1", sha: "a", steps: [step("snapshot", "FAIL"), step("rate limit", "ok")] },
		{ run: "2", sha: "a", steps: [step("snapshot", "ok"), step("rate limit", "ok")] },
		{ run: "3", sha: "b", steps: [step("snapshot", "ok"), step("rate limit", "FAIL", 60)] },
	]);
	const snapshot = rows.find((r) => r.name === "snapshot");
	const rate = rows.find((r) => r.name === "rate limit");
	assert.equal(snapshot.flaky, true);
	assert.equal(snapshot.failed, 1);
	assert.equal(rate.flaky, false);
	assert.equal(rate.max, 60);
	assert.equal(rate.runs, 3);
});
