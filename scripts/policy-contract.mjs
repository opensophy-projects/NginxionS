#!/usr/bin/env node
// The policies of the contract test (scripts/test-policy-contract.sh) and the check of what the agent made of them.
//
//   node scripts/policy-contract.mjs write <dir>   <dir>/<case>.yaml (the file for the agent), <case>.doc.json
//   node scripts/policy-contract.mjs check <dir>   <dir>/<case>.applied.json against <case>.doc.json (compare.js)
//   node scripts/policy-contract.mjs split <dir> <case>   <case>~<n>.yaml: the default rule alone, then each rule of a
//     host alone with every object: which part of a refused policy the agent refuses (<case>.culprits.txt)
//
// The cases: nginxions/backend/nginxions/waf/objects/contract.js. A report goes to <dir>/contract.md and to the
// summary of the run.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compareApplied } from "../nginxions/backend/nginxions/waf/objects/compare.js";
import { contractCases, forAgentFile, policyYaml, SNORT_RULE } from "../nginxions/backend/nginxions/waf/objects/contract.js";

const [command, dir] = process.argv.slice(2);
if (!["write", "check", "split"].includes(command) || !dir) {
	console.error("usage: policy-contract.mjs write|check|split <dir> [case]");
	process.exit(2);
}

if (command === "write") {
	mkdirSync(dir, { recursive: true });
	const cases = contractCases();
	for (const c of cases) {
		writeFileSync(path.join(dir, `${c.name}.yaml`), policyYaml(c.policy));
		writeFileSync(path.join(dir, `${c.name}.doc.json`), `${JSON.stringify(c.doc, null, 2)}\n`);
	}
	writeFileSync(path.join(dir, "contract.rules"), SNORT_RULE);
	console.log(cases.map((c) => c.name).join("\n"));
	process.exit(0);
}

if (command === "split") {
	const name = process.argv[4];
	const doc = JSON.parse(readFileSync(path.join(dir, `${name}.doc.json`), "utf8"));
	const rules = doc.policies?.specificRules ?? [];
	const parts = [
		["the default rule", []],
		...rules.map((r) => [`the rule ${r.name} (${r.host})`, [r]]),
	];
	parts.forEach(([label, only], i) => {
		const part = { ...doc, policies: { ...doc.policies, specificRules: only } };
		writeFileSync(path.join(dir, `${name}~${i}.yaml`), policyYaml(forAgentFile(part).policy));
		console.log(`${name}~${i}\t${label}`);
	});
	process.exit(0);
}

/** the assets of the configuration of the agent (every rule of the policy is one) */
const assets = (node, out = new Set()) => {
	if (Array.isArray(node)) for (const v of node) assets(v, out);
	else if (node && typeof node === "object") {
		if ("assetName" in node && "practices" in node) out.add(node.assetName);
		for (const v of Object.values(node)) assets(v, out);
	}
	return out;
};

const rows = [];
let failed = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".doc.json")).sort()) {
	const name = file.replace(/\.doc\.json$/, "");
	const doc = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
	const appliedFile = path.join(dir, `${name}.applied.json`);
	const refusal = existsSync(path.join(dir, `${name}.refused.txt`))
		? readFileSync(path.join(dir, `${name}.refused.txt`), "utf8").trim()
		: "";
	let problems = [];
	if (!existsSync(appliedFile)) {
		problems.push("the agent made no configuration of it");
	} else {
		const applied = JSON.parse(readFileSync(appliedFile, "utf8"));
		problems = compareApplied(doc, applied);
		const expected = 1 + (doc.policies?.specificRules?.length ?? 0);
		const found = assets(applied).size;
		if (found < expected) problems.push(`assets: ${found} of ${expected} rules`);
	}
	if (refusal) problems.push(`the agent logged: ${refusal.split("\n").slice(0, 3).join(" / ")}`);
	const culprits = path.join(dir, `${name}.culprits.txt`);
	if (existsSync(culprits)) problems.push(`refused in: ${readFileSync(culprits, "utf8").trim().split("\n").join("; ")}`);
	if (problems.length) failed++;
	rows.push(`| ${name} | ${problems.length ? "❌" : "✅"} | ${problems.join("; ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").slice(0, 600)} |`);
}
const md = [
	"## Contract of the policy with the agent",
	"",
	`${rows.length} policies: ${failed} not applied as written.`,
	"",
	"| policy | result | what differs |",
	"|---|---|---|",
	...rows,
	"",
].join("\n");
writeFileSync(path.join(dir, "contract.md"), md);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
console.log(md);
process.exit(failed || !rows.length ? 1 : 0);
