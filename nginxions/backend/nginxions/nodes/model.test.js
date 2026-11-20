import assert from "node:assert/strict";
import { test } from "node:test";
import {
	CODE,
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
	assert.deepEqual(Object.keys(info).sort(), ["agent", "hostname", "hosts", "uptime", "version"]);
	assert.equal(info.hostname.length, 64);
	assert.equal(info.hosts, 12);
	assert.equal(info.uptime, null);
	assert.equal(normalizeInfo({ agent: "hacked" }).agent, "");
	assert.equal(normalizeInfo(null).version, "");
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
