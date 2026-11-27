// Metrics of the agent (WAF -> Agent): the prometheus nano service of open-appsec gathers the metrics of the services
// of the agent (/service-metrics of each) and gives them in the Prometheus text format on 127.0.0.1:7465/metrics.
// nginxions shares the network namespace of the openappsec container, so the address is local; nothing leaves it.

const METRICS_URL = process.env.NGINXIONS_AGENT_METRICS_URL || "http://127.0.0.1:7465/metrics";
const TIMEOUT_MS = 5000;
const MAX_METRICS = 2000;
const SAMPLE_MS = 60_000;
const HISTORY_LIMIT = 60;

let latest;
let pending;
let timer;
const history = [];

/**
 * labels of a sample: {a="1",b="x \"y\""} → [["a", "1"], ["b", "x \"y\""]] (pairs: the API client would rename keys
 * of an object to camelCase)
 */
const parseLabels = (text) => {
	const labels = [];
	const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		labels.push([m[1], m[2].replace(/\\(["\\n])/g, (_, c) => (c === "n" ? "\n" : c))]);
	}
	return labels;
};

/**
 * The Prometheus text format: [{name, help, type, samples: [{labels, value}]}], in the order of the text.
 * @param {string} text
 */
export const parseMetrics = (text) => {
	const byName = new Map();
	const metric = (name) => {
		if (!byName.has(name)) byName.set(name, { name, help: "", type: "", samples: [] });
		return byName.get(name);
	};
	for (const raw of String(text || "").split("\n")) {
		const line = raw.trim();
		if (!line) continue;
		const meta = /^#\s*(HELP|TYPE)\s+(\S+)\s*(.*)$/.exec(line);
		if (meta) {
			metric(meta[2])[meta[1] === "HELP" ? "help" : "type"] = meta[3];
			continue;
		}
		if (line.startsWith("#")) continue;
		const sample = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{.*\})?\s+(\S+)/.exec(line);
		if (!sample) continue;
		const value = Number(sample[3]);
		if (!Number.isFinite(value)) continue;
		metric(sample[1]).samples.push({ labels: sample[2] ? parseLabels(sample[2]) : [], value });
		if (byName.size > MAX_METRICS) break;
	}
	return [...byName.values()].filter((m) => m.samples.length);
};

export const summarizeMetrics = (metrics) => {
	const values = new Map(metrics.map(({ name, samples }) => [name, samples.map(({ value }) => value)]));
	const measure = (name, aggregate) => {
		const samples = values.get(name);
		return samples?.length ? aggregate(samples) : null;
	};
	const max = (samples) => samples.reduce((a, b) => Math.max(a, b), 0);
	const sum = (samples) => samples.reduce((a, b) => a + b, 0);
	// The agent resets its calculations when the exporter collects them. IPS values are
	// already counts from the report, so subtracting successive scrapes would be wrong.
	return {
		cpu: measure("cpu_usage_percentage_average", max),
		rss: measure("service_physical_memory_size_kb_average", (samples) => max(samples) / 1024),
		prevented: measure("prevent_action_matches_counter", sum),
		detected: measure("detect_action_matches_counter", sum),
		ignored: measure("ignore_action_matches_counter", sum),
	};
};

const scrape = async () => {
	try {
		const response = await fetch(METRICS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (!response.ok) return { reachable: true, metrics: [], error: `${response.status}` };
		return { reachable: true, metrics: parseMetrics(await response.text()), error: null };
	} catch (err) {
		return { reachable: false, metrics: [], error: err.cause?.code || err.message };
	}
};

const collect = () => {
	if (pending) return pending;
	pending = (async () => {
		const time = Math.floor(Date.now() / SAMPLE_MS) * SAMPLE_MS;
		if (latest?.time === time) return;
		const result = await scrape();
		latest = { ...result, time };
		history.push({ time, ...summarizeMetrics(result.metrics) });
		while (history.length && history[0].time <= time - HISTORY_LIMIT * SAMPLE_MS) history.shift();
	})().finally(() => {
		pending = undefined;
	});
	return pending;
};

export const startAgentMetrics = () => {
	if (timer) return;
	void collect();
	timer = setInterval(collect, SAMPLE_MS).unref();
};

export const getAgentMetrics = async () => {
	if (!latest) await collect();
	return { ...latest, history: [...history] };
};
