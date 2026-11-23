import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

test("agent status requires a successful HTTP response with orchestration data", async (t) => {
	let status = 503;
	let body = '{"error":"agent not ready"}';
	const server = createServer((_, response) => response.writeHead(status).end(body));
	t.after(() => server.close());
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const oldUrl = process.env.NGINXIONS_APPSEC_ORCHESTRATION_URL;
	process.env.NGINXIONS_APPSEC_ORCHESTRATION_URL = `http://127.0.0.1:${server.address().port}`;
	t.after(() => {
		if (oldUrl === undefined) delete process.env.NGINXIONS_APPSEC_ORCHESTRATION_URL;
		else process.env.NGINXIONS_APPSEC_ORCHESTRATION_URL = oldUrl;
	});
	const { getAgentStatus } = await import("./agent.js");
	assert.deepEqual(await getAgentStatus(), { reachable: false, error: "HTTP 503" });
	status = 200;
	assert.deepEqual(await getAgentStatus(), { reachable: false, error: "Invalid orchestration status" });
	body = JSON.stringify({
		"Last update status": "Succeeded",
		"Policy version": "42",
		"Last policy update": "2026-11-23T11:00:00Z",
	});
	assert.deepEqual(await getAgentStatus(), {
		reachable: true,
		mode: "local",
		policyVersion: "42",
		lastPolicyUpdate: "2026-11-23T11:00:00Z",
		lastUpdate: null,
		lastUpdateStatus: "Succeeded",
	});
});
