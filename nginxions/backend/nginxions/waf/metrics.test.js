import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMetrics, summarizeMetrics } from "./metrics.js";

test("metrics of the agent: the Prometheus text format with help, type and labels", () => {
	const text = `# HELP nano_service_restarts_counter Restarts of the nano services
# TYPE nano_service_restarts_counter counter
nano_service_restarts_counter{serviceName="HTTP Transaction Handler",id="1"} 2
nano_service_restarts_counter{serviceName="Orchestration"} 0

# TYPE waap_requests gauge
waap_requests{asset="a \\"b\\""} 12.5
waap_requests NaN
garbage line
`;
	assert.deepEqual(parseMetrics(text), [
		{
			name: "nano_service_restarts_counter",
			help: "Restarts of the nano services",
			type: "counter",
			samples: [
				{
					labels: [
						["serviceName", "HTTP Transaction Handler"],
						["id", "1"],
					],
					value: 2,
				},
				{ labels: [["serviceName", "Orchestration"]], value: 0 },
			],
		},
		{ name: "waap_requests", help: "", type: "gauge", samples: [{ labels: [["asset", 'a "b"']], value: 12.5 }] },
	]);
	assert.deepEqual(parseMetrics(""), []);
});

test("agent charts use the largest process sample, sum reported IPS matches and keep missing values separate", () => {
	const metrics = parseMetrics(`
cpu_usage_percentage_average{id="1"} 0.5
cpu_usage_percentage_average{id="2"} 1.1
service_physical_memory_size_kb_average{id="1"} 46080
service_physical_memory_size_kb_average{id="2"} 47104
prevent_action_matches_counter{id="1"} 4
prevent_action_matches_counter{id="2"} 5
detect_action_matches_counter{id="1"} 0
`);
	assert.deepEqual(summarizeMetrics(metrics), { cpu: 1.1, rss: 46, prevented: 9, detected: 0, ignored: null });
});
