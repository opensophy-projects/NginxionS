import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	fstatSync,
	ftruncateSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = (name) =>
	fileURLToPath(new URL(`./${name}.sh`, import.meta.url));
const project = "docker.io/opensophy/nginxions:develop";
const agent = "docker.io/opensophy/nginxions-openappsec:develop";
const postgres = "docker.io/library/postgres:18.7-alpine";

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "nginxions-installer-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const target = join(root, "installation with spaces");
	const calls = join(root, "calls");
	const images = join(root, "images.json");
	const apt = join(root, "apt.log");
	const command = (name, content) =>
		writeFileSync(join(root, name), content, { mode: 0o755 });
	writeFileSync(images, JSON.stringify({ [postgres]: "sha256:existing" }));
	command(
		"docker",
		`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2), [cmd, sub] = args, ref = args.at(-1);
const e = process.env;
fs.appendFileSync(e.TEST_CALLS, JSON.stringify(args) + "\\n");
const images = JSON.parse(fs.readFileSync(e.TEST_IMAGES, "utf8"));
const save = () => fs.writeFileSync(e.TEST_IMAGES, JSON.stringify(images));
const emit = (value) => { if (value) console.log(value); };
if (cmd === "context") emit(e.TEST_HOST || "unix:///var/run/docker.sock");
else if (cmd === "version") emit(e.TEST_ENGINE || "28.0.1");
else if (cmd === "info") emit(e.TEST_ID || "test-engine");
else if (cmd === "ps") emit(ref === "ancestor=" + e.TEST_SHARED && "other-container");
else if (cmd === "volume" && sub === "ls") emit(e.TEST_VOLUMES);
else if (cmd === "network" && sub === "ls") emit(e.TEST_NETWORKS);
else if (["volume", "network"].includes(cmd) && sub === "rm") {}
else if (cmd === "image" && sub === "inspect") {
  if (!images[ref]) process.exit(1);
  emit(images[ref]);
}
else if (cmd === "image" && sub === "rm") { delete images[ref]; save(); }
else if (cmd === "image" && sub === "ls") emit(Object.values(images).join("\\n"));
else if (cmd === "pull") {
  if (e.TEST_FAIL_PULL === ref) process.exit(1);
  images[ref] = "sha256:downloaded";
  save();
}
else if (cmd === "compose") {
  if (sub === "version") emit(e.TEST_COMPOSE || "v2.40.3");
  else if (args.includes("config")) console.log(${JSON.stringify([agent, project, postgres, project].join("\n"))});
  else if (args.includes("up") && e.TEST_FAIL_START) process.exit(1);
  else if (args.includes("logs")) emit("fixture init logs");
  else if (!args.some((x) => ["up", "down", "ps"].includes(x))) process.exit(2);
}
else process.exit(2);
`,
	);
	command("apt-cache", '#!/bin/sh\n[ -z "$TEST_APT_NO_SOURCE" ]\n');
	command(
		"curl",
		`#!/bin/bash
[[ "$*" == *"https://download.docker.com/linux/"* ]] || exit 2
for output; do :; done
printf 'fixture signing key\\n' > "$output"
`,
	);
	command("systemctl", "#!/bin/sh\nexit 0\n");
	command(
		"dpkg-query",
		'#!/bin/sh\ncase "$3" in docker-ce|docker-compose-plugin|containerd.io) printf installed ;; *) exit 1 ;; esac\n',
	);
	command(
		"apt-get",
		`#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_APT"
if [ "$1" = -s ]; then
  printf 'Purg docker-ce [28]\\nPurg docker-compose-plugin [2]\\n'
  if [ -n "$TEST_APT_EXTRA" ]; then printf 'Remv %s [1]\\n' "$TEST_APT_EXTRA"; fi
fi
`,
	);
	const env = {
		...process.env,
		PATH: [root, process.env.PATH].join(delimiter),
		TEST_APT: apt,
		TEST_CALLS: calls,
		TEST_IMAGES: images,
		DOCKER_HOST: "",
		DOCKER_CONTEXT: "",
	};
	const run = (args, { input = "", ...overrides } = {}) =>
		spawnSync("bash", args, {
			cwd: root,
			env: { ...env, ...overrides },
			input,
			encoding: "utf8",
		});
	return {
		root,
		target,
		calls: () => readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse),
		images: () => JSON.parse(readFileSync(images, "utf8")),
		setImages: (value) => writeFileSync(images, JSON.stringify(value)),
		apt: () => (existsSync(apt) ? readFileSync(apt, "utf8") : ""),
		install: (overrides) =>
			run([script("install"), "--dir", target], overrides),
		uninstall: (overrides, directory = target) =>
			run([script("uninstall"), "--dir", directory], overrides),
		packages: (action, overrides) =>
			run(
				[
					"-ec",
					'. "$1"; install_dir="$2"; docker_sources="$PWD/docker.sources"; docker_key="$PWD/docker.asc"; shift 2; "$@"',
					"bash",
					script("install-lib"),
					target,
					...action,
				],
				overrides,
			),
	};
}

