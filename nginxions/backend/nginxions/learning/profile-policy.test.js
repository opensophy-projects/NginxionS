// The WAF policy in a learning profile (step 15.5): references by name between servers, the objects carried, the
// sites found by their domains, objects of the same name used as they are.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyPolicy, policyOfSites, refsById, refsByName } from "./profile-policy.js";

const objects = [
	{ id: 1, kind: "threat_prevention", name: "nginxions-recommended", builtin: true, spec: {} },
	{ id: 7, kind: "exception", name: "allow-health", builtin: false, description: "", spec: { action: "skip" } },
	{ id: 8, kind: "log_trigger", name: "to-siem", builtin: false, description: "SIEM", spec: { a: 1 } },
];
const byId = new Map(objects.map((o) => [o.id, o]));

describe("the WAF policy in a profile", () => {
	test("references by name and back", () => {
		const named = refsByName({ template: "api", threatPreventionPractices: [1], exceptions: [7, 99] }, byId);
		assert.deepEqual(named, {
			template: "api",
			threatPreventionPractices: [{ kind: "threat_prevention", name: "nginxions-recommended" }],
			exceptions: [{ kind: "exception", name: "allow-health" }],
		});
		const there = [
			{ id: 31, kind: "threat_prevention", name: "nginxions-recommended" },
			{ id: 32, kind: "exception", name: "allow-health" },
		];
		assert.deepEqual(refsById(named, there), {
			objects: { template: "api", threatPreventionPractices: [31], exceptions: [32] },
			missing: [],
		});
		assert.deepEqual(refsById(named, []).missing, [
			"threat_prevention/nginxions-recommended",
			"exception/allow-health",
		]);
		assert.equal(refsByName(null, byId), null);
	});

	test("the objects of the administrator go with the policy, built-in ones do not", async () => {
		const policy = await policyOfSites(
			[{ id: 5, domains: ["shop.example"] }],
			async () => ({
				enabled: true,
				mode: "prevent-learn",
				minimum_confidence: "high",
				objects: { threatPreventionPractices: [1], exceptions: [7] },
				locations: [
					{
						path: "/api",
						inherit: false,
						enabled: true,
						mode: "detect-learn",
						minimum_confidence: "high",
						objects: { triggers: [8] },
					},
				],
			}),
			objects,
		);
		assert.deepEqual(policy.objects.map((o) => o.name).sort(), ["allow-health", "to-siem"]);
		assert.equal(policy.sites[0].locations[0].objects.triggers[0].name, "to-siem");
	});

	test("applied: a site by its domains, a missing object created, one of the same name used as it is", async () => {
		const here = [
			{ id: 41, kind: "threat_prevention", name: "nginxions-recommended" },
			{ id: 42, kind: "exception", name: "allow-health", spec: { action: "accept" } },
		];
		const created = [];
		const set = [];
		const result = await applyPolicy(
			{
				objects: [
					{ kind: "exception", name: "allow-health", spec: { action: "skip" } },
					{ kind: "log_trigger", name: "to-siem", spec: {} },
				],
				sites: [
					{
						domains: ["shop.example", "www.shop.example"],
						enabled: true,
						mode: "prevent-learn",
						minimum_confidence: "high",
						objects: {
							threatPreventionPractices: [{ kind: "threat_prevention", name: "nginxions-recommended" }],
							triggers: [{ kind: "log_trigger", name: "to-siem" }],
						},
						locations: [],
					},
					{ domains: ["gone.example"], enabled: true, mode: "detect-learn", objects: null, locations: [] },
				],
			},
			{
				hosts: [{ id: 3, domains: ["www.shop.example"] }],
				objects: async () => [...here, ...created.map((o, i) => ({ ...o, id: 50 + i }))],
				createObject: async (o) => created.push(o),
				setWaf: async (id, data) => set.push([id, data]),
			},
		);
		assert.deepEqual(result, {
			sites: 1,
			created: ["log_trigger/to-siem"],
			missing: [],
			notFound: ["gone.example"],
		});
		assert.deepEqual(set[0][0], 3);
		assert.deepEqual(set[0][1].objects, { threatPreventionPractices: [41], triggers: [50] });
	});
});
