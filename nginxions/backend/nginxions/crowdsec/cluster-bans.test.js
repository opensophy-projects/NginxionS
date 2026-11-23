// The bans shared by the servers of a cluster (step 15.3): which bans a server shares, how lists merge, what a server
// does to its CrowdSec to hold the bans of the others.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CLUSTER_ORIGIN, cleanBans, mergeBans, ownBans, plan, secondsOf, versionOfBans } from "./cluster-bans.js";

const NOW = Date.parse("2026-11-21T12:00:00Z");
const d = (extra) => ({ origin: "crowdsec", scope: "Ip", type: "ban", duration: "1h0m0s", scenario: "x", ...extra });

describe("bans of the cluster", () => {
	test("durations of CrowdSec", () => {
		assert.equal(secondsOf("3h59m56.3s"), 14396);
		assert.equal(secondsOf("720h"), 2592000);
		assert.equal(secondsOf("45s"), 45);
		assert.equal(secondsOf("-1s"), 0);
		assert.equal(secondsOf(""), 0);
	});

	test("a server shares its bans and those of its agent, not blocklists, the central API or the cluster", () => {
		const own = ownBans(
			[
				d({ value: "198.51.100.1" }),
				d({ value: "198.51.100.2", origin: "cscli", scenario: "nginxions/manual" }),
				d({ value: "198.51.100.3", origin: "lists", scenario: "nginxions/blocklist/1" }),
				d({ value: "198.51.100.4", origin: "CAPI" }),
				d({ value: "198.51.100.5", origin: CLUSTER_ORIGIN }),
				d({ value: "198.51.100.6", scope: "Country" }),
				d({ value: "198.51.100.7", duration: "-5s" }),
				d({ value: "198.51.100.0/24", scope: "Range" }),
				// two decisions of one address: the longer one
				d({ value: "198.51.100.1", duration: "2h0m0s" }),
			],
			NOW,
		);
		assert.deepEqual(own.map((b) => b.value).sort(), ["198.51.100.0/24", "198.51.100.1", "198.51.100.2"]);
		assert.equal(own.find((b) => b.value === "198.51.100.1").until, "2026-11-21T14:00:00.000Z");
	});

	test("a list from another server: well formed and future bans only", () => {
		const ok = { value: "203.0.113.9", scope: "Ip", type: "ban", until: "2026-11-21T13:00:00Z", scenario: "s" };
		assert.equal(
			cleanBans(
				[
					ok,
					{ ...ok, value: "x; rm -rf /" },
					{ ...ok, type: "allow" },
					{ ...ok, until: "2026-11-21T11:00:00Z" },
				],
				NOW,
			).length,
			1,
		);
		assert.deepEqual(cleanBans(null), []);
	});

	test("lists merge: the longest of each address; the version changes with the list", () => {
		const a = { value: "203.0.113.9", scope: "Ip", type: "ban", until: "2026-11-21T13:00:00.000Z", scenario: "" };
		const b = { ...a, until: "2026-11-21T15:00:00.000Z" };
		const c = { ...a, value: "203.0.113.10" };
		assert.deepEqual(mergeBans([a], [b, c]), [c, b]);
		assert.equal(versionOfBans([a, c]), versionOfBans([c, a]));
		assert.notEqual(versionOfBans([a]), versionOfBans([b]));
	});

	test("a server adds the bans it lacks, removes those that left, leaves the held ones", () => {
		const wanted = [
			{ value: "203.0.113.1", scope: "Ip", type: "ban", until: "2026-11-21T13:00:00.000Z" },
			{ value: "203.0.113.2", scope: "Ip", type: "ban", until: "2026-11-21T13:00:00.000Z" },
		];
		const held = [
			{ id: 7, origin: CLUSTER_ORIGIN, value: "203.0.113.1", type: "ban", duration: "59m50s" },
			{ id: 8, origin: CLUSTER_ORIGIN, value: "203.0.113.3", type: "ban", duration: "59m50s" },
			// a ban of this server itself is never touched
			{ id: 9, origin: "crowdsec", value: "203.0.113.4", type: "ban", duration: "1h" },
		];
		const { add, remove } = plan(held, wanted, NOW);
		assert.deepEqual(
			add.map((a) => [a.value, a.duration]),
			[["203.0.113.2", "3600s"]],
		);
		assert.deepEqual(remove, [8]);
	});
});