function ok(result) {
	assert.equal(result.status, 0, result.stderr || result.error?.message);
}

test("installer preserves settings and downloads each missing image once", (t) => {
	const f = fixture(t);
	ok(f.install());
	const envFile = join(f.target, "deploy", ".env");
	assert.match(readFileSync(envFile, "utf8"), /NGINXIONS_VERSION=develop/);
	assert.equal(statSync(f.target).mode & 0o777, 0o700);
	// Use an open descriptor so the permission check and the update refer to the same file.
	const envFd = openSync(envFile, "r+");
	try {
		assert.equal(fstatSync(envFd).mode & 0o777, 0o600);
		ftruncateSync(envFd, 0);
		writeFileSync(envFd, "# keep existing settings\n");
	} finally {
		closeSync(envFd);
	}
	for (const file of [
		"init/nginxions-init.sh",
		"init/postgres-init.sh",
		"clamav/nginxions-clamav.sh",
	]) {
		assert.equal(
			statSync(join(f.target, "deploy", file)).mode & 0o777,
			0o755,
			file,
		);
	}
	assert.ok(existsSync(join(f.target, "deploy", "seccomp", "nginxions.json")));
	assert.ok(existsSync(join(f.target, "uninstall.sh")));
	ok(f.install());
	const updatedFd = openSync(envFile, "r");
	try {
		const contents = Buffer.alloc(64);
		const size = readSync(updatedFd, contents, 0, contents.length, 0);
		assert.equal(
			contents.toString("utf8", 0, size),
			"# keep existing settings\n",
		);
	} finally {
		closeSync(updatedFd);
	}
	assert.deepEqual(
		f.calls().filter(([cmd]) => cmd === "pull"),
		[
			["pull", "--platform", "linux/amd64", agent],
			["pull", "--platform", "linux/amd64", project],
		],
	);
	assert.ok(
		f
			.calls()
			.some(
				(args) =>
					args.includes("up") &&
					args.includes("--wait") &&
					args.includes("never"),
			),
	);
	assert.equal(f.apt(), "");
});

test("a failed start reports the init log and preserves the installation for retry", (t) => {
	const f = fixture(t);
	const result = f.install({ TEST_FAIL_START: "1" });
	assert.equal(result.status, 1);
	assert.match(result.stdout, /fixture init logs/);
	assert.match(result.stderr, /did not become ready/);
	ok(f.install());
});

test("uninstaller confirms deletion and keeps pre-existing and shared images", (t) => {
	const f = fixture(t);
	ok(f.install());
	ok(f.uninstall({ input: "n\n" }));
	assert.ok(existsSync(f.target));
	assert.ok(!f.calls().some((args) => args.includes("down")));
	const result = f.uninstall({
		input: "yes\nn\n",
		TEST_SHARED: agent,
		TEST_VOLUMES: "nginxions_old-data",
		TEST_NETWORKS: "nginxions_old-network",
	});
	ok(result);
	assert.match(result.stderr, /Remove Docker Engine and Compose packages too/);
	assert.ok(!existsSync(f.target));
	assert.deepEqual(Object.keys(f.images()).sort(), [postgres, agent].sort());
	assert.ok(
		f
			.calls()
			.some(
				(args) =>
					args.includes("down") &&
					args.includes("--volumes") &&
					args.includes("--remove-orphans"),
			),
	);
	assert.ok(
		f
			.calls()
			.some((args) => args.join(" ") === "volume rm -- nginxions_old-data"),
	);
	assert.ok(
		f
			.calls()
			.some((args) => args.join(" ") === "network rm -- nginxions_old-network"),
	);
	assert.equal(f.apt(), "");
	ok(f.uninstall());
});

