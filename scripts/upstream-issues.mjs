#!/usr/bin/env node
// Issues of the upstream repositories of the agent (openappsec/*) copied into this repository as issues, so that
// the bugs reported upstream are seen here (.github/workflows/upstream-issues.yml, hourly).
//
// - every open upstream issue gets one copy (pull requests are left out); its state follows upstream: closed when
//   upstream closes it, reopened when upstream reopens it; a copy closed here with a verdict (any label besides the
//   two of upstream: duplicate, invalid, fix complete...) stays closed, what upstream does with the issue;
// - a copy is found again by the marker <!-- upstream: owner/repo#N --> in its body, labels "upstream" and
//   "upstream:<repo>";
// - the text is upstream's, untrusted: @mentions are broken (no one upstream is notified from here), #N becomes
//   owner/repo#N (not an issue of this repository), it is quoted and cut to fit an issue;
// - at most MAX_CREATE copies per run (the first run of a repository with many open issues spreads over a few
//   hours instead of hitting the limits of GitHub for content creation).
//
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo node scripts/upstream-issues.mjs
//   DRY_RUN=1 node scripts/upstream-issues.mjs     # reads upstream, changes nothing, prints what it would do

export const UPSTREAM = [
	"openappsec/smartsync-shared-files",
	"openappsec/openappsec",
	"openappsec/attachment",
	"openappsec/smartsync",
	"openappsec/smartsync-tuning",
];
const API = "https://api.github.com";
const MAX_BODY = 60000;
const LABEL = "upstream";
const repoLabel = (repo) => `upstream:${repo.split("/")[1]}`;
export const marker = (repo, number) => `<!-- upstream: ${repo}#${number} -->`;
const MARKER = /<!-- upstream: ([\w.-]+\/[\w.-]+)#(\d+) -->/;

