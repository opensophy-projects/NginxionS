import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { untarOne } from "./tar.js";

test("the one file of a tar archive: its content and its time", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "tar-"));
	const body = JSON.stringify({ policy: "x".repeat(1000) });
	writeFileSync(path.join(dir, "local_appsec.policy"), body);
	utimesSync(path.join(dir, "local_appsec.policy"), 1700000000, 1700000000);
	const tar = execFileSync("tar", ["-C", dir, "-cf", "-", "local_appsec.policy"]);
	const file = untarOne(tar);
	assert.equal(file.content.toString(), body);
	assert.equal(file.size, body.length);
	assert.equal(file.mtime.toISOString(), new Date(1700000000 * 1000).toISOString());
});

test("an empty or cut archive is refused", () => {
	assert.throws(() => untarOne(Buffer.alloc(10)), /empty/);
	const header = Buffer.alloc(512);
	header.write("00000002000\0", 124, "ascii");
	assert.throws(() => untarOne(Buffer.concat([header, Buffer.alloc(100)])), /cut/);
});
