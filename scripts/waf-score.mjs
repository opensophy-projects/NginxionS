#!/usr/bin/env node
// The summary of a GoTestWAF report (scripts/test-waf-score.sh) for the summary of the run: the score, the attacks
// blocked and bypassed, the legitimate requests passed and refused (false positives), per set of tests.
//   node scripts/waf-score.mjs gotestwaf.json [gotestwaf.log]
import { readFileSync } from "node:fs";

const [file, logFile] = process.argv.slice(2);
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
console.log(lines.join("\n"));
