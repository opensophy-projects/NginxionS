import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./security-report.mjs", import.meta.url));
const layer = { Digest: "sha256:39ba784e3d180083233da124577029087c20132e1a967746371bc34124e17c12" };
const advisory = "CVE-2025-47273";
const setuptools = { PURL: "pkg:pypi/setuptools@70.3.0" };
const vendored = { identifier: { ...setuptools, UID: "vendored" }, analyzedBy: "sbom", layer };
const installed = {
	identifier: { ...setuptools, UID: "installed" },
	analyzedBy: "python-pkg",
	path: "usr/local/lib/python3.14/site-packages/setuptools-70.3.0.dist-info/METADATA",
	layer,
};
const python = (name, version, layer) => ({
	Name: name,
	Identifier: { PURL: `pkg:pypi/${name}@${version}`, UID: name },
	AnalyzedBy: "python-pkg",
	FilePath: `usr/local/lib/python3.14/site-packages/${name}-${version}.dist-info/METADATA`,
	Layer: layer,
});

function trivy(...packages) {
	return {
		SchemaVersion: 2,
		Results: [
			{
				Target: "Python",
				Packages: packages.map((pkg) => ({
					Identifier: pkg.identifier,
					AnalyzedBy: pkg.analyzedBy,
					FilePath: pkg.path,
				})),
				Vulnerabilities: packages.map((pkg) => ({
					VulnerabilityID: advisory,
					Severity: "HIGH",
					PkgName: "setuptools",
					InstalledVersion: "70.3.0",
					FixedVersion: "78.1.1",
					PkgIdentifier: pkg.identifier,
					Layer: pkg.layer,
				})),
			},
		],
	};
}

function runReport(t, scans, { now = "2026-11-24", scope = "published" } = {}) {
	const input = mkdtempSync(join(tmpdir(), "nginxions-scans-"));
	const output = mkdtempSync(join(tmpdir(), "nginxions-security-"));
	t.after(() => {
		rmSync(input, { recursive: true, force: true });
		rmSync(output, { recursive: true, force: true });
	});
	for (const [file, scan] of Object.entries(scans)) writeFileSync(join(input, file), JSON.stringify(scan));
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`import { mock } from "node:test";
			 mock.timers.enable({ apis: ["Date"], now: Date.parse(${JSON.stringify(now)}) });
			 await import(${JSON.stringify(new URL("./security-report.mjs", import.meta.url).href)});`,
			"--",
			script,
			"--in",
			input,
			"--out",
			output,
			"--expect",
			scope === "published" ? "published" : "",
			"--scope",
			scope,
		],
		{ encoding: "utf8" },
	);
	assert.ifError(result.error);
	assert.equal(result.signal, null, result.stderr);
	return { ...result, findings: JSON.parse(readFileSync(join(output, "findings.json"), "utf8")) };
}

const grype = {
	matches: [
		{
			artifact: { name: "other-package", version: "1.0.0" },
			vulnerability: { id: "CVE-2000-0000", severity: "High", fix: { versions: ["2.0.0"] } },
		},
	],
};
const scans = (scan) => ({
	"trivy-published-nginxions-develop.json": scan,
	"grype-published-nginxions-develop.json": grype,
});

function pinnedPython(scan) {
	scan.Results[0].Packages.push(python("pip", "26.3", layer), python("setuptools", "84.2.1", layer));
	return scan;
}

test("published scans retain Grype results and narrowly classify the inspected Trivy SBOM entry", (t) => {
	const report = runReport(t, scans(pinnedPython(trivy(vendored))));
	assert.equal(report.status, 0, report.stdout);
	assert.deepEqual(
		report.findings.map(({ check, rule, verdict }) => ({ check, rule, verdict })),
		[
			{ check: "published", rule: advisory, verdict: "false-positive" },
			{ check: "grype-published", rule: "CVE-2000-0000", verdict: "open" },
		],
	);
});

test("the same advisory from an installed distribution or a layer without the pinned packages still blocks", (t) => {
	const unknownLayer = { ...vendored, layer: { Digest: `sha256:${"1".repeat(64)}` } };
	const report = runReport(t, scans(pinnedPython(trivy(vendored, installed, unknownLayer))));
	assert.equal(report.status, 1, report.stdout);
	assert.deepEqual(
		report.findings.filter(({ check }) => check === "published").map(({ verdict }) => verdict),
		["blocking", "blocking", "false-positive"],
	);
});

test("the SBOM exception expires and missing or empty published scanner reports fail", (t) => {
	const expired = runReport(t, scans(pinnedPython(trivy(vendored))), { now: "2027-02-02" });
	assert.equal(expired.status, 1, expired.stdout);
	assert.equal(expired.findings[0]?.verdict, "blocking");
	const missing = runReport(t, { ...scans(trivy()), "trivy-published-nginxions-latest.json": trivy() });
	assert.equal(missing.status, 1, missing.stdout);
	assert.match(missing.stdout, /Grype results missing for trivy-published-nginxions-latest/);
	const invalid = runReport(t, { ...scans(trivy()), "grype-published-nginxions-develop.json": null });
	assert.equal(invalid.status, 1, invalid.stdout);
	assert.match(invalid.stdout, /invalid Grype scan/);
});

test("a newly built image needs evidence from the pinned distributions in the same layer", (t) => {
	const builtLayer = { Digest: `sha256:${"2".repeat(64)}` };
	const image = trivy({ ...vendored, layer: builtLayer });
	const run = () => runReport(t, { "trivy-nginxions.json": image }, { scope: "images" });
	const packages = image.Results[0].Packages;
	assert.equal(run().findings[0]?.verdict, "blocking");
	packages.push(python("pip", "26.3", builtLayer), python("setuptools", "84.2.1", layer));
	assert.equal(run().findings[0]?.verdict, "blocking");
	packages[2].Layer = builtLayer;
	assert.equal(run().findings[0]?.verdict, "false-positive");
	const published = runReport(t, scans(image));
	assert.equal(published.status, 0, published.stdout);
	assert.equal(published.findings[0]?.verdict, "false-positive");
	const existingInstall = trivy(installed).Results[0];
	packages.push(...existingInstall.Packages);
	image.Results[0].Vulnerabilities.push(...existingInstall.Vulnerabilities);
	const report = run();
	assert.equal(report.status, 1, report.stdout);
	assert.deepEqual(report.findings.map(({ verdict }) => verdict), ["blocking", "false-positive"]);
});
