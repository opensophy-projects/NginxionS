#!/usr/bin/env node
// Flaky steps of smoke over the last runs of CI (the nightly workflow downloads their artifacts tests-smoke-*): for
// each step, how many runs it was in, how often it failed, its time. A step that failed on a commit where it passed
// in another run is flaky: a race to fix, not a bug of the change. Report: <out>/flaky.md and the summary.
//
//   node scripts/flaky-report.mjs <dir: <run id>[-<sha>]/**/steps.json> [--out dir]
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const walk = (dir) =>
	readdirSync(dir).flatMap((f) => {
		const p = path.join(dir, f);
		return statSync(p).isDirectory() ? walk(p) : [p];
	});

/**
 * @param {{run: string, sha: string, steps: {group: string, name: string, result: string, seconds: number}[]}[]} runs
 */
export const flaky = (runs) => {
	const byStep = new Map();
	for (const { run, sha, steps } of runs) {
		for (const s of steps) {
			const key = `${s.group}\t${s.name}`;
			const e = byStep.get(key) ?? { group: s.group, name: s.name, runs: 0, failed: 0, seconds: [], shas: new Map() };
			e.runs++;
			if (s.result === "FAIL") e.failed++;
			e.seconds.push(s.seconds);
			const r = e.shas.get(sha) ?? { ok: 0, fail: 0, runs: [] };
			r[s.result === "FAIL" ? "fail" : "ok"]++;
			r.runs.push(run);
			e.shas.set(sha, r);
			byStep.set(key, e);
		}
	}
	return [...byStep.values()]
		.map((e) => {
			const sorted = [...e.seconds].sort((a, b) => a - b);
			return {
				group: e.group,
				name: e.name,
				runs: e.runs,
				failed: e.failed,
				rate: e.runs ? e.failed / e.runs : 0,
				median: sorted[Math.floor(sorted.length / 2)] ?? 0,
				max: sorted.at(-1) ?? 0,
				// failed and passed on the same commit: the code did not change, the result did
				flaky: [...e.shas.values()].some((r) => r.ok && r.fail),
			};
		})
		.sort((a, b) => b.failed - a.failed || b.max - a.max);
};

if (import.meta.url === `file://${process.argv[1]}`) {
	const dir = process.argv[2];
	const i = process.argv.indexOf("--out");
	const out = i > 0 ? process.argv[i + 1] : dir;
	const runs = [];
	for (const runDir of readdirSync(dir)) {
		const p = path.join(dir, runDir);
		if (!statSync(p).isDirectory()) continue;
		const [run, sha = run] = runDir.split("-");
		const steps = walk(p)
			.filter((f) => path.basename(f) === "steps.json")
			.flatMap((f) => JSON.parse(readFileSync(f, "utf8")));
		if (steps.length) runs.push({ run, sha, steps });
	}
	const rows = flaky(runs);
	const failing = rows.filter((r) => r.failed);
	const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
	const md = [
		"## Flaky steps of smoke",
		"",
		`${runs.length} runs of CI, ${rows.length} steps: ${failing.length} failed at least once, ${rows.filter((r) => r.flaky).length} flaky (failed and passed on one commit).`,
		"",
		"| group | step | failed | runs | flaky | median, s | max, s |",
		"|---|---|---|---|---|---|---|",
		...failing.map(
			(r) =>
				`| ${r.group} | ${esc(r.name)} | ${r.failed} (${Math.round(r.rate * 100)} %) | ${r.runs} | ${r.flaky ? "⚠️ yes" : ""} | ${r.median} | ${r.max} |`,
		),
		"",
		"### Slowest steps (median)",
		"",
		"| group | step | median, s | max, s |",
		"|---|---|---|---|",
		...[...rows]
			.sort((a, b) => b.median - a.median)
			.slice(0, 15)
			.map((r) => `| ${r.group} | ${esc(r.name)} | ${r.median} | ${r.max} |`),
		"",
	].join("\n");
	mkdirSync(out, { recursive: true });
	writeFileSync(path.join(out, "flaky.md"), md);
	writeFileSync(path.join(out, "flaky.json"), `${JSON.stringify(rows, null, 2)}\n`);
	if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
	console.log(md);
}
