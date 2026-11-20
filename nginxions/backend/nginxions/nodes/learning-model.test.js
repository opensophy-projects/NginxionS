// What a node may ask of the storage and smartsync of its manager (step 15.4), and the paths of its relay.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cleanStoragePath, storageRequestOf, syncNotificationOf } from "./learning-model.js";
import { storageTarget, syncTarget } from "./relay.js";

const UID = "n-0123456789abcdef";
const q = (s = "") => new URLSearchParams(s);

describe("the storage of the manager for a node", () => {
	test("paths are cleaned: one slash, no traversal", () => {
		assert.equal(
			cleanStoragePath("//shop/Indicators/Confidence/remote/confidence.data"),
			"/shop/Indicators/Confidence/remote/confidence.data",
		);
		assert.equal(cleanStoragePath(""), "/");
		assert.equal(cleanStoragePath("/a/../b"), null);
		assert.equal(cleanStoragePath("/a/%2e%2e/b"), null);
		assert.equal(cleanStoragePath("/a/./b"), null);
		assert.equal(cleanStoragePath("/a\\b"), null);
		assert.equal(cleanStoragePath("/a/%00"), null);
		assert.equal(cleanStoragePath("/a/%zz"), null);
	});

	test("reads: any file and a listing, nothing else of the query", () => {
		assert.deepEqual(storageRequestOf("GET", "//shop/tuning/decisions.data", q(), UID), {
			path: "/shop/tuning/decisions.data",
			search: "",
		});
		assert.deepEqual(
			storageRequestOf("GET", "/", q("list-type=2&prefix=/shop/Indicators/Confidence/remote&x=1"), UID),
			{ path: "/", search: "?list-type=2&prefix=%2Fshop%2FIndicators%2FConfidence%2Fremote" },
		);
		// a prefix that ends with a slash keeps it (a directory, not every name that starts the same)
		assert.equal(
			storageRequestOf("GET", "", q("list-type=2&prefix=shop/Type/window_0_1/"), UID).search,
			"?list-type=2&prefix=%2Fshop%2FType%2Fwindow_0_1%2F",
		);
		assert.equal(storageRequestOf("GET", "/", q("list-type=2&prefix=../etc"), UID).status, 400);
		assert.equal(storageRequestOf("GET", "/", q(), UID).status, 400);
		assert.equal(storageRequestOf("GET", "/a/../../etc/passwd", q(), UID).status, 400);
	});

	test("writes: the data of a window only, under the id of the node", () => {
		assert.deepEqual(
			storageRequestOf("PUT", "//shop/Indicators/Confidence/window_3_7/agent-1/data.data2", q(), UID),
			{ path: `/shop/Indicators/Confidence/window_3_7/${UID}/agent-1/data.data2`, search: "" },
		);
		// an agent part that names another node stays below the id of this one
		assert.equal(
			storageRequestOf("PUT", "/shop/Type/window_0_1/n-ffffffffffffffff/x/data.data", q(), UID).path,
			`/shop/Type/window_0_1/${UID}/n-ffffffffffffffff/x/data.data`,
		);
		for (const path of [
			"/shop/Indicators/Confidence/remote/confidence.data",
			"/shop/Indicators/Confidence/processed/confidence.data",
			"/shop/tuning/decisions.data",
			"/shop/Indicators/Confidence/internal/lastModified.data",
			"/shop/Type/window_0_1/data.data",
			"/shop/Type/window_x/agent/data.data",
		]) {
			assert.equal(storageRequestOf("PUT", path, q(), UID).status, 403, path);
		}
		assert.equal(storageRequestOf("DELETE", "/shop/Type/window_0_1/a/data.data", q(), UID).status, 405);
	});

	test("the notification to smartsync: its known fields, valid", () => {
		assert.deepEqual(
			syncNotificationOf({ assetId: "shop", type: "Indicators/Confidence", windowId: "window_0_1", extra: 1 }),
			{ assetId: "shop", type: "Indicators/Confidence", windowId: "window_0_1" },
		);
		assert.equal(syncNotificationOf({ assetId: "../x", type: "Type", windowId: "window_0_1" }), null);
		assert.equal(syncNotificationOf({ assetId: "a/b", type: "Type", windowId: "window_0_1" }), null);
		assert.equal(syncNotificationOf({ assetId: "shop", type: "Type;rm", windowId: "window_0_1" }), null);
		assert.equal(syncNotificationOf({ assetId: "shop", type: "Type", windowId: "window" }), null);
		assert.equal(syncNotificationOf(null), null);
	});

	test("the relay takes /api of the agent to the routes of the manager", () => {
		const url = (s) => s;
		assert.equal(
			storageTarget(url("/api//shop/tuning/decisions.data"), "GET"),
			"/api/nginxions/nodes/learning/storage//shop/tuning/decisions.data",
		);
		assert.equal(
			storageTarget(url("/api/?list-type=2&prefix=/shop"), "GET"),
			"/api/nginxions/nodes/learning/storage/?list-type=2&prefix=/shop",
		);
		assert.equal(
			storageTarget(url("/api//a/../../x"), "GET"),
			"/api/nginxions/nodes/learning/storage//a/../../x",
			"the path goes as sent: the manager judges it",
		);
		assert.equal(storageTarget(url("/health/live"), "GET"), null);
		assert.equal(storageTarget(url("/api/x"), "DELETE"), null);
		assert.equal(syncTarget(url("/api/sync"), "POST"), "/api/nginxions/nodes/learning/sync");
		assert.equal(syncTarget(url("/api/sync"), "GET"), null);
		assert.equal(syncTarget(url("/api/other"), "POST"), null);
	});
});
