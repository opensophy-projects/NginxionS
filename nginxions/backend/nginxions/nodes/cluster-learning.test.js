// The state of the learning of the cluster in a snapshot (step 15.4): which files, read and put back.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";

describe("the state of the cluster in a snapshot of learning", () => {
	const files = new Map([
		["/shop/Indicators/Confidence/remote/confidence.data", '{"c":1}'],
		["/shop/Type/remote/data.data", '{"t":2}'],
		["/shop/Indicators/Confidence/window_0_1/n-1/a/data.data0", "{}"],
		["/shop/tuning/decisions.data", "[]"],
	]);
	const puts = [];
	const deletes = [];
	let server;
	let mod;
	before(async () => {
		server = http.createServer((req, res) => {
			const chunks = [];
			req.on("data", (d) => chunks.push(d));
			req.on("end", () => {
				const url = new URL(req.url, "http://storage");
				if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
					const keys = [...files.keys()]
						.map((k) => `<Contents><Key>${k.replaceAll("&", "&amp;")}</Key></Contents>`)
						.join("");
					res.end(`<ListBucketResult>${keys}</ListBucketResult>`);
					return;
				}
				const file = decodeURIComponent(url.pathname.slice(4));
				if (req.method === "DELETE") {
					deletes.push([file, req.headers["x-tenant-id"]]);
					files.delete(file);
					res.writeHead(204).end();
					return;
				}
				if (req.method === "PUT") {
					const content = Buffer.concat(chunks).toString();
					puts.push([file, content, req.headers["x-tenant-id"]]);
					files.set(file, content);
					res.end();
					return;
				}
				if (!files.has(file)) {
					res.statusCode = 404;
					res.end();
					return;
				}
				res.end(files.get(file));
			});
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		process.env.NGINXIONS_APPSEC_STORAGE_URL = `http://127.0.0.1:${server.address().port}`;
		mod = await import("./cluster-learning.js");
	});
	after(() => server?.close());

	test("files of the state put together only: remote/ of an asset, clean paths", () => {
		assert.equal(mod.isClusterStatePath("/shop/Indicators/Confidence/remote/confidence.data"), true);
		assert.equal(mod.isClusterStatePath("/shop/Type/window_0_1/n-1/data.data"), false);
		assert.equal(mod.isClusterStatePath("/shop/tuning/decisions.data"), false);
		assert.equal(mod.isClusterStatePath("/shop/../etc/remote/x"), false);
		assert.equal(mod.isClusterStatePath("//shop/Type/remote/x"), false);
		assert.equal(mod.isClusterStatePath(undefined), false);
		assert.deepEqual(mod.keysOfListing("<Key>a/b</Key><Key>/c/d</Key>"), ["/a/b", "/c/d"]);
	});

	test("restore replaces remote files and preserves other storage data", async () => {
		const state = await mod.readClusterState();
		assert.deepEqual(
			state.map((f) => [f.path, Buffer.from(f.content, "base64").toString()]),
			[
				["/shop/Indicators/Confidence/remote/confidence.data", '{"c":1}'],
				["/shop/Type/remote/data.data", '{"t":2}'],
			],
		);
		const changed = "/shop/Type/remote/data.data";
		const stale = "/new&asset/Type/remote/late#file.data";
		files.set(changed, "changed after snapshot");
		files.set(stale, "created after snapshot");
		assert.equal(await mod.restoreClusterState(state), 2);
		assert.deepEqual(deletes, [[stale, "local"]]);
		assert.equal(files.has(stale), false);
		assert.equal(files.get(changed), '{"t":2}');
		assert.equal(files.get("/shop/Indicators/Confidence/window_0_1/n-1/a/data.data0"), "{}");
		assert.equal(files.get("/shop/tuning/decisions.data"), "[]");
		assert.deepEqual(puts, [
			["/shop/Indicators/Confidence/remote/confidence.data", '{"c":1}', "local"],
			["/shop/Type/remote/data.data", '{"t":2}', "local"],
		]);
		await assert.rejects(
			() => mod.restoreClusterState([{ path: "/shop/tuning/decisions.data", content: "" }]),
			/not a file of the state/,
		);
	});
});

test("the learning of the cluster: windows per node and of this server, the last merge of smartsync", async () => {
	const { clusterLearningOf, entriesOfListing } = await import("./cluster-learning.js");
	const xml = `<ListBucketResult><KeyCount>5</KeyCount>
		<Contents><Key>/shop/Indicators/Confidence/window_0_1/n-0123456789abcdef/agent-a/data.data</Key><LastModified>2026-11-21T04:00:00Z</LastModified></Contents>
		<Contents><Key>/shop/Indicators/Confidence/window_0_2/n-0123456789abcdef/agent-a/data.data1</Key><LastModified>2026-11-21T04:10:00Z</LastModified></Contents>
		<Contents><Key>shop/Indicators/Confidence/window_0_2/local-agent/data.data</Key><LastModified>2026-11-21T04:05:00Z</LastModified></Contents>
		<Contents><Key>/shop/Indicators/Confidence/remote/confidence.data</Key><LastModified>2026-11-21T04:11:00Z</LastModified></Contents>
		<Contents><Key>/shop/tuning/decisions.data</Key><LastModified>2026-11-21T03:00:00Z</LastModified></Contents>
	</ListBucketResult>`;
	const entries = entriesOfListing(xml);
	assert.equal(entries.length, 5);
	assert.equal(entries[2].key, "/shop/Indicators/Confidence/window_0_2/local-agent/data.data");
	assert.deepEqual(clusterLearningOf(entries, [{ uid: "n-0123456789abcdef", name: "edge-1" }]), [
		{
			asset: "shop",
			local: { windows: 1, lastOn: "2026-11-21T04:05:00Z" },
			nodes: [{ uid: "n-0123456789abcdef", name: "edge-1", windows: 2, lastOn: "2026-11-21T04:10:00Z" }],
			mergedOn: "2026-11-21T04:11:00Z",
		},
	]);
	assert.deepEqual(clusterLearningOf([], []), []);
});
