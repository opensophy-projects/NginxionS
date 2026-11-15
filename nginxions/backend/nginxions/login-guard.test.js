import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import errs from "../lib/error.js";
import {
	assertNotLocked,
	guarded,
	LOCK_MS,
	LoginLockedError,
	MAX_FAILURES,
	recordFailure,
	resetLoginGuard,
	WINDOW_MS,
} from "./login-guard.js";

beforeEach(() => resetLoginGuard());

const wrong = () => Promise.reject(new errs.AuthError("Invalid email or password"));

test("an account is locked after a series of wrong passwords, even for the right one", async () => {
	for (let i = 0; i < MAX_FAILURES; i++) {
		await assert.rejects(guarded("password", "Admin@Example.com", wrong), errs.AuthError);
	}
	// the same account whatever the case and spaces of the email
	await assert.rejects(
		guarded("password", " admin@example.com ", async () => "token"),
		(err) => err instanceof LoginLockedError && err.status === 429,
	);
	// another account is not touched
	assert.equal(await guarded("password", "other@example.com", async () => "token"), "token");
});

test("a success clears the count; other errors are not counted", async () => {
	for (let i = 0; i < MAX_FAILURES - 1; i++) await assert.rejects(guarded("password", "a@b.c", wrong));
	assert.equal(await guarded("password", "a@b.c", async () => "ok"), "ok");
	for (let i = 0; i < MAX_FAILURES - 1; i++) await assert.rejects(guarded("password", "a@b.c", wrong));
	await assert.rejects(
		guarded("password", "a@b.c", () => Promise.reject(new Error("database down"))),
		/database/,
	);
	assert.equal(await guarded("password", "a@b.c", async () => "ok"), "ok");
});

test("the lock ends after LOCK_MS; failures older than the window start again", () => {
	const t0 = 1_000_000;
	for (let i = 0; i < MAX_FAILURES; i++) recordFailure("2fa", 7, t0);
	assert.throws(() => assertNotLocked("2fa", 7, t0 + LOCK_MS - 1), LoginLockedError);
	assertNotLocked("2fa", 7, t0 + LOCK_MS + 1);
	// spread over more than the window: never locked
	for (let i = 0; i < MAX_FAILURES * 2; i++) recordFailure("password", "slow@x.y", t0 + i * (WINDOW_MS / 2 + 1));
	assertNotLocked("password", "slow@x.y", t0 + MAX_FAILURES * 2 * (WINDOW_MS / 2 + 1));
});
