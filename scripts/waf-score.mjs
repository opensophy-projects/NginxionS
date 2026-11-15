#!/usr/bin/env node
// The summary of a GoTestWAF report (scripts/test-waf-score.sh) for the summary of the run: the score, the attacks
// blocked and bypassed, the legitimate requests passed and refused (false positives), per set of tests.
// With --baseline <file> (.github/security/waf-baseline.json) the score is held to the baseline: lower than it by more
// than its tolerance fails (exit 1), so a change that weakens the protection is seen by a number.
//   node scripts/waf-score.mjs gotestwaf.json [gotestwaf.log] [--baseline file]
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const bi = args.indexOf("--baseline");
const baselineFile = bi === -1 ? null : args[bi + 1];
const [file, logFile] = args.filter((a, i) => !a.startsWith("--") && (bi === -1 || i !== bi + 1));
const report = JSON.parse(readFileSync(file, "utf8"));
const num = (v) => (typeof v === "number" ? v : Number.parseFloat(v));
const pct = (v) => (Number.isFinite(num(v)) ? `${num(v).toFixed(1)} %` : "—");

/** the summaries of tests anywhere in the report: objects with counts of sent, blocked and bypassed requests */
const summaries = [];
const walk = (node, trail) => {
	if (!node || typeof node !== "object") return;
	const keys = Object.keys(node);
	if (keys.some((k) => /blocked/i.test(k)) && keys.some((k) => /bypass|passed|sent|total/i.test(k))) {
		summaries.push({ trail: trail.join(" / "), node });
	}
	for (const [k, v] of Object.entries(node)) walk(v, [...trail, k]);
};
walk(report, []);

const lines = ["## WAF score (GoTestWAF)", ""];
const score = report.score ?? report.Score ?? report.summary?.score;
if (score !== undefined) lines.push(`**Score: ${pct(score)}**`, "");
const fields = (n) =>
	Object.entries(n)
		.filter(([, v]) => typeof v === "number" || (typeof v === "string" && /^[\d.]+$/.test(v)))
		.map(([k, v]) => `${k}: ${v}`)
		.join(", ");
const top = summaries.filter((s) => s.trail.split(" / ").length <= 4).slice(0, 12);
if (top.length) {
	lines.push("| tests | counts |", "|---|---|");
	for (const s of top) lines.push(`| ${s.trail || "all"} | ${fields(s.node)} |`);
	lines.push("");
}
if (logFile) {
	try {
		const text = readFileSync(logFile, "utf8");
		const interesting = text
			.split("\n")
			.filter((l) => /score|true-positive|true-negative|blocked|bypassed|false positive/i.test(l))
			.slice(-20);
		if (interesting.length) lines.push("```", ...interesting, "```");
	} catch {
		// no log
	}
}
let failed = false;
if (baselineFile) {
	const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
	const min = baseline.score - baseline.tolerance;
	if (!Number.isFinite(num(score))) {
		lines.push("", "**FAIL:** the report has no score to hold to the baseline");
		failed = true;
	} else if (num(score) < min) {
		lines.push(
			"",
			`**FAIL:** the score ${pct(score)} is under the baseline ${pct(baseline.score)} minus ${baseline.tolerance} (${pct(min)}): the protection got weaker. If on purpose, lower the baseline in ${baselineFile} with the reason.`,
		);
		failed = true;
	} else {
		const better = num(score) > baseline.score + baseline.tolerance;
		lines.push(
			"",
			`Baseline ${pct(baseline.score)} ± ${baseline.tolerance}: ${better ? `**better** — raise it in ${baselineFile}` : "held"}.`,
		);
	}
}
console.log(lines.join("\n"));
process.exit(failed ? 1 : 0);