/** the text of an upstream issue, safe to post here */
export const neutralize = (text, repo) =>
	String(text ?? "")
		// @user and @org/team: a zero-width joiner after "@" keeps the text and notifies no one
		.replace(/(^|[^\w`])@(?=[A-Za-z0-9-])/g, "$1@‍")
		// #123 alone refers to an issue of this repository: name the upstream one
		.replace(/(^|[^\w/&#])#(\d+)\b/g, `$1${repo}#$2`);

/** the body of the copy of an upstream issue */
export const copyBody = (repo, issue) => {
	const labels = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean);
	const head = [
		marker(repo, issue.number),
		`**Upstream:** ${issue.html_url}`,
		`**Opened by** \`${issue.user?.login ?? "unknown"}\` on ${String(issue.created_at).slice(0, 10)}` +
			(labels.length ? ` · labels: ${labels.map((l) => `\`${l}\``).join(", ")}` : ""),
		"",
		"> Copied automatically from the upstream repository of the agent (scripts/upstream-issues.mjs). " +
			"The discussion stays upstream; this copy follows its state.",
		"",
		"---",
		"",
	].join("\n");
	let body = neutralize(issue.body || "_(no description)_", repo);
	const room = MAX_BODY - head.length - 200;
	if (body.length > room) body = `${body.slice(0, room)}\n\n… _(cut, the full text is upstream)_`;
	return head + body;
};

export const copyTitle = (repo, issue) => `[${repo.split("/")[1]}#${issue.number}] ${issue.title}`.slice(0, 250);

const request = async (token, method, path, body) => {
	const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
		method,
		headers: {
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "nginxions-upstream-issues",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(30000),
	});
	if (!res.ok && res.status !== 422) {
		throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
	}
	const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
	return { status: res.status, data: res.status === 204 ? null : await res.json(), next };
};

const all = async (token, path) => {
	const out = [];
	for (let url = path; url; ) {
		const { data, next } = await request(token, "GET", url);
		out.push(...data);
		url = next;
	}
	return out;
};

/** a copy closed here with a verdict of its own: a label that is not one of upstream */
const decided = (copy) => (copy.labels ?? []).some((l) => l !== LABEL && !l.startsWith(`${LABEL}:`));

/**
 * What to do: copies to create, copies to close or reopen.
 * @param {Map<string, {number: number, state: string, labels?: string[]}>} copies  "owner/repo#N" → our issue
 * @param {{repo: string, issues: object[]}[]} upstream  open issues and those closed recently
 */
export const plan = (copies, upstream) => {
	const create = [];
	const close = [];
	const reopen = [];
	for (const { repo, issues } of upstream) {
		for (const issue of issues) {
			if (issue.pull_request) continue;
			const key = `${repo}#${issue.number}`;
			const copy = copies.get(key);
			if (!copy) {
				if (issue.state === "open") create.push({ repo, issue });
			} else if (issue.state === "closed" && copy.state === "open") close.push({ repo, issue, copy });
			else if (issue.state === "open" && copy.state === "closed" && !decided(copy)) reopen.push({ repo, issue, copy });
		}
	}
	// the oldest first: the copies get numbers in the order upstream opened them
	create.sort((a, b) => String(a.issue.created_at).localeCompare(String(b.issue.created_at)));
	return { create, close, reopen };
};

const main = async () => {
	const token = process.env.GITHUB_TOKEN;
	const target = process.env.GITHUB_REPOSITORY;
	const dry = process.env.DRY_RUN === "1";
	const maxCreate = Number(process.env.MAX_CREATE || 30);
	if (!dry && (!token || !target)) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are needed (or DRY_RUN=1)");

	// the copies already here
	const copies = new Map();
	if (target && token) {
		for (const i of await all(token, `/repos/${target}/issues?labels=${LABEL}&state=all&per_page=100`)) {
			const m = MARKER.exec(i.body ?? "");
			if (m)
				copies.set(`${m[1]}#${m[2]}`, {
					number: i.number,
					state: i.state,
					labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)),
				});
		}
	}

	// open upstream issues, and those updated in the last 3 days (closed ones: their copies are closed too)
	const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
	const upstream = [];
	for (const repo of UPSTREAM) {
		const open = await all(token, `/repos/${repo}/issues?state=open&per_page=100`);
		const recent = await all(token, `/repos/${repo}/issues?state=closed&since=${since}&per_page=100`);
		upstream.push({ repo, issues: [...open, ...recent] });
	}
	const todo = plan(copies, upstream);
	console.log(
		`copies here: ${copies.size}; to create: ${todo.create.length} (at most ${maxCreate} now), ` +
			`to close: ${todo.close.length}, to reopen: ${todo.reopen.length}`,
	);
	if (dry) {
		for (const { repo, issue } of todo.create.slice(0, maxCreate)) console.log(`create  ${copyTitle(repo, issue)}`);
		for (const { repo, issue, copy } of todo.close) console.log(`close   #${copy.number} (${repo}#${issue.number})`);
		for (const { repo, issue, copy } of todo.reopen) console.log(`reopen  #${copy.number} (${repo}#${issue.number})`);
		return;
	}

	// the labels, once
	const labels = [LABEL, ...UPSTREAM.map(repoLabel)];
	for (const name of labels) {
		await request(token, "POST", `/repos/${target}/labels`, {
			name,
			color: name === LABEL ? "5319e7" : "d4c5f9",
			description: "Copied from an upstream repository of the agent (openappsec)",
		});
	}

	for (const { repo, issue } of todo.create.slice(0, maxCreate)) {
		const { data } = await request(token, "POST", `/repos/${target}/issues`, {
			title: copyTitle(repo, issue),
			body: copyBody(repo, issue),
			labels: [LABEL, repoLabel(repo)],
		});
		console.log(`created #${data.number} ← ${repo}#${issue.number}`);
		// GitHub limits the creation of content: one issue a second at most
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	for (const { repo, issue, copy } of todo.close) {
		await request(token, "POST", `/repos/${target}/issues/${copy.number}/comments`, {
			body: `Closed upstream: ${issue.html_url}`,
		});
		await request(token, "PATCH", `/repos/${target}/issues/${copy.number}`, {
			state: "closed",
			state_reason: issue.state_reason === "not_planned" ? "not_planned" : "completed",
		});
		console.log(`closed #${copy.number} ← ${repo}#${issue.number}`);
	}
	for (const { repo, issue, copy } of todo.reopen) {
		await request(token, "PATCH", `/repos/${target}/issues/${copy.number}`, { state: "open" });
		console.log(`reopened #${copy.number} ← ${repo}#${issue.number}`);
	}
};

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(err.message);
		process.exit(1);
	});
}
