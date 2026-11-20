// The coverage of the code by the tests, every kind of test together, and its ratchet (docs/DEVSECOPS.md, «Покрытие»):
//
//   backend    the unit tests (lcov of `node --test`, artifact security-quality) and the tests of the stack: what the
//              backend ran during smoke, the interface in a browser and driven like a user (raw V8 coverage that
//              scripts/test-airgap.sh collects into reports/**/coverage-stack/backend). A line run by either counts.
//              Every file of nginxions/backend/nginxions is counted, a file no test loaded too (0 %).
//   frontend   vitest (coverage-frontend/coverage-summary.json)
//   go/<svc>   go test of the services of the agent (coverage-go-<svc>.txt)
//
// The ratchet: no part may fall more than 0.5 point under .github/coverage-baseline.json (a part with no baseline, or
// not measured in this run, is only reported). The backend of the stack is compared only when every test of the stack
// that runs the backend gave its coverage (a run of chosen tests covers less on purpose). Raise the baseline with
// --update when the coverage went up.
//
//   node scripts/coverage-report.mjs --in reports [--baseline .github/coverage-baseline.json] [--update] [--out dir]
//   node scripts/coverage-report.mjs --trim reports/coverage-stack/backend    (keeps only our scripts: smaller files)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BACKEND = join(ROOT, "nginxions/backend");
/** the code of NginxionS in the backend (the code of NPMplus is not ours to cover) */
const OURS = "nginxions/";
const TOLERANCE = 0.5;
/** the tests of the stack that run the backend: all of them must have given coverage for the ratchet of the stack */
export const STACK_SUITES = ["smoke-waf", "smoke-crowdsec", "smoke-core", "gui"];

const walk = (dir, out = []) => {
	let names;
	try {
		names = readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of names) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
};

/** a source file of ours: not a test, not test data */
export const counted = (rel) => rel.startsWith(OURS) && rel.endsWith(".js") && !/\.test\.js$/.test(rel) && !rel.startsWith(`${OURS}test/`);

/** lines that hold code: not blank, not only a comment, not only brackets and punctuation */
export function codeLines(source) {
	const lines = source.split("\n");
	const out = new Set();
	let inBlock = false;
	lines.forEach((raw, i) => {
		let line = raw.trim();
		if (inBlock) {
			const end = line.indexOf("*/");
			if (end < 0) return;
			line = line.slice(end + 2).trim();
			inBlock = false;
		}
		if (line.startsWith("/*")) {
			const end = line.indexOf("*/", 2);
			if (end < 0) {
				inBlock = true;
				return;
			}
			line = line.slice(end + 2).trim();
		}
		if (!line || line.startsWith("//")) return;
		if (/^[\s{}()[\];,]*$/.test(line)) return;
		out.add(i + 1);
	});
	return out;
}

/**
 * Line hits from the V8 coverage of one script: each line gets the count of the innermost range that holds its first
 * character of code (a function, then its blocks, nested). Lines out of every range are not reported.
 * @param {string} source
 * @param {{functions: {ranges: {startOffset: number, endOffset: number, count: number}[]}[]}} script
 * @returns {Map<number, number>} line (1-based) → count
 */
export function v8LineHits(source, script) {
	const ranges = script.functions.flatMap((f) => f.ranges);
	const hits = new Map();
	let offset = 0;
	const lines = source.split("\n");
	lines.forEach((line, i) => {
		const first = offset + (line.length - line.trimStart().length);
		let best;
		for (const r of ranges) {
			if (r.startOffset <= first && first < r.endOffset) {
				if (!best || r.endOffset - r.startOffset < best.endOffset - best.startOffset) best = r;
			}
		}
		if (best) hits.set(i + 1, best.count);
		offset += line.length + 1;
	});
	return hits;
}

