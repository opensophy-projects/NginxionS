#!/usr/bin/env node
// Audit of the logs of a test stack (scripts/test-airgap.sh): every error and warning of the containers, of the debug
// logs of the agent (/var/log/nano_agent) and of nginx, reduced to a signature (no times, addresses, numbers, ids),
// counted and compared with deploy/test/log-allowlist.tsv, where each known line says why it is not a bug. A new
// signature is what an engineer reading the logs would ask about: it goes into the report (and fails the run with
// --gate).
//
//   node scripts/audit-logs.mjs <dir of *.log> [--allowlist file] [--out dir] [--gate]
//
// A file <name>.log is the log of a source (a container, agent-debug...); its name is the source in the report.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : args[i + 1];
};
const dir = args.find((a, i) => !a.startsWith("--") && !["--allowlist", "--out"].includes(args[i - 1]));
const allowlistFile = opt("--allowlist", "deploy/test/log-allowlist.tsv");
const outDir = opt("--out", dir);
const gate = args.includes("--gate");

/** the level and the message of a line, or null when it is no error or warning */
export const classify = (line) => {
	let m;
	// debug log of the agent: [time: : <thread> function@file:line | ###] message; ### a warning, !!! an error
	m = line.match(/^\[[^\]]*?<\d+>\s+(\S+@\S+?):\d+\s*\|\s*(###|!!!|\*\*\*)\]\s*(.*)$/);
	if (m) return { level: m[2] === "###" ? "warning" : "error", where: m[1], message: m[3] };
	// JSON logs of the agent and of its Go services
	if (line.includes('"eventLogLevel"')) {
		const json = line.slice(line.indexOf("{"));
		try {
			const e = JSON.parse(json);
			const level = String(e.eventLogLevel || "").toLowerCase();
			if (level !== "error" && level !== "warning" && level !== "critical") return null;
			const where = e.eventSource?.issuingFunction || e.eventName || "";
			const message = e.eventData?.eventMessage || e.eventName || "";
			return { level: level === "warning" ? "warning" : "error", where, message };
		} catch {
			return null;
		}
	}
	// CrowdSec (logrus): level=error msg="..."
	m = line.match(/level=(error|fatal|panic|warning)\s+msg="((?:[^"\\]|\\.)*)"/);
	if (m) return { level: m[1] === "warning" ? "warning" : "error", where: "", message: m[2] };
	// nginx: 2026/11/14 10:00:00 [error] 12#12: *34 message, client: ..., server: ...
	m = line.match(/\[(error|crit|alert|emerg|warn)\]\s+\d+#\d+:\s*(?:\*\d+\s+)?(.*)$/);
	if (m) {
		const message = m[2].replace(/,\s*(client|server|request|upstream|host|referrer):.*$/, "");
		return { level: m[1] === "warn" ? "warning" : "error", where: "nginx", message };
	}
	// the backend of NginxionS and NPMplus (signale): [Scope] › ✖  error  message
	m = line.match(/\[([^\]]+)\]\s+›\s+\S+\s+(error|warning|fatal)\s+(.*)$/);
	if (m) return { level: m[2] === "warning" ? "warning" : "error", where: m[1].trim(), message: m[3] };
	// PostgreSQL
	m = line.match(/\b(ERROR|FATAL|PANIC|WARNING):\s+(.*)$/);
	if (m) return { level: m[1] === "WARNING" ? "warning" : "error", where: "postgres", message: m[2] };
	// anything else that crashed
	if (/\b(panic:|segmentation fault|core dumped|Traceback \(most recent call last\)|Unhandled(Promise)?Rejection)/i.test(line))
		return { level: "error", where: "", message: line.trim() };
	return null;
};

/** the message without what changes from one line to the next */
export const normalize = (text) =>
	String(text)
		.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
		.replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?\b/g, "<time>")
		.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "<ip>")
		.replace(/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi, "<ip6>")
		.replace(/\b[0-9a-f]{12,}\b/gi, "<hex>")
		.replace(/\d+/g, "N")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 240);

