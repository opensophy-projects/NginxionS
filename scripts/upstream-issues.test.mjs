// node --test scripts/upstream-issues.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { copyBody, copyTitle, marker, neutralize, plan, UPSTREAM } from "./upstream-issues.mjs";

const issue = (number, state, extra = {}) => ({
	number,
	state,
	title: `issue ${number}`,
	body: "text",
	html_url: `https://github.com/openappsec/openappsec/issues/${number}`,
	user: { login: "someone" },
	created_at: `2026-11-${String(10 + number).padStart(2, "0")}T00:00:00Z`,
	labels: [{ name: "bug" }],
	...extra,
});

test("the five repositories of the agent", () => {
	assert.deepEqual(UPSTREAM, [
		"openappsec/smartsync-shared-files",
		"openappsec/openappsec",
		"openappsec/attachment",
		"openappsec/smartsync",
		"openappsec/smartsync-tuning",
	]);
});

test("a new open issue is copied once; pull requests and closed issues never seen are not", () => {
	const copies = new Map([["openappsec/openappsec#1", { number: 10, state: "open" }]]);
	const { create, close, reopen } = plan(copies, [
		{
			repo: "openappsec/openappsec",
			issues: [issue(1, "open"), issue(2, "open"), issue(3, "closed"), issue(4, "open", { pull_request: {} })],
		},
	]);
	assert.deepEqual(
		create.map((c) => c.issue.number),
		[2],
	);
	assert.equal(close.length, 0);
	assert.equal(reopen.length, 0);
});

test("the copy follows upstream: closed, reopened", () => {
	const copies = new Map([
		["openappsec/attachment#5", { number: 20, state: "open" }],
		["openappsec/attachment#6", { number: 21, state: "closed" }],
	]);
	const { create, close, reopen } = plan(copies, [
		{ repo: "openappsec/attachment", issues: [issue(5, "closed"), issue(6, "open")] },
	]);
	assert.equal(create.length, 0);
	assert.deepEqual(
		close.map((c) => c.copy.number),
		[20],
	);
	assert.deepEqual(
		reopen.map((c) => c.copy.number),
		[21],
	);
});

test("the same number in two repositories is two issues; the oldest is created first", () => {
	const { create } = plan(new Map(), [
		{ repo: "openappsec/smartsync", issues: [issue(7, "open")] },
		{ repo: "openappsec/openappsec", issues: [issue(7, "open"), issue(2, "open")] },
	]);
	assert.deepEqual(
		create.map((c) => `${c.repo}#${c.issue.number}`),
		["openappsec/openappsec#2", "openappsec/smartsync#7", "openappsec/openappsec#7"],
	);
});

test("mentions notify no one, #N names the upstream issue", () => {
	const out = neutralize("ping @alice and @org/team, see #12 and (#3); mail a@b.c; `@code`; &#39;", "openappsec/agent");
	assert.ok(!/(^|[^\w`])@[A-Za-z]/.test(out.replace(/@‍/g, "")), out);
	assert.match(out, /@‍alice/);
	assert.match(out, /openappsec\/agent#12/);
	assert.match(out, /\(openappsec\/agent#3\)/);
	assert.match(out, /a@b\.c/, "an e-mail address stays");
	assert.match(out, /&#39;/, "an HTML entity stays");
});

test("the copy carries its marker, its link and the upstream text, cut to fit", () => {
	const body = copyBody("openappsec/openappsec", issue(9, "open", { body: "x".repeat(70000) }));
	assert.ok(body.startsWith(marker("openappsec/openappsec", 9)));
	assert.match(body, /https:\/\/github.com\/openappsec\/openappsec\/issues\/9/);
	assert.match(body, /`bug`/);
	assert.ok(body.length <= 60000, String(body.length));
	assert.match(body, /cut, the full text is upstream/);
	assert.match(copyBody("openappsec/openappsec", issue(1, "open", { body: null })), /no description/);
	assert.equal(copyTitle("openappsec/smartsync-tuning", issue(4, "open")), "[smartsync-tuning#4] issue 4");
});
