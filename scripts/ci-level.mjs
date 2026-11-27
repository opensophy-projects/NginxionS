#!/usr/bin/env node
// The depth of a run of CI (ci.yml, job "level"): what runs, from the event, the commit message and the files the
// push changed. docs/DEVSECOPS.md, "Глубина прогона".
//
//   none       a label other than security-scan was put on a pull request
//   fast       lint, types, tests, the policy contract, security.yml (SAST, secrets, SCA, IaC)
//   full       also the images and the tests of the stack (the matrix "stack" of ci.yml, in parallel)
//   extended   the full run and the heavy checks
//
// A push to a branch is full when the message says [full], or when it changes what only the stack tests (the agent,
// deploy/, the Dockerfiles, nginx's rootfs, the test scripts). [smoke:waf], [smoke:crowdsec], [smoke:core], [gui], [dast],
// [waf-score], [upgrade], [chaos], [cluster] in the message build the images and run only those tests. CodeQL for C++ and Go
// runs when their code changed (the extended run and the weekly branch always run them): an incremental scan.
//
//   CHANGED=<file with one path a line, or empty: unknown> EVENT=push REF=refs/heads/x MESSAGE=... node ci-level.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const SUITES = ["smoke-waf", "smoke-crowdsec", "smoke-core", "gui", "waf-score", "upgrade", "chaos", "cluster", "dast"];
const TAGS = {
	"[smoke:waf]": "smoke-waf",
	"[smoke:learning]": "smoke-waf",
	"[smoke:crowdsec]": "smoke-crowdsec",
	"[smoke:core]": "smoke-core",
	"[gui]": "gui",
	"[dast]": "dast",
	"[waf-score]": "waf-score",
	"[upgrade]": "upgrade",
	"[chaos]": "chaos",
	"[cluster]": "cluster",
};
/** what only the tests of the stack check: a change here builds the images */
const STACK = [
	/^openappsec\//,
	/^deploy\//,
	/^nginxions\/Dockerfile$/,
	/^nginxions\/rootfs\//,
	/^nginxions\/crowdsec-seed\//,
	/^scripts\/(test-[^/]+\.sh|ci-stack\.sh|offline-bundle\.sh)$/,
	/^\.github\/workflows\/offline-bundle\.yml$/,
];
/** text only: no build, no test of code */
const DOCS = [/\.md$/i, /^docs\//, /^readme\//, /^LICENSE/, /\.txt$/];
const CPP = [/^openappsec\/.*\.(c|cc|cpp|h|hpp|hh)$/, /^openappsec\/.*CMakeLists\.txt$/, /\.cmake$/];
const GO = [/\.go$/, /(^|\/)go\.(mod|sum)$/];

const any = (files, patterns) => files.some((f) => patterns.some((p) => p.test(f)));

/**
 * @param {{event: string, action?: string, label?: string, labels?: string, input?: string, message?: string,
 *   ref: string, changed: string[]|null}} e  changed: null when unknown (everything is taken as changed)
 */
export const decide = (e) => {
	const labels = `,${e.labels || ""},`;
	const message = e.message || "";
	const tags = [...new Set(Object.keys(TAGS).filter((t) => message.includes(t)).map((t) => TAGS[t]))];
	const changed = e.changed;
	const docsOnly = Array.isArray(changed) && changed.length > 0 && changed.every((f) => DOCS.some((p) => p.test(f)));
	const stack = changed === null || any(changed, STACK);
	let level;
	let reason;
	let suites = SUITES;
	if (e.event === "pull_request" && e.action === "labeled" && e.label !== "security-scan") {
		level = "none";
		reason = "a label other than security-scan";
	} else if (
		e.ref.startsWith("refs/heads/security/") ||
		(e.event === "pull_request" && labels.includes(",security-scan,")) ||
		(e.event === "workflow_dispatch" && e.input === "extended")
	) {
		level = "extended";
		reason = "security/**, the label security-scan or Run workflow";
	} else if (e.event === "workflow_dispatch") {
		level = e.input === "fast" ? "fast" : "full";
		reason = "Run workflow";
	} else if (e.event !== "push" || e.ref === "refs/heads/work" || e.ref.startsWith("refs/tags/")) {
		level = "full";
		reason = "work, a tag or a pull request";
	} else if (message.includes("[full]")) {
		level = "full";
		reason = "[full] in the message";
	} else if (tags.length) {
		level = "full";
		suites = tags;
		reason = `${tags.join(", ")} in the message`;
	} else if (docsOnly) {
		level = "fast";
		reason = "only documentation changed";
	} else if (stack) {
		level = "full";
		reason = changed === null ? "the changed files are unknown" : "a file used by the stack tests changed";
	} else {
		level = "fast";
		reason = "the code of the backend or the frontend only (the images are built with [full])";
	}
	const heavy = level === "extended" || changed === null;
	return {
		level,
		reason,
		suites,
		cpp: heavy || (!docsOnly && any(changed, CPP)),
		go: heavy || (!docsOnly && any(changed, GO)),
		dast: suites.includes("dast"),
	};
};

export const release = (ref) => {
	if (!ref.startsWith("refs/tags/")) return { version: "", tags: "develop" };
	const match = /^refs\/tags\/([vV])((?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8}))$/.exec(ref);
	if (!match) throw new Error("Expected a stable Git tag in the form V1.0.0");
	const [, prefix, number] = match;
	const version = `V${number}`;
	return { version, tags: [...new Set([version, `${prefix}${number}`, number, "latest"])].join(" ") };
};

if (import.meta.url === `file://${process.argv[1]}`) {
	const file = process.env.CHANGED;
	const changed = file && existsSync(file) && readFileSync(file, "utf8").trim()
		? readFileSync(file, "utf8").split("\n").filter(Boolean)
		: null;
	const ref = process.env.GITHUB_REF || process.env.REF || "";
	const build = release(ref);
	const d = decide({
		event: process.env.EVENT,
		action: process.env.ACTION,
		label: process.env.LABEL,
		labels: process.env.LABELS,
		input: process.env.INPUT,
		message: process.env.MESSAGE,
		ref,
		changed,
	});
	const out = [
		`level=${d.level}`,
		`suites=${JSON.stringify(d.suites)}`,
		`cpp=${d.cpp}`,
		`go=${d.go}`,
		`dast=${d.dast}`,
		`release_version=${build.version}`,
		`image_tags=${build.tags}`,
	].join("\n");
	if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `${out}\n`, { flag: "a" });
	const summary = [
		`### Глубина прогона: ${d.level}`,
		"",
		`Почему: ${d.reason}. ${changed ? `Изменено файлов: ${changed.length}.` : "Список изменённых файлов неизвестен."}`,
		d.level === "full" || d.level === "extended" ? `Тесты стека: ${d.suites.join(", ")}.` : "",
		`CodeQL C/C++: ${d.cpp ? "да" : "нет (код не менялся)"}, Go: ${d.go ? "да" : "нет (код не менялся)"}.`,
		"",
	].join("\n");
	if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: "a" });
	console.log(out);
	console.log(summary);
}