/** allowlist: source <TAB> regular expression of the signature <TAB> why it is not a bug */
export const parseAllowlist = (text) =>
	text
		.split("\n")
		.filter((l) => l.trim() && !l.startsWith("#"))
		.map((l) => {
			const [source, pattern, reason] = l.split("\t");
			return { source: source.trim(), re: new RegExp(pattern), reason: (reason || "").trim() };
		});

export const audit = (files, allowlist) => {
	const found = new Map();
	for (const { source, text } of files) {
		for (const line of text.split("\n")) {
			const c = classify(line);
			if (!c) continue;
			const signature = normalize(`${c.where ? `${c.where}: ` : ""}${c.message}`);
			const key = `${source}\t${c.level}\t${signature}`;
			const entry = found.get(key) ?? { source, level: c.level, signature, count: 0, sample: line.trim().slice(0, 400) };
			entry.count++;
			found.set(key, entry);
		}
	}
	return [...found.values()]
		.map((e) => {
			const known = allowlist.find((a) => (a.source === "*" || a.source === e.source) && a.re.test(e.signature));
			return { ...e, known: !!known, reason: known?.reason ?? "" };
		})
		.sort((a, b) => Number(a.known) - Number(b.known) || (a.level === b.level ? b.count - a.count : a.level === "error" ? -1 : 1));
};

// a cell of a Markdown table: backslashes first, then the pipes that would end the cell
const md = (s) => String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/`/g, "'");

export const report = (entries) => {
	const fresh = entries.filter((e) => !e.known);
	const lines = [
		"## Logs of the test stack",
		"",
		`${entries.length} kinds of errors and warnings: ${fresh.length} new, ${entries.length - fresh.length} known (deploy/test/log-allowlist.tsv).`,
		"",
	];
	if (fresh.length) {
		lines.push("### New", "", "| source | level | count | signature | example |", "|---|---|---|---|---|");
		for (const e of fresh) lines.push(`| ${e.source} | ${e.level} | ${e.count} | \`${md(e.signature)}\` | ${md(e.sample.slice(0, 200))} |`);
		lines.push("");
	}
	const known = entries.filter((e) => e.known);
	if (known.length) {
		lines.push("### Known", "", "| source | level | count | signature | why |", "|---|---|---|---|---|");
		for (const e of known) lines.push(`| ${e.source} | ${e.level} | ${e.count} | \`${md(e.signature)}\` | ${md(e.reason)} |`);
	}
	return `${lines.join("\n")}\n`;
};

if (import.meta.url === `file://${process.argv[1]}`) {
	if (!dir) {
		console.error("usage: audit-logs.mjs <dir> [--allowlist file] [--out dir] [--gate]");
		process.exit(2);
	}
	let allowlist = [];
	try {
		allowlist = parseAllowlist(readFileSync(allowlistFile, "utf8"));
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}
	const files = readdirSync(dir)
		.filter((f) => f.endsWith(".log"))
		.map((f) => ({ source: f.replace(/\.log$/, ""), text: readFileSync(path.join(dir, f), "utf8") }));
	const entries = audit(files, allowlist);
	mkdirSync(outDir, { recursive: true });
	writeFileSync(path.join(outDir, "log-audit.json"), `${JSON.stringify(entries, null, 2)}\n`);
	const text = report(entries);
	writeFileSync(path.join(outDir, "log-audit.md"), text);
	if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, text, { flag: "a" });
	const fresh = entries.filter((e) => !e.known);
	console.log(`log audit: ${entries.length} kinds, ${fresh.length} new`);
	for (const e of fresh.slice(0, 40)) console.log(`  NEW ${e.source} ${e.level} x${e.count}: ${e.signature}`);
	if (gate && fresh.length) process.exit(1);
}
