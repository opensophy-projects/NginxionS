#!/usr/bin/env node
// CI: files in the maintained directories are named in section 4 of CODE_OF_CONDUCT.md. Tests, component
// styles, page entry points, migrations, patches and examples are described with their folders.
// Usage: node scripts/check-tree.mjs   (from the root of the repository)
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOTS = [
	".github",
	"deploy",
	"docs",
	"model",
	"nginxions/backend/nginxions",
	"nginxions/frontend/src/nginxions",
	"readme",
	"scripts",
];
const SKIP_DIRS = new Set(["__pycache__", "node_modules", "migrations", "patches", "examples"]);
const skipFile = (name) =>
	name.includes(".test.") || name.endsWith(".module.css") || name === "index.tsx" || name.endsWith(".patch");

const tree = readFileSync("CODE_OF_CONDUCT.md", "utf8");
const inventory = tree.split(/^## 4\. Дерево файлов\s*$/m)[1] ?? "";
const names = new Set([...inventory.matchAll(/`([^`\n]+)`/g)].map(([, entry]) => path.posix.basename(entry)));
const missing = [];
const walk = (dir) => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) walk(full);
		} else if (!skipFile(entry.name) && !names.has(entry.name)) {
			missing.push(full);
		}
	}
};
for (const root of ROOTS) walk(root);

if (missing.length) {
	for (const file of missing) console.log(`::error file=${file}::not in the file tree of CODE_OF_CONDUCT.md (section 4)`);
	console.log(`${missing.length} file(s): add each with a line on what it is for`);
	process.exit(1);
}
console.log("file tree of CODE_OF_CONDUCT.md: every file named");