/** lcov → Map(rel path → Map(line → hits)) for the files of the backend */
export function parseLcov(text, base = BACKEND) {
	const files = new Map();
	let cur;
	for (const line of text.split("\n")) {
		if (line.startsWith("SF:")) {
			const sf = line.slice(3).trim();
			const rel = sf.startsWith("/") ? relative(base, sf) : sf.replace(/^nginxions\/backend\//, "");
			cur = new Map();
			files.set(rel, cur);
		} else if (line.startsWith("DA:") && cur) {
			const [n, h] = line.slice(3).split(",");
			cur.set(Number(n), Math.max(cur.get(Number(n)) ?? 0, Number(h)));
		}
	}
	return files;
}

/** the files of raw V8 coverage of the backend → Map(rel path → Map(line → hits)), merged (max of the hits) */
export function stackHits(jsonFiles, base = BACKEND) {
	const files = new Map();
	for (const f of jsonFiles) {
		let doc;
		try {
			doc = JSON.parse(readFileSync(f, "utf8"));
		} catch {
			continue;
		}
		for (const script of doc.result ?? []) {
			// the backend is /app in the image (nginxions/Dockerfile)
			const m = /^file:\/\/\/app\/(.+)$/.exec(script.url ?? "");
			if (!m || !counted(m[1])) continue;
			// read without a check before (a check then a read is a race: CodeQL js/file-system-race)
			let source;
			try {
				source = readFileSync(join(base, m[1]), "utf8");
			} catch {
				continue;
			}
			const hits = v8LineHits(source, script);
			const into = files.get(m[1]) ?? new Map();
			for (const [n, h] of hits) into.set(n, Math.max(into.get(n) ?? 0, h));
			files.set(m[1], into);
		}
	}
	return files;
}

/** lines of each file of ours and whether they ran: the code lines of the source, hit by the unit tests or the stack */
export function mergeBackend({ unit, stack, base = BACKEND }) {
	const sources = walk(join(base, OURS))
		.map((p) => relative(base, p))
		.filter(counted);
	const perFile = [];
	for (const rel of sources) {
		const code = codeLines(readFileSync(join(base, rel), "utf8"));
		const u = unit.get(rel);
		const s = stack.get(rel);
		// the lines node --test reports for the file when it has them, else the code lines of the source
		const lines = u ? new Set(u.keys()) : code;
		let hit = 0;
		let hitUnit = 0;
		for (const n of lines) {
			const byUnit = (u?.get(n) ?? 0) > 0;
			const byStack = (s?.get(n) ?? 0) > 0;
			if (byUnit) hitUnit++;
			if (byUnit || byStack) hit++;
		}
		perFile.push({ file: rel, lines: lines.size, hit, hitUnit });
	}
	const sum = (k) => perFile.reduce((a, f) => a + f[k], 0);
	const total = sum("lines");
	return {
		perFile,
		total,
		all: total ? (sum("hit") / total) * 100 : 0,
		unitOnly: total ? (sum("hitUnit") / total) * 100 : 0,
	};
}

const pct = (n) => (n == null ? "—" : `${n.toFixed(1)} %`);

/** keeps only the scripts of ours in raw V8 coverage files (the rest, node_modules and Node, is most of their size) */
export function trim(dir) {
	for (const f of walk(dir).filter((x) => x.endsWith(".json"))) {
		try {
			const doc = JSON.parse(readFileSync(f, "utf8"));
			doc.result = (doc.result ?? []).filter((s) => /^file:\/\/\/app\/nginxions\//.test(s.url ?? ""));
			delete doc["source-map-cache"];
			writeFileSync(f, JSON.stringify(doc));
		} catch {}
	}
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === "--trim") {
	trim(process.argv[3]);
	process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const arg = (name, def) => {
		const i = process.argv.indexOf(name);
		return i > 0 ? process.argv[i + 1] : def;
	};
	const IN = arg("--in", "reports");
	const OUT = arg("--out", join(IN, "coverage"));
	const BASELINE = arg("--baseline", join(ROOT, ".github/coverage-baseline.json"));
	const update = process.argv.includes("--update");
	const files = walk(IN);

	const parts = {};
	const lcov = files.find((f) => f.endsWith("lcov-backend.info"));
	const v8 = files.filter((f) => /coverage-stack[/\\]backend[/\\].+\.json$/.test(f));
	// the tests of the stack that gave coverage: reports/<artifact tests-<suite>>/coverage-stack/...
	const suites = new Set(v8.map((f) => /tests-([a-z-]+)[/\\]/.exec(f)?.[1]).filter(Boolean));
	if (lcov || v8.length) {
		const merged = mergeBackend({ unit: lcov ? parseLcov(readFileSync(lcov, "utf8")) : new Map(), stack: stackHits(v8) });
		if (lcov) parts["backend (unit)"] = merged.unitOnly;
		const complete = STACK_SUITES.every((s) => suites.has(s));
		if (lcov && v8.length) parts[complete ? "backend (unit + stack)" : "backend (unit + some tests of the stack)"] = merged.all;
		mkdirSync(OUT, { recursive: true });
		writeFileSync(
			join(OUT, "coverage-backend.tsv"),
			`file\tlines\thit\thit by unit tests\n${merged.perFile.map((f) => `${f.file}\t${f.lines}\t${f.hit}\t${f.hitUnit}`).join("\n")}\n`,
		);
	}
	const fe = files.find((f) => f.endsWith("coverage-frontend/coverage-summary.json"));
	if (fe) parts.frontend = JSON.parse(readFileSync(fe, "utf8")).total.lines.pct;
	for (const f of files.filter((x) => /coverage-go-([a-z-]+)\.txt$/.test(x))) {
		const svc = /coverage-go-([a-z-]+)\.txt$/.exec(f)[1];
		const total = /total:\s+\(statements\)\s+([\d.]+)%/.exec(readFileSync(f, "utf8"));
		if (total) parts[`go/${svc}`] = Number(total[1]);
	}

	let baseline = {};
	try {
		baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
	} catch {}
	const failures = [];
	const rows = Object.entries(parts).map(([name, value]) => {
		const base = typeof baseline[name] === "number" ? baseline[name] : undefined;
		const drop = base != null && value < base - TOLERANCE;
		if (drop) failures.push(`${name}: ${pct(value)}, the baseline is ${pct(base)}`);
		return `| ${name} | ${pct(value)} | ${pct(base)} | ${drop ? "❌ fell" : base == null ? "—" : value > base + TOLERANCE ? "⬆ raise the baseline" : "✅"} |`;
	});
	const md = [
		"## Coverage of the code by the tests",
		"",
		`Tests of the stack with coverage: ${[...suites].join(", ") || "none"}.`,
		"",
		"| part | lines | baseline | |",
		"|---|---|---|---|",
		...rows,
		"",
		failures.length ? `**FAIL:** ${failures.join("; ")}` : "**OK**",
		"",
	].join("\n");
	console.log(md);
	mkdirSync(OUT, { recursive: true });
	writeFileSync(join(OUT, "coverage.md"), md);
	if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
	if (update) {
		for (const [name, value] of Object.entries(parts)) {
			if (name.includes("some tests")) continue;
			if (baseline[name] == null || value > baseline[name]) baseline[name] = Math.floor(value * 10) / 10;
		}
		writeFileSync(BASELINE, `${JSON.stringify(baseline, null, "\t")}\n`);
		console.log(`baseline updated: ${BASELINE}`);
	}
	process.exit(failures.length ? 1 : 0);
}
