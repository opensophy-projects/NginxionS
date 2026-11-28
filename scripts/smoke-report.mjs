#!/usr/bin/env node
// The report of smoke (deploy/test/smoke.sh): its groups with their result and time, the failed steps, the slowest
// steps. smoke.sh logs each step with the time it started (smoke-steps.tsv: group, step, start, ok|FAIL) and each
// group (smoke-groups.tsv: group, ok|FAIL, seconds); a step lasts until the next one of its group starts.
// Writes <dir>/smoke.md, <dir>/steps.json (the history of flaky steps: scripts/flaky-report.mjs) and the summary.
//
//   node scripts/smoke-report.mjs reports/smoke
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2] || "reports/smoke";
const tsv = (file) =>
	existsSync(path.join(dir, file))
		? readFileSync(path.join(dir, file), "utf8")
				.split("\n")
				.filter(Boolean)
				.map((l) => l.split("\t"))
		: [];

/** the steps with their durations; a FAIL line marks the step of its group running at that time */
export const stepsOf = (rows, groups) => {
	const took = new Map(groups.map(([group, , seconds]) => [group, Number(seconds)]));
	const firstStart = new Map();
	const steps = [];
	const current = new Map();
	for (const [group, name, start, result] of rows) {
		if (!firstStart.has(group)) firstStart.set(group, Number(start));
		if (result === "FAIL") {
			const step = current.get(group);
			if (step) Object.assign(step, { result: "FAIL", error: name.replace(/^FAIL: /, "") });
			continue;
		}
		const step = { group, name, start: Number(start), result: "ok" };
		current.set(group, step);
		steps.push(step);
	}
	return steps.map((s, i) => {
		const next = steps.slice(i + 1).find((n) => n.group === s.group);
		const end = next ? next.start : firstStart.get(s.group) + (took.get(s.group) ?? 0);
		return { ...s, seconds: Math.max(0, end - s.start) };
	});
};

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

function httpOutcome(code) {
	if (code === "403") return "Blocked";
	if (/^2\d\d$/.test(code)) return "Allowed";
	if (code === "000") return "No response";
	return "Unexpected HTTP status";
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const groups = tsv("smoke-groups.tsv");
	const steps = stepsOf(tsv("smoke-steps.tsv"), groups);
	writeFileSync(path.join(dir, "steps.json"), `${JSON.stringify(steps, null, 2)}\n`);
	const failed = steps.filter((s) => s.result === "FAIL");
	const total = groups.reduce((n, [, , took]) => n + Number(took), 0);
	const lines = [
		"## Smoke",
		"",
		`${groups.length} groups, ${steps.length} steps, ${Math.round(total / 60)} min: ${failed.length ? `**${failed.length} failed**` : "all passed"}.`,
		"",
		"| group | result | time |",
		"|---|---|---|",
		...groups.map(([g, r, took]) => `| ${g} | ${r === "ok" ? "✅" : "❌"} | ${Math.round(Number(took) / 6) / 10} min |`),
		"",
	];
	if (failed.length) {
		lines.push("### Failed steps", "", "| group | step | error |", "|---|---|---|");
		for (const s of failed) lines.push(`| ${s.group} | ${esc(s.name)} | ${esc((s.error || "").slice(0, 300))} |`);
		lines.push("");
	}
	const requests = tsv("smoke-http.tsv");
	if (requests.length) {
		lines.push("### WAF HTTP requests", "", "| Scenario | Request | HTTP | Result |", "|---|---|---|---|");
		for (const [scenario, method, host, route, code] of requests) {
			lines.push(`| ${esc(scenario)} | ${esc(`${method} http://${host}${route}`)} | ${esc(code)} | ${httpOutcome(code)} |`);
		}
		lines.push("");
	}
	lines.push("### Slowest steps", "", "| group | step | seconds |", "|---|---|---|");
	for (const s of [...steps].sort((a, b) => b.seconds - a.seconds).slice(0, 10))
		lines.push(`| ${s.group} | ${esc(s.name)} | ${s.seconds} |`);
	const md = `${lines.join("\n")}\n`;
	writeFileSync(path.join(dir, "smoke.md"), md);
	if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
	console.log(md);
}
