import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const scripts = resolve("scripts");
const registry = "docker.io/opensophy";
const digest = (digit) => "sha256:" + digit.repeat(64);

function fixture(t, { consent = "true", release = "V1.10.0", compatible = true, healthy = true, trusted = true } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "nginxions-updater-"));
	t.after(() => rmSync(dir, { recursive: true }));
	const install = join(dir, "installed");
	mkdirSync(install, { mode: 0o700 });
	cpSync("deploy", join(install, "deploy"), { recursive: true });
	writeFileSync(join(install, "deploy/.env"), readFileSync("deploy/.env", "utf8").replace("=develop", "=V1.9.0"));
	for (const [name, content] of Object.entries({ ".nginxions-install": "1\n", ".docker-id": "test\n", ".images": "" })) {
		writeFileSync(join(install, name), content);
	}
	const stamp = execFileSync(
		"bash",
		["-c", 'source "$1"; deployment_fingerprint "$2"', "--", join(scripts, "install-lib.sh"), join(install, "deploy")],
		{ encoding: "utf8" },
	).trim();
	const manifest = join(dir, "manifest");
	writeFileSync(
		manifest,
		[
			"version=" + release,
			"registry=" + (trusted ? registry : "docker.io/other"),
			"nginxions=" + digest("1"),
			"nginxions_openappsec=" + digest("2"),
			"deployment=" + (compatible ? stamp : "3".repeat(64)),
		].join("\n") + "\n",
	);

	const bin = join(dir, "bin");
	mkdirSync(bin);
	const docker = join(bin, "docker");
	writeFileSync(
		docker,
		`#!/usr/bin/env bash
set -eu
echo "docker \${NGINXIONS_VERSION:-} $*" >> "$COMMANDS"
case "$1 $2" in
  'info --format') echo test ;;
  'context inspect') echo unix:///var/run/docker.sock ;;
  'compose --project-name')
    shift 7
    case "$1" in
      ps) printf '%064d\\n' 1 ;;
      config) printf '%s\\n' "docker.io/opensophy/nginxions:$NGINXIONS_VERSION" "docker.io/opensophy/nginxions-openappsec:$NGINXIONS_VERSION" ;;
      up) [[ "$NGINXIONS_VERSION" = V1.9.0 || "$NEW_HEALTHY" = true ]] ;;
      *) exit 5 ;;
    esac ;;
  exec*) echo "$CONSENT" ;;
  'image inspect')
    if [[ "$*" = *'@sha256:'* ]]; then echo sha256:local
    elif [[ "$*" = *:V1.9.0 ]]; then echo sha256:old
    else exit 1; fi ;;
  pull*|'image tag') ;;
  *) exit 6 ;;
esac
`,
	);
	const curl = join(bin, "curl");
	writeFileSync(curl, '#!/bin/sh\nprintf "curl %s\\n" "$*" >> "$COMMANDS"\ncat "$MANIFEST"\n');
	chmodSync(docker, 0o700);
	chmodSync(curl, 0o700);

	const commands = join(dir, "commands");
	const run = () =>
		spawnSync(join(scripts, "update.sh"), ["--dir", install], {
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${bin}:${process.env.PATH}`,
				DOCKER_HOST: "unix:///var/run/docker.sock",
				DOCKER_CONTEXT: "",
				COMMANDS: commands,
				MANIFEST: manifest,
				NEW_HEALTHY: String(healthy),
				CONSENT: consent,
			},
		});
	return { run, install, log: () => readFileSync(commands, "utf8") };
}

test("automatic update never contacts GitHub before consent", (t) => {
	const f = fixture(t, { consent: "false" });
	const result = f.run();
	assert.equal(result.status, 0, result.stderr);
	assert.doesNotMatch(f.log(), /curl|pull| up /);
});

test("not compatible, wrong registry, older and different major releases do not pull images", (t) => {
	for (const scenario of [
		{ compatible: false },
		{ trusted: false, status: 1 },
		{ release: "V1.8.0" },
		{ release: "V2.0.0" },
	]) {
		const f = fixture(t, scenario);
		const result = f.run();
		assert.equal(result.status, scenario.status ?? 0, result.stderr);
		assert.doesNotMatch(f.log(), /docker .*pull| up /);
	}
});

test("pulls both pinned images before upgrading and persists the tag after readiness", (t) => {
	const f = fixture(t);
	const result = f.run();
	assert.equal(result.status, 0, result.stderr);
	const log = f.log();
	const app = log.indexOf(`pull --platform linux/amd64 ${registry}/nginxions@${digest("1")}`);
	const agent = log.indexOf(`pull --platform linux/amd64 ${registry}/nginxions-openappsec@${digest("2")}`);
	assert.ok(app >= 0 && agent > app && log.indexOf("up -d --no-build --pull never --wait") > agent, log);
	assert.match(readFileSync(join(f.install, "deploy/.env"), "utf8"), /^NGINXIONS_VERSION=V1.10.0$/m);
});

test("a readiness failure restores the previous images and prevents a repeat of the same upgrade", (t) => {
	const f = fixture(t, { healthy: false });
	const result = f.run();
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /restored the previous images/);
	assert.match(f.log(), /docker V1\.9\.0 compose .* up -d/);
	assert.match(readFileSync(join(f.install, "deploy/.env"), "utf8"), /^NGINXIONS_VERSION=V1.9.0$/m);
	const again = f.run();
	assert.match(again.stderr, /already attempted/);
	assert.equal(f.log().match(/ up -d/g).length, 2);
});
