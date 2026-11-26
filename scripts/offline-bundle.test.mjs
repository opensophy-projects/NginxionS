import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./offline-bundle.sh", import.meta.url));

test("offline bundle contains the resolved deployment and checksummed images", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "nginxions-bundle-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const docker = join(dir, "docker");
	const calls = join(dir, "docker.log");
	writeFileSync(
		docker,
		`#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_TEST_CALLS"
case "$1/$2" in
  compose/--env-file)
    registry=$(sed -n 's/^NGINXIONS_REGISTRY=//p' "$3")
    version=$(sed -n 's/^NGINXIONS_VERSION=//p' "$3")
    printf '%s\\n' "$registry/nginxions:$version" "$registry/nginxions:$version" "$registry/nginxions-openappsec:$version"
    printf '%s\\n' docker.io/library/postgres:18.7-alpine
    ;;
  pull/*) ;;
  image/inspect)
    for image; do :; done
    [ "$image" != "\${DOCKER_TEST_MISSING_IMAGE:-}" ] || exit 1
    printenv DOCKER_TEST_PLATFORM || echo linux/amd64
    ;;
  image/save) printf 'saved images fixture' ;;
  *) exit 2 ;;
esac
`,
	);
	chmodSync(docker, 0o755);
	const env = {
		...process.env,
		PATH: [dir, process.env.PATH].join(delimiter),
		NGINXIONS_VERSION: "test-commit",
		NGINXIONS_REGISTRY: "docker.io/example",
		DOCKER_TEST_CALLS: calls,
		OFFLINE_BUNDLE_USE_LOCAL_IMAGES: "0",
	};
	const run = (file, extraEnv) =>
		execFileSync("bash", [script, file], { cwd: dir, env: { ...env, ...extraEnv }, stdio: "pipe" });
	run("bundle.tar");
	const dest = join(dir, "extracted");
	mkdirSync(dest);
	execFileSync("tar", ["-xf", join(dir, "bundle.tar"), "-C", dest]);
	const get = (file) => readFileSync(join(dest, file), "utf8");
	assert.match(get("deploy/.env"), /^NGINXIONS_VERSION=test-commit$/m);
	assert.match(get("deploy/.env"), /^NGINXIONS_REGISTRY=docker\.io\/example$/m);
	assert.match(get("README.md"), /--pull never/);
	assert.ok(get("deploy/init/nginxions-init.sh"));
	assert.ok(get("deploy/init/postgres-init.sh"));
	assert.ok(get("deploy/clamav/nginxions-clamav.sh"));
	assert.ok(get("deploy/seccomp/nginxions.json"));
	execFileSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: dest });
	const log = readFileSync(calls, "utf8").trim().split("\n");
	assert.ok(
		log.includes(
			"image save docker.io/example/nginxions-openappsec:test-commit docker.io/example/nginxions:test-commit docker.io/library/postgres:18.7-alpine",
		),
	);
	assert.equal(log.filter((line) => line.startsWith("pull ")).length, 3);
	assert.throws(() => run("bundle.tar"), /Bundle already exists/);
	assert.throws(() => run("wrong-platform.tar", { DOCKER_TEST_PLATFORM: "linux/arm64" }), /Unexpected platform/);

	writeFileSync(calls, "");
	run("ci-bundle.tar", { OFFLINE_BUNDLE_USE_LOCAL_IMAGES: "1" });
	const ciCalls = readFileSync(calls, "utf8").trim().split("\n");
	assert.deepEqual(ciCalls.filter((line) => line.startsWith("pull ")), [
		"pull --platform=linux/amd64 docker.io/library/postgres:18.7-alpine",
	]);
	assert.ok(ciCalls.includes(log.find((line) => line.startsWith("image save "))));
	assert.throws(
		() =>
			run("missing-ci-image.tar", {
				OFFLINE_BUNDLE_USE_LOCAL_IMAGES: "1",
				DOCKER_TEST_MISSING_IMAGE: "docker.io/example/nginxions:test-commit",
			}),
		/CI image must be loaded before packing/,
	);
});
