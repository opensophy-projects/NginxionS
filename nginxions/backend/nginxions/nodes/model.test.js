import assert from "node:assert/strict";
import { test } from "node:test";
import {
	CODE,
	nodeLogsOf,
	rolloutOf,
	hash,
	newCode,
	newToken,
	newUid,
	normalizeInfo,
	normalizeLabels,
	normalizeManagerUrl,
	OFFLINE_MS,
	sameHash,
	stateOf,
	TOKEN,
	UID,
	uidOfCode,
} from "./model.js";

test("ids, join codes and tokens: their form, the id of the node inside its code", () => {
	const uid = newUid();
	assert.match(uid, UID);
	const code = newCode(uid);
	assert.match(code, CODE);
	assert.equal(uidOfCode(code), uid);
	assert.equal(uidOfCode(` ${code}\n`), uid, "copied with spaces");
	assert.equal(uidOfCode("n-0123.short"), null);
	assert.equal(uidOfCode(undefined), null);
	assert.match(newToken(), TOKEN);
	assert.notEqual(newToken(), newToken());
});

test("a secret is compared by its hash, and a broken stored hash never matches", () => {
	const token = newToken();
	assert.equal(sameHash(token, hash(token)), true);
	assert.equal(sameHash(`${token}x`, hash(token)), false);
	assert.equal(sameHash(token, null), false);
	assert.equal(sameHash(token, "abc"), false);
});

test("the state of a node: pending or expired code, online, offline, revoked", () => {
	const now = Date.parse("2026-11-20T12:00:00Z");
	const later = new Date(now + 3600000);
	const earlier = new Date(now - 1000);
	assert.equal(stateOf({ status: "pending", code_expires_on: later }, now), "pending");
	assert.equal(stateOf({ status: "pending", code_expires_on: earlier }, now), "expired");
	assert.equal(stateOf({ status: "pending", code_expires_on: null }, now), "expired");
	assert.equal(stateOf({ status: "active", last_seen_on: new Date(now - 10000) }, now), "online");
	assert.equal(stateOf({ status: "active", last_seen_on: new Date(now - OFFLINE_MS - 1) }, now), "offline");
	assert.equal(stateOf({ status: "active", last_seen_on: null }, now), "offline");
	assert.equal(stateOf({ status: "revoked", last_seen_on: new Date(now) }, now), "revoked");
});

test("labels: short lowercase words, no repeats, at most 20", () => {
	assert.deepEqual(normalizeLabels(["EU", "eu", " edge-1 ", "bad label", "", 5]), ["eu", "edge-1", "5"]);
	assert.equal(normalizeLabels(Array.from({ length: 30 }, (_, i) => `l${i}`)).length, 20);
	assert.deepEqual(normalizeLabels("eu"), []);
});

test("the heartbeat keeps only known, typed and short fields", () => {
	const info = normalizeInfo({
		version: "2.0.0",
		hostname: "x".repeat(200),
		hosts: 12,
		uptime: -5,
		agent: "ok",
		secret: "never stored",
	});
	assert.deepEqual(Object.keys(info).sort(), [
		"agent",
		"command_done",
		"command_error",
		"hostname",
		"hosts",
		"model_error",
		"model_sha256",
		"package_error",
		"package_skipped",
		"package_version",
		"profile_error",
		"profile_version",
		"services",
		"uptime",
		"version",
	]);
	assert.equal(info.hostname.length, 64);
	assert.equal(info.hosts, 12);
	assert.equal(info.uptime, null);
	assert.equal(normalizeInfo({ agent: "hacked" }).agent, "");
	assert.equal(normalizeInfo(null).version, "");
	assert.equal(normalizeInfo({ profile_version: "x" }).profile_version, "");
	assert.equal(normalizeInfo({ profile_version: "a".repeat(64) }).profile_version, "a".repeat(64));
});

test("the address of a manager: https, host and port only", () => {
	assert.equal(normalizeManagerUrl("https://manager.example.com:81"), "https://manager.example.com:81");
	assert.equal(normalizeManagerUrl(" https://10.0.0.5:81/ "), "https://10.0.0.5:81");
	assert.equal(normalizeManagerUrl("http://manager:81"), null, "not over plain HTTP");
	assert.equal(normalizeManagerUrl("https://user:pw@manager:81"), null);
	assert.equal(normalizeManagerUrl("https://manager:81/api"), null);
	assert.equal(normalizeManagerUrl("manager:81"), null);
	assert.equal(normalizeManagerUrl(""), null);
});

test("the rollout a heartbeat tells: a new version applied, a new error, nothing twice", () => {
	const v1 = "a".repeat(64);
	const v2 = "b".repeat(64);
	assert.deepEqual(rolloutOf({}, { package_version: v1 }), [
		{ kind: "package", version: v1, result: "applied", error: "" },
	]);
	assert.deepEqual(rolloutOf({ package_version: v1 }, { package_version: v1 }), []);
	assert.deepEqual(rolloutOf({ package_version: v1 }, { package_version: v1, package_error: "nginx refused" }), [
		{ kind: "package", version: v1, result: "failed", error: "nginx refused" },
	]);
	// the same error again: told once
	assert.deepEqual(
		rolloutOf({ package_version: v1, package_error: "x" }, { package_version: v1, package_error: "x" }),
		[],
	);
	assert.deepEqual(
		rolloutOf({ model_sha256: v1, profile_version: "" }, { model_sha256: v2, profile_version: v1 }).map(
			(r) => `${r.kind}:${r.result}`,
		),
		["model:applied", "profile:applied"],
	);
});

test("services and logs of a node: known names, bounded", () => {
	const info = normalizeInfo({ services: { openappsec: "running", "Bad Name": "x", crowdsec: "exited".repeat(9) } });
	assert.deepEqual(info.services, { openappsec: "running", crowdsec: "exited".repeat(9).slice(0, 16) });
	assert.deepEqual(normalizeInfo({ services: ["x"] }).services, {});
	const many = Array.from({ length: 400 }, (_, i) => ({ stream: "stdout", line: `line ${i}` }));
	const logs = nodeLogsOf({
		openappsec: many,
		crowdsec: [{ stream: "stderr", line: "x".repeat(3000) }, { line: 5 }],
	});
	assert.equal(logs.openappsec.length, 300);
	assert.equal(logs.openappsec.at(-1).line, "line 399");
	assert.deepEqual(logs.crowdsec[1], { stream: "stdout", line: "5" });
	assert.equal(logs.crowdsec[0].line.length, 2000);
	assert.equal(nodeLogsOf({ "../x": [] }), null);
	assert.equal(nodeLogsOf("text"), null);
});
