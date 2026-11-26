import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, SUITES } from "./ci-level.mjs";

const push = (changed, message = "") => decide({ event: "push", ref: "refs/heads/feature", message, changed });

test("a push of the backend only is fast, no C++ or Go scan", () => {
	const d = push(["nginxions/backend/nginxions/waf/policy.js"]);
	assert.equal(d.level, "fast");
	assert.equal(d.cpp, false);
	assert.equal(d.go, false);
});

test("[full] builds the images and runs every test of the stack", () => {
	const d = push(["nginxions/backend/index.js"], "fix [full]");
	assert.equal(d.level, "full");
	assert.deepEqual(d.suites, SUITES);
	assert.equal(d.dast, true);
});

test("a change of the agent or deploy/ is full without [full]", () => {
	assert.equal(push(["openappsec/agent/core/x.cc"]).level, "full");
	assert.equal(push(["deploy/compose.yaml"]).level, "full");
	assert.equal(push(["nginxions/rootfs/usr/local/lua/nginxions/nginxions_files.lua"]).level, "full");
	assert.equal(push(["openappsec/agent/core/x.cc"]).cpp, true);
	assert.equal(push(["openappsec/smartsync-tuning/main.go"]).go, true);
});

test("offline packaging changes build and test the same checkout", () => {
	for (const path of [".github/workflows/offline-bundle.yml", "scripts/offline-bundle.sh"]) {
		assert.equal(push([path]).level, "full");
	}
});

test("documentation only is fast even when it is under deploy/", () => {
	const d = push(["docs/DEVSECOPS.md", "deploy/README.md"]);
	assert.equal(d.level, "fast");
	assert.equal(d.cpp, false);
});

test("tags of the message run only their tests", () => {
	const d = push(["nginxions/backend/x.js"], "WAF [smoke:waf] [dast]");
	assert.equal(d.level, "full");
	assert.deepEqual(d.suites, ["smoke-waf", "dast"]);
	assert.equal(push([], "x [smoke:learning]").suites[0], "smoke-waf");
	assert.equal(push([], "x [chaos]").dast, false);
	assert.deepEqual(push([], "nodes [cluster]").suites, ["cluster"]);
});

test("work, tags and pull requests are full with every test; unknown changes scan everything", () => {
	assert.equal(decide({ event: "push", ref: "refs/heads/work", changed: ["a.md"] }).level, "full");
	assert.equal(decide({ event: "push", ref: "refs/tags/v1.0.0", changed: null }).level, "full");
	const pr = decide({ event: "pull_request", ref: "refs/pull/1/merge", changed: null, message: "[dast]" });
	assert.deepEqual(pr.suites, SUITES);
	assert.equal(pr.cpp, true);
});

test("security branches, the label and Run workflow", () => {
	assert.equal(decide({ event: "push", ref: "refs/heads/security/2026-11-16", changed: [] }).level, "extended");
	assert.equal(
		decide({ event: "pull_request", action: "labeled", label: "bug", ref: "refs/pull/1/merge", changed: [] }).level,
		"none",
	);
	assert.equal(
		decide({ event: "pull_request", labels: "x,security-scan", ref: "refs/pull/1/merge", changed: [] }).level,
		"extended",
	);
	assert.equal(decide({ event: "workflow_dispatch", input: "fast", ref: "refs/heads/x", changed: null }).level, "fast");
});
