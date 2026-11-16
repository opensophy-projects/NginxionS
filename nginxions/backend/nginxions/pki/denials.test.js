import assert from "node:assert/strict";
import { test } from "node:test";
import { collapseRuns, toEvent, WINDOW_MS } from "./denials.js";

test("mTLS denials: a line of the nginx log becomes a security event", () => {
	const none = toEvent({
		time: "2026-10-29T15:00:00+00:00",
		host: "MTLS.local",
		ip: "192.0.2.7",
		method: "GET",
		uri: "/secret?x=1",
		verify: "NONE",
	});
	assert.equal(none.kind, "mtls");
	assert.equal(none.name, "mTLS: no client certificate");
	assert.equal(none.host, "mtls.local");
	assert.equal(none.uri, "/secret");
	assert.equal(none.query, "x=1");
	assert.equal(none.response_code, 403);
	const refused = toEvent({
		time: "2026-10-29T15:00:01+00:00",
		ip: "192.0.2.8",
		uri: "/",
		verify: "SUCCESS",
		s_dn: "CN=bob,OU=Sales",
		serial: "0A",
	});
	assert.equal(refused.name, "mTLS: client certificate not accepted");
	assert.equal(refused.sample, "subject: CN=bob,OU=Sales; serial: 0A");
	// the answer chosen for the host (denied_page): 404 or a closed connection (444)
	assert.equal(toEvent({ time: "2026-10-29T15:00:02+00:00", ip: "192.0.2.8", status: "404" }).response_code, 404);
	assert.equal(toEvent({ time: "2026-10-29T15:00:02+00:00", ip: "192.0.2.8", status: "444" }).response_code, 444);
	assert.equal(toEvent({ ip: "192.0.2.9" }), null);
	assert.equal(toEvent({ time: "bad", ip: "192.0.2.9" }), null);
});

const refusal = (seconds, extra = {}) =>
	toEvent({
		time: new Date(Date.UTC(2026, 10, 15, 15, 42, 0) + seconds * 1000).toISOString(),
		host: "panel.example.com",
		ip: "192.0.2.7",
		method: "GET",
		uri: `/api/${seconds}`,
		verify: "NONE",
		...extra,
	});

test("mTLS denials: one page load without a certificate is one event with the number of requests", async () => {
	// the page, its scripts and API calls; a second address; then the same address after the window
	const lines = [0, 1, 1, 2, 9].map((s) => refusal(s));
	lines.push(refusal(3, { ip: "192.0.2.8" }));
	lines.push(refusal(WINDOW_MS / 1000 + 5));
	const { events, repeats } = await collapseRuns(lines, async () => null);
	assert.deepEqual(
		events.map((e) => [e.source_ip, e.repeats, e.uri]),
		[
			["192.0.2.7", 5, "/api/0"],
			["192.0.2.8", 1, "/api/3"],
			["192.0.2.7", 1, `/api/${WINDOW_MS / 1000 + 5}`],
		],
	);
	assert.deepEqual(repeats, []);
});

test("mTLS denials: a run that began in an earlier round grows the stored event", async () => {
	const start = refusal(0).time;
	const asked = [];
	const { events, repeats } = await collapseRuns(
		[refusal(4), refusal(5), refusal(6, { verify: "FAILED:x" })],
		async (e) => {
			asked.push(e.incident_type);
			return e.incident_type === "mTLS no certificate" ? { id: "41", time: start } : null;
		},
	);
	assert.deepEqual(repeats, [{ id: "41", time: start, add: 2 }]);
	// another reason is another event; the store is asked once per run
	assert.deepEqual(
		events.map((e) => [e.incident_type, e.repeats]),
		[["mTLS certificate", 1]],
	);
	assert.deepEqual(asked, ["mTLS no certificate", "mTLS certificate"]);
});
