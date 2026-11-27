import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createReleaseService, newerRelease } from "./releases.js";

test("stable versions compare numerically without offering prereleases or downgrades", () => {
	assert.equal(newerRelease("V1.9.9", "v1.10.0"), true);
	assert.equal(newerRelease("V1.10.0", "V1.9.9"), false);
	assert.equal(newerRelease("V1.10.0", "v1.10.0"), false);
	assert.equal(newerRelease("V2.0.0", "V1.99.99"), false);
	assert.equal(newerRelease("develop", "V1.0.0"), true);
	for (const tag of [null, 1, "latest", "V1.0.0-rc.1", "V01.0.0", "V1.0.0\n"]) {
		assert.equal(newerRelease("develop", tag), false, String(tag));
	}
});

test("checks only after a request and caches concurrent calls and temporary failures", async () => {
	let time = 1000;
	const requests = [];
	let reply = () => Response.json({ tag_name: "V1.10.0" });
	const service = createReleaseService({
		current: "V1.9.0",
		hostUpdater: false,
		now: () => time,
		request: async (url, options) => {
			requests.push({ url, options });
			return reply();
		},
	});
	assert.deepEqual(await service.status(), { current: "V1.9.0", canAutoUpdate: false, autoUpdate: false });
	assert.equal(requests.length, 0);
	const results = await Promise.all([service.check(), service.check()]);
	assert.deepEqual(results, [
		{ status: "available", tag: "V1.10.0" },
		{ status: "available", tag: "V1.10.0" },
	]);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].url, "https://api.github.com/repos/opensophy-projects/NginxionS/releases/latest");
	assert.equal(requests[0].options.redirect, "error");
	assert.ok(requests[0].options.signal instanceof AbortSignal);
	reply = () => {
		throw new Error("network down");
	};
	time += 61_000;
	assert.deepEqual(await service.check(), { status: "unavailable" });
	assert.deepEqual(await service.check(), { status: "unavailable" });
	assert.equal(requests.length, 2);
});

test("distinguishes current, unpublished and malformed releases", async () => {
	const cases = [
		[Response.json({ tag_name: "V1.2.0" }), { status: "current", tag: "V1.2.0" }],
		[new Response(null, { status: 404 }), { status: "unpublished" }],
		[new Response(null, { status: 500 }), { status: "unavailable" }],
		[Response.json({ tag_name: "V2.0.0", prerelease: true }), { status: "unavailable" }],
		[Response.json({ tag_name: "V2.0.0", draft: true }), { status: "unavailable" }],
		[Response.json({ tag_name: "latest" }), { status: "unavailable" }],
	];
	for (const [response, outcome] of cases) {
		const service = createReleaseService({ current: "V1.2.0", request: async () => response });
		assert.deepEqual(await service.check(), outcome);
	}
});

test("automatic updates are opt-in, persisted and limited to stable installations with a host updater", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "nginxions-release-"));
	t.after(() => rm(directory, { recursive: true }));
	const service = createReleaseService({ current: "V1.0.0", hostUpdater: true, directory });
	assert.deepEqual(await service.status(), { current: "V1.0.0", canAutoUpdate: true, autoUpdate: false });
	assert.ok((await service.setAutoUpdate(true)).autoUpdate);
	assert.equal(await readFile(join(directory, "auto-update"), "utf8"), "true\n");
	assert.equal((await service.setAutoUpdate(false)).autoUpdate, false);
	await assert.rejects(service.setAutoUpdate("true"), /unavailable/);
	await assert.rejects(
		createReleaseService({ current: "develop", hostUpdater: true, directory }).setAutoUpdate(true),
		/unavailable/,
	);
	await assert.rejects(
		createReleaseService({ current: "V1.0.0", hostUpdater: false, directory }).setAutoUpdate(true),
		/unavailable/,
	);
});
