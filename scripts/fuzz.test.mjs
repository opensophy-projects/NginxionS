// Fuzzing of the parsers of untrusted input (docs/DEVSECOPS.md): inputs mutated from real ones, a fixed seed (the
// failing one is printed: FUZZ_SEED=<seed> replays it). Each parser must answer with a result or with its own
// refusal, never with an uncaught error or a hang:
//   - the converter of Snort rules of the agent (snort_to_ips_local.mjs): rules uploaded in WAF -> Policy;
//   - the expert fragment of the policy (waf/custom.js parseCustom): YAML typed by an administrator;
//   - the objects of the policy (waf/objects/model.js normalize) and the import of v1beta1 (format.js fromV1).
// CI runs a few hundred cases a target (FUZZ_ITERATIONS), the nightly workflow tens of thousands.
//   FUZZ_ITERATIONS=50000 node --test scripts/fuzz.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "../nginxions/backend/node_modules/yaml/dist/index.js";
import { parseCustom } from "../nginxions/backend/nginxions/waf/custom.js";
import { contractCases } from "../nginxions/backend/nginxions/waf/objects/contract.js";
import { fromV1 } from "../nginxions/backend/nginxions/waf/objects/format.js";
import { KINDS, normalize } from "../nginxions/backend/nginxions/waf/objects/model.js";
import { convert } from "../openappsec/agent/nodes/http_transaction_handler/package/snort_to_ips_local.mjs";

const ITERATIONS = Number(process.env.FUZZ_ITERATIONS || 300);
const SEED = Number(process.env.FUZZ_SEED || Date.now() % 2 ** 31);
// one case may not take longer than this: a regular expression that backtracks without end is a denial of service
const CASE_MS = Number(process.env.FUZZ_CASE_MS || 2000);

/** mulberry32: the same seed, the same cases */
const rng = (seed) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const TOKENS = [
	";", ":", "\"", "'", "\\", "(", ")", "{", "}", "[", "]", ",", "|", "!", "\n", "\t", "\0", " ", "*", "&", "-", "#",
	"content:", "pcre:\"/", "/i\"", "msg:", "sid:", "nocase", "http_uri", "depth", "within", "distance", "byte_test",
	"!=", "|00 ff|", "%", "${", "‮", "😀", "a".repeat(300), "(".repeat(40), "\\x", "\\u0000",
	"- ", "? ", ": ", "&a", "*a", "!!binary", "~", "null", "true", "1e999", "-0", "0x", "<<: *a", "---", "...",
];

/** a mutation of a string: flips, deletions, insertions of characters and tokens, duplicated or swapped slices */
const mutate = (random, input) => {
	let s = input;
	const n = 1 + Math.floor(random() * 6);
	for (let i = 0; i < n; i++) {
		const at = Math.floor(random() * (s.length + 1));
		switch (Math.floor(random() * 6)) {
			case 0:
				s = s.slice(0, at) + String.fromCharCode(Math.floor(random() * 0x80)) + s.slice(at + 1);
				break;
			case 1:
				s = s.slice(0, at) + s.slice(at + 1 + Math.floor(random() * 8));
				break;
			case 2:
				s = s.slice(0, at) + TOKENS[Math.floor(random() * TOKENS.length)] + s.slice(at);
				break;
			case 3: {
				const len = Math.floor(random() * 40);
				s = s.slice(0, at) + s.slice(at, at + len) + s.slice(at);
				break;
			}
			case 4: {
				const b = Math.floor(random() * (s.length + 1));
				s = s.slice(0, Math.min(at, b)) + s.slice(Math.max(at, b)) + s.slice(Math.min(at, b), Math.max(at, b));
				break;
			}
			default:
				s = s.slice(0, at);
		}
	}
	return s;
};

/** runs a target on mutated inputs; the case that throws (or takes too long) is reported with its seed */
const fuzz = (name, corpus, target) =>
	test(`fuzz: ${name} (${ITERATIONS} cases, FUZZ_SEED=${SEED})`, () => {
		const random = rng(SEED);
		for (let i = 0; i < ITERATIONS; i++) {
			const input = mutate(random, corpus[Math.floor(random() * corpus.length)]);
			const start = performance.now();
			try {
				target(input);
			} catch (err) {
				assert.fail(`${name}: case ${i} throws ${err?.name}: ${err?.message}\ninput: ${JSON.stringify(input).slice(0, 500)}`);
			}
			const ms = performance.now() - start;
			assert.ok(ms < CASE_MS, `${name}: case ${i} took ${Math.round(ms)} ms\ninput: ${JSON.stringify(input).slice(0, 500)}`);
		}
	});

const snortRules = readFileSync(
	new URL("../openappsec/agent/nodes/http_transaction_handler/package/testdata/snort-rules.txt", import.meta.url),
	"utf8",
)
	.split("\n")
	.filter((l) => l.startsWith("alert"));

fuzz("Snort converter of the agent", snortRules, (input) => {
	const out = convert(`${input}\n${input}`);
	JSON.stringify(out);
	assert.ok(Array.isArray(out.signatures) && Array.isArray(out.errors));
});

const policies = contractCases().map((c) => YAML.stringify(c.policy, { lineWidth: 0, aliasDuplicateObjects: false }));
const fragments = [
	...policies,
	"exceptions:\n  - name: e\n    action: accept\n    condition:\n      - key: sourceIp\n        value: 10.0.0.1\n",
	"policies:\n  default:\n    mode: prevent-learn\n  specificRules:\n    - name: r\n      host: a.test\n",
];

fuzz("expert fragment of the policy (YAML)", fragments, (input) => {
	try {
		parseCustom(input);
	} catch (err) {
		// a refusal of the API (400), with its message: what an administrator sees
		if (err?.status !== 400 || typeof err.message !== "string") throw err;
	}
});

const specs = contractCases().flatMap((c) =>
	Object.entries(KINDS).flatMap(([kind, section]) =>
		(c.doc[section] || []).map(({ name, ...spec }) => JSON.stringify({ kind, spec })),
	),
);

fuzz("objects of the policy (normalize)", specs, (input) => {
	let parsed;
	try {
		parsed = JSON.parse(input);
	} catch {
		return;
	}
	const r = normalize(parsed?.kind ?? "exception", parsed?.spec ?? parsed, { lenient: true });
	assert.ok(r && (Array.isArray(r.errors) || (r.spec && typeof r.spec === "object")), "neither errors nor a spec");
});

fuzz("import of a v1beta1 policy (fromV1)", policies, (input) => {
	let doc;
	try {
		doc = YAML.parse(input);
	} catch {
		return;
	}
	if (doc && typeof doc === "object" && !Array.isArray(doc)) fromV1(doc);
});
