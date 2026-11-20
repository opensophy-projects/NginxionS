import assert from "node:assert/strict";
import { test } from "node:test";
import { codeLines, counted, parseLcov, sourceOf, v8LineHits } from "./coverage-report.mjs";

test("code lines: no blank lines, comments, brackets alone", () => {
	const src = [
		"// a comment", // 1
		"const a = 1;", // 2
		"", // 3
		"/* a block", // 4
		"   comment */", // 5
		"function f() {", // 6
		"\treturn a;", // 7
		"}", // 8
		"/** one line */ const b = 2;", // 9
	].join("\n");
	assert.deepEqual([...codeLines(src)], [2, 6, 7, 9]);
});

test("V8 coverage: a line gets the count of the innermost range holding its code", () => {
	const src = "function f(x) {\n  if (x) {\n    return 1;\n  }\n  return 2;\n}\nf(0);\n";
	const at = (s) => src.indexOf(s);
	const script = {
		functions: [
			{ ranges: [{ startOffset: 0, endOffset: src.length, count: 1 }] },
			{
				ranges: [
					{ startOffset: 0, endOffset: at("f(0)") - 1, count: 1 },
					// the block of the if never ran
					{ startOffset: at("{\n    return 1"), endOffset: at("  return 2"), count: 0 },
				],
			},
		],
	};
	const hits = v8LineHits(src, script);
	assert.equal(hits.get(1), 1);
	assert.equal(hits.get(2), 1);
	assert.equal(hits.get(3), 0);
	assert.equal(hits.get(5), 1);
	assert.equal(hits.get(7), 1);
});

test("lcov: relative and absolute paths of the backend, the highest hit of a line", () => {
	const lcov = [
		"SF:nginxions/a.js",
		"DA:1,0",
		"DA:2,3",
		"DA:2,0",
		"end_of_record",
		"SF:/w/nginxions/backend/nginxions/b.js",
		"DA:4,1",
		"end_of_record",
	].join("\n");
	const files = parseLcov(lcov, "/w/nginxions/backend");
	assert.deepEqual([...files.keys()], ["nginxions/a.js", "nginxions/b.js"]);
	assert.equal(files.get("nginxions/a.js").get(2), 3);
	assert.equal(files.get("nginxions/a.js").get(1), 0);
});

test("only our sources count: not tests, not the code of NPMplus", () => {
	assert.equal(counted("nginxions/pki/mtls.js"), true);
	assert.equal(counted("nginxions/pki/mtls.test.js"), false);
	assert.equal(counted("nginxions/test/helpers.js"), false);
	assert.equal(counted("internal/nginx.js"), false);
});

test("the scripts of the backend and of nginxions-control map to their sources", () => {
	assert.equal(sourceOf("file:///app/nginxions/pki/mtls.js"), "nginxions/pki/mtls.js");
	assert.equal(sourceOf("file:///opt/nginxions-control/server.js"), "nginxions/control/server.js");
	assert.equal(sourceOf("node:internal/main"), undefined);
});
