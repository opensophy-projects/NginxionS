import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("locale check rejects hardcoded JSX expressions and blank translations", (t) => {
	const root = mkdtempSync(join(tmpdir(), "nginxions-i18n-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const locales = join(root, "locale", "src");
	mkdirSync(locales, { recursive: true });
	writeFileSync(join(locales, "en.json"), JSON.stringify({ title: { defaultMessage: "Title" } }));
	writeFileSync(join(locales, "ru.json"), JSON.stringify({ title: { defaultMessage: "" } }));
	writeFileSync(join(root, "View.tsx"), '<button aria-label={"English label"}>{"English text"}</button>');
	const script = fileURLToPath(new URL("./check-i18n.mjs", import.meta.url));
	const result = spawnSync(process.execPath, [script, root], { encoding: "utf8" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /no translation for "title"/);
	assert.match(result.stderr, /hardcoded text "English label"/);
	assert.match(result.stderr, /hardcoded text "English text"/);
});