test("interrupted installation can be removed and tags replaced after installation are kept", (t) => {
	const f = fixture(t);
	assert.equal(f.install({ TEST_FAIL_PULL: project }).status, 1);
	assert.match(
		f.uninstall({ input: "yes\n", TEST_ID: "wrong-engine" }).stderr,
		/another Docker Engine/,
	);
	assert.ok(existsSync(f.target));
	f.setImages({ ...f.images(), [agent]: "sha256:replacement" });
	ok(f.uninstall({ input: "yes\nn\n" }));
	assert.deepEqual(f.images(), {
		[postgres]: "sha256:existing",
		[agent]: "sha256:replacement",
	});
	assert.ok(!existsSync(f.target));
});

test("installer refuses a remote daemon, outdated tools, and a manual stack with the same name", (t) => {
	const f = fixture(t);
	const cases = [
		[
			{ TEST_HOST: "tcp://remote.example:2376" },
			/Select the local Docker Engine/,
		],
		[{ TEST_ENGINE: "27.5.1" }, /Engine 28/],
		[{ TEST_COMPOSE: "2.22.0" }, /Compose 2.23/],
		[
			{ TEST_VOLUMES: "nginxions_postgres-data" },
			/project named nginxions already exists/,
		],
	];
	for (const [overrides, expected] of cases) {
		const install = f.install(overrides);
		assert.equal(install.status, 1);
		assert.match(install.stderr, expected);
	}
	ok(f.uninstall({ input: "yes\nn\n" }));
	assert.ok(
		!f.calls().some((args) => args.includes("up") || args.includes("down")),
	);
	assert.equal(f.apt(), "");
});

test("uninstaller refuses an unrelated directory and a symlink to it", (t) => {
	const f = fixture(t);
	mkdirSync(f.target, { mode: 0o700 });
	writeFileSync(join(f.target, "user-data"), "keep");
	const link = join(f.root, "alias");
	symlinkSync(f.target, link);
	assert.match(f.uninstall({}, link).stderr, /without symlinks/);
	assert.match(f.uninstall().stderr, /not created by the NginxionS installer/);
	assert.equal(readFileSync(join(f.target, "user-data"), "utf8"), "keep");
});

test("APT install uses explicit packages and refuses dependency removal", (t) => {
	const f = fixture(t);
	ok(
		f.packages([
			"install_docker_packages",
			"docker-ce",
			"docker-compose-plugin",
		]),
	);
	assert.equal(
		f.apt(),
		"update\ninstall -y --no-remove docker-ce docker-compose-plugin\n",
	);
});

test("a fresh Docker installation registers a signed APT source and removes only its own source on purge", (t) => {
	const f = fixture(t);
	mkdirSync(f.target, { mode: 0o700 });
	f.setImages({});
	const source = join(f.root, "docker.sources");
	const key = join(f.root, "docker.asc");
	ok(
		f.packages(
			["install_docker_packages", "docker-ce", "docker-compose-plugin"],
			{ TEST_APT_NO_SOURCE: "1" },
		),
	);
	assert.match(
		readFileSync(source, "utf8"),
		/^URIs: https:\/\/download\.docker\.com\/linux\/(debian|ubuntu)$/m,
	);
	assert.ok(readFileSync(source, "utf8").includes(`Signed-By: ${key}\n`));
	assert.match(
		f.apt(),
		/^update\ninstall -y --no-remove ca-certificates curl\nupdate\n/m,
	);
	ok(f.packages(["remove_docker_packages"]));
	assert.ok(!existsSync(source) && !existsSync(key));
});

test("Docker purge checks other resources and reverse dependencies and keeps pre-existing containerd", (t) => {
	const f = fixture(t);
	const action = ["remove_docker_packages"];
	f.setImages({});
	assert.match(
		f.packages(action, { TEST_NETWORKS: "foreign-network" }).stderr,
		/Docker was kept/,
	);
	assert.equal(f.apt(), "");
	assert.match(
		f.packages(action, { TEST_APT_EXTRA: "other-package" }).stderr,
		/also remove other-package/,
	);
	assert.doesNotMatch(f.apt(), /^purge /m);
	ok(f.packages(action));
	assert.equal(
		f.apt().trimEnd().split("\n").at(-1),
		"purge -y --no-auto-remove docker-ce docker-compose-plugin",
	);
});
