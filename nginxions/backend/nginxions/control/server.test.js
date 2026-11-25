import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const project = "control-test";
const projectLabel = "com.docker.compose.project";
const serviceLabel = "com.docker.compose.service";
const managedLabel = "nginxions.managed";
const managed = (service, extra = {}) => ({
	Id: service,
	Names: [`/${service}`],
	Labels: { [projectLabel]: project, [serviceLabel]: service, [managedLabel]: "true" },
	Image: "local/test:1",
	State: "running",
	Status: "Up",
	...extra,
});
const agent = managed("openappsec", { NetworkSettings: { Networks: { edge: { IPAddress: "192.0.2.2" } } } });
const crowdsec = managed("crowdsec", {
	Ports: [
		{ PrivatePort: 81, Type: "tcp" },
		{ PrivatePort: 80, Type: "tcp" },
		{ PrivatePort: 80, Type: "tcp", PublicPort: 8080 },
	],
});
const apps = [
	agent,
	managed("application", {
		Labels: { [projectLabel]: "other-project" },
		NetworkSettings: { Networks: { edge: { IPAddress: "192.0.2.3" }, internal: { IPAddress: "192.0.2.4" } } },
	}),
	managed("unrelated", { Labels: {}, NetworkSettings: { Networks: { separate: { IPAddress: "192.0.2.5" } } } }),
];
const asJson = (res, body, statusCode = 200) => {
	res.writeHead(statusCode, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
};
const frame = (stream, text) => {
	const header = Buffer.alloc(8);
	header[0] = stream;
	header.writeUInt32BE(Buffer.byteLength(text), 4);
	return Buffer.concat([header, Buffer.from(text)]);
};

async function launch(env, onCleanup) {
	const child = spawn(process.execPath, [fileURLToPath(new URL("./server.js", import.meta.url))], {
		env,
		stdio: ["ignore", "pipe", "inherit"],
	});
	onCleanup(async () => {
		if (child.pid && child.exitCode === null && child.signalCode === null) {
			const exited = once(child, "exit");
			child.kill("SIGTERM");
			await exited;
		}
	});
	const lines = createInterface({ input: child.stdout });
	const [line] = await Promise.race([
		once(lines, "line"),
		once(child, "exit").then(([status]) => {
			throw new Error(`nginxions-control exited with ${status}`);
		}),
	]);
	return { child, address: JSON.parse(line).address };
}

describe("nginxions-control over HTTP with a fixture Docker socket", () => {
	let dir;
	let docker;
	let stopServer;
	let environment;
	let base;
	let policyArchive;
	let archiveState = "present";
	let largeLogs = false;
	let agentStartedAt;
	let dependentRestarted;
	const dependent = managed("nginxions", { HostConfig: { NetworkMode: "container:openappsec" } });
	const outsideProject = managed("foreign", {
		Labels: { [projectLabel]: "other-project", [serviceLabel]: "foreign", [managedLabel]: "true" },
	});
	const unmanaged = managed("sidecar", { Labels: { [projectLabel]: project, [serviceLabel]: "sidecar" } });
	const token = randomBytes(32).toString("hex");
	const operations = [];

	before(
		async () => {
			dir = await mkdtemp(join(tmpdir(), "nginxions-control-"));
			const socket = join(dir, "docker.sock");
			const tokenFile = join(dir, "token");
			const learning = join(dir, "learning");
			await mkdir(join(learning, "test-host"), { recursive: true });
			await writeFile(join(learning, "test-host", "5.data"), '{"values":["blue"]}');
			await writeFile(tokenFile, token, { mode: 0o600 });
			await writeFile(join(dir, "policy.json"), '{"current":"test"}');
			policyArchive = execFileSync("tar", ["-C", dir, "-cf", "-", "policy.json"]);

			docker = http.createServer((req, res) => {
				const url = new URL(req.url, "http://fixture.test");
				operations.push({
					method: req.method,
					path: url.pathname,
					query: Object.fromEntries(url.searchParams),
				});
				if (url.pathname === `/containers/${encodeURIComponent(hostname())}/json`) {
					return asJson(res, { Config: { Labels: { [projectLabel]: project } } });
				}
				if (url.pathname === "/containers/json") {
					const containers = [agent, crowdsec, dependent, outsideProject, unmanaged];
					return asJson(res, url.searchParams.has("filters") ? containers : apps);
				}
				if (url.pathname === "/containers/crowdsec/json") {
					return asJson(res, { State: { Health: { Status: "healthy" } }, RestartCount: 2 });
				}
				if (url.pathname === "/containers/openappsec/json") {
					return asJson(res, { State: { StartedAt: agentStartedAt, Health: { Status: "healthy" } } });
				}
				if (req.method === "POST" && url.pathname === "/containers/openappsec/restart") {
					agentStartedAt = new Date().toISOString();
					return res.writeHead(204).end();
				}
				if (req.method === "POST" && url.pathname === "/containers/nginxions/restart") {
					res.writeHead(204).end();
					dependentRestarted?.();
					return;
				}
				if (url.pathname === "/containers/crowdsec/logs") {
					if (largeLogs) return res.end(Buffer.alloc(9 * 1024 * 1024, "a"));
					return res.end(Buffer.concat([frame(1, "line one\n"), frame(2, "line two\n")]));
				}
				if (
					req.method === "POST" &&
					["/containers/crowdsec/restart", "/containers/crowdsec/kill"].includes(url.pathname)
				) {
					return res.writeHead(204).end();
				}
				if (url.pathname === "/containers/openappsec/archive") {
					if (archiveState === "missing") return asJson(res, { message: "no file" }, 404);
					if (req.method === "HEAD") {
						const size = archiveState === "large" ? 33 * 1024 * 1024 : 100;
						const stat = Buffer.from(JSON.stringify({ size })).toString("base64");
						return res.writeHead(200, { "x-docker-container-path-stat": stat }).end();
					}
					return res.end(archiveState === "damaged" ? Buffer.from("invalid archive") : policyArchive);
				}
				return asJson(res, { message: "unknown fixture request" }, 404);
			});
			docker.listen(socket);
			await once(docker, "listening");

			environment = {
				...process.env,
				NGINXIONS_CONTROL_RPC_SOCKET: "",
				NGINXIONS_CONTROL_LISTEN: "127.0.0.1",
				NGINXIONS_CONTROL_PORT: "0",
				NGINXIONS_CONTROL_WATCHDOG: "false",
				NGINXIONS_CONTROL_TOKEN_FILE: tokenFile,
				NGINXIONS_DOCKER_SOCKET: socket,
				NGINXIONS_AGENT_SERVICE: "openappsec",
				NGINXIONS_AGENT_LEARNING_DIR: learning,
				NGINXIONS_AGENT_LEARNING_RESTORE_DIR: join(dir, "restore"),
			};
			const started = await launch(environment, (stop) => {
				stopServer = stop;
			});
			base = `http://${started.address}`;
		},
		{ timeout: 5000 },
	);

	after(async () => {
		await stopServer?.();
		if (docker?.listening) await new Promise((resolve) => docker.close(resolve));
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	const request = async (route, { authorized = true, method = "GET", body = undefined } = {}) => {
		const headers = authorized ? { Authorization: `Bearer ${token}` } : {};
		const response = await fetch(`${base}${route}`, { headers, method, body, signal: AbortSignal.timeout(5000) });
		return { status: response.status, body: await response.json() };
	};

	test("health and unauthenticated requests do not make Docker calls", async () => {
		const before = operations.length;
		assert.deepEqual(await request("/healthz", { authorized: false }), { status: 200, body: { status: "OK" } });
		assert.deepEqual(await request("/v1/services", { authorized: false }), {
			status: 401,
			body: { error: "Unauthorized" },
		});
		assert.equal(operations.length, before);
	});

	test("the backend uses the private Unix socket, including after control is restarted", async (t) => {
		const socket = join(dir, "control.sock");
		const env = { ...environment, NGINXIONS_CONTROL_RPC_SOCKET: socket };
		const first = await launch(env, (stop) => t.after(stop));
		const exited = once(first.child, "exit");
		first.child.kill("SIGKILL");
		await exited;
		assert.equal((await lstat(socket)).isSocket(), true);
		const replacement = await launch(env, (stop) => t.after(stop));
		assert.equal(replacement.address, socket);
		assert.equal((await lstat(socket)).mode & 0o077, 0);
		const script = `import assert from "node:assert/strict";
			const { default: control } = await import(${JSON.stringify(new URL("./client.js", import.meta.url).href)});
			await assert.rejects(control.getService("absent"), /Unknown service/);
			await assert.rejects(control.restoreAgentLearning({ detail: "тест" }, 71), /no files/);
			console.log(JSON.stringify((await control.listServices()).map(({service}) => service)));`;
		const helper = spawn(process.execPath, ["--input-type=module", "--eval", script], { env });
		helper.stderr.pipe(process.stderr);
		helper.stdout.setEncoding("utf8");
		let output = "";
		helper.stdout.on("data", (chunk) => {
			output += chunk;
		});
		const [status] = await once(helper, "close");
		assert.equal(status, 0);
		assert.deepEqual(JSON.parse(output), ["openappsec", "crowdsec", "nginxions"]);
	});

	test("lists and inspects only the configured project's managed services", async () => {
		const { status, body } = await request("/v1/services");
		assert.equal(status, 200);
		assert.deepEqual(
			body.map(({ service }) => service),
			["openappsec", "crowdsec", "nginxions"],
		);
		const listing = operations.find((call) => call.query.filters);
		assert.deepEqual(JSON.parse(listing.query.filters), {
			label: [`${projectLabel}=${project}`, "nginxions.managed=true"],
		});
		assert.deepEqual(body[1].ports, [
			{ port: 80, type: "tcp", published: 8080 },
			{ port: 81, type: "tcp", published: null },
		]);
		const info = await request("/v1/services/crowdsec");
		assert.equal(info.body.health, "healthy");
		assert.equal(info.body.restartCount, 2);
		assert.equal((await request("/v1/services/unrelated")).status, 404);
		const start = operations.length;
		assert.equal((await request("/v1/services/foreign/restart", { method: "POST" })).status, 404);
		assert.equal((await request("/v1/services/sidecar/logs")).status, 404);
		assert.deepEqual(
			operations.slice(start).map(({ path }) => path),
			["/containers/json", "/containers/json"],
		);
	});

	test("returns a bounded error when Docker sends more log data than control can safely buffer", async () => {
		largeLogs = true;
		try {
			assert.deepEqual(await request("/v1/services/crowdsec/logs"), {
				status: 502,
				body: { error: "Docker API response is too large" },
			});
		} finally {
			largeLogs = false;
		}
		assert.equal((await request("/v1/services/crowdsec/logs")).status, 200);
	});

	test("only includes connected external apps and exposes only their shared network addresses", async () => {
		const { status, body } = await request("/v1/apps");
		assert.equal(status, 200);
		assert.equal(body.length, 1);
		assert.equal(body[0].name, "application");
		assert.deepEqual(body[0].addresses, [{ network: "edge", ip: "192.0.2.3" }]);
	});

	test("reads bounded logs and only permits reload on the configured reloadable service", async () => {
		const logs = await request("/v1/services/crowdsec/logs?tail=9999&since=100");
		assert.deepEqual(logs.body, [
			{ stream: "stdout", line: "line one" },
			{ stream: "stderr", line: "line two" },
		]);
		assert.equal(operations.at(-1).query.tail, "5000");
		assert.equal(operations.at(-1).query.since, "100");
		assert.equal((await request("/v1/services/openappsec/reload", { method: "POST" })).status, 400);
		assert.deepEqual(await request("/v1/services/crowdsec/reload", { method: "POST" }), {
			status: 202,
			body: { service: "crowdsec", reloaded: true },
		});
		assert.equal(operations.at(-1).query.signal, "SIGHUP");
		assert.deepEqual(await request("/v1/services/crowdsec/restart", { method: "POST" }), {
			status: 202,
			body: { service: "crowdsec", restarted: true },
		});
	});

	test("reads an applied policy, handles startup without a policy and refuses oversized or damaged files", async () => {
		assert.deepEqual((await request("/v1/agent/policy")).body.policy, { current: "test" });
		archiveState = "missing";
		assert.deepEqual(await request("/v1/agent/policy"), { status: 200, body: { modifiedAt: null, policy: null } });
		archiveState = "large";
		assert.equal((await request("/v1/agent/policy")).status, 413);
		assert.equal(operations.at(-1).method, "HEAD");
		archiveState = "damaged";
		assert.equal((await request("/v1/agent/policy")).status, 502);
	});

	test("exposes learned data in the list, a file and the snapshot", async () => {
		const listed = await request("/v1/agent/learning");
		assert.deepEqual(
			listed.body.map(({ asset }) => asset),
			["test-host"],
		);
		const file = await request("/v1/agent/learning/file?asset=test-host&name=5.data");
		assert.deepEqual(file.body.data, { values: ["blue"] });
		const snapshot = await request("/v1/agent/learning/snapshot");
		const [saved] = snapshot.body.files;
		assert.equal(saved.name, "5.data");
		assert.deepEqual(JSON.parse(Buffer.from(saved.content, "base64").toString()), file.body.data);
		assert.equal((await request("/v1/agent/learning/file?asset=test-host&name=other.data")).status, 400);
	});

	test(
		"stages a valid snapshot before restarting the agent and reattaches the dependent only after health",
		async () => {
			const route = "/v1/agent/learning/restore";
			const start = operations.length;
			assert.deepEqual(await request(route, { method: "POST", body: "{" }), {
				status: 400,
				body: { error: "Invalid JSON" },
			});
			assert.deepEqual(await request(route, { method: "POST", body: "{}" }), {
				status: 400,
				body: { error: "no files" },
			});
			assert.equal(operations.length, start);
			const restored = '{"values":["restored"]}';
			const content = Buffer.from(restored).toString("base64");
			const restart = new Promise((resolve) => {
				dependentRestarted = resolve;
			});
			assert.deepEqual(
				await request(route, {
					method: "POST",
					body: JSON.stringify({ files: [{ asset: "test-host", name: "5.data", content }] }),
				}),
				{ status: 202, body: { restored: 1, restarting: true } },
			);
			assert.equal(agentStartedAt, undefined);
			assert.equal(await readFile(join(dir, "restore", "test-host", "5.data"), "utf8"), restored);
			assert.equal(await readFile(join(dir, "learning", "test-host", "5.data"), "utf8"), '{"values":["blue"]}');
			await restart;
			assert.deepEqual(
				operations
					.slice(start)
					.map(({ path }) => path)
					.filter((path) => path !== "/containers/json"),
				["/containers/openappsec/restart", "/containers/openappsec/json", "/containers/nginxions/restart"],
			);
		},
		{ timeout: 10000 },
	);
});
