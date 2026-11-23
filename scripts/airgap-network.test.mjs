import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const probe = fileURLToPath(new URL("../deploy/test/airgap-network.sh", import.meta.url));

test("air-gap probe distinguishes a reachable silent socket from a closed port", async (t) => {
	const listener = createServer((socket) => socket.resume());
	listener.listen(0, "127.0.0.1");
	await once(listener, "listening");
	t.after(() => listener.close());
	const reachable = `127.0.0.1:${listener.address().port}`;

	const temporary = createServer();
	temporary.listen(0, "127.0.0.1");
	await once(temporary, "listening");
	const closed = `127.0.0.1:${temporary.address().port}`;
	await promisify(temporary.close.bind(temporary))();

	const invoke = (...endpoints) => run("sh", [probe, ...endpoints]);
	await Promise.all([
		invoke(reachable, closed),
		assert.rejects(invoke(reachable, reachable), (error) => {
			assert.equal(error.code, 1);
			assert.match(error.stderr, /reachable from the edge network/);
			assert.ok(error.stderr.includes(reachable));
			return true;
		}),
		assert.rejects(invoke(closed, closed), (error) => {
			assert.equal(error.code, 1);
			assert.match(error.stderr, /cannot reach its control endpoint/);
			return true;
		}),
	]);
});
