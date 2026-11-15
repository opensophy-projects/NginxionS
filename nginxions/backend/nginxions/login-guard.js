// Login lockout: after MAX_FAILURES wrong passwords for one account (or wrong 2FA codes for one user) within WINDOW_MS,
// that account is locked for LOCK_MS, whatever the address the attempts come from. The limit per address
// (routes/tokens.js: 10 failures in 5 min) stops one source; this one stops a guess spread over many. A locked
// account answers 429 even to the right password, and an unknown email is counted the same way, so the answer does not
// tell whether an account exists. In memory: a restart of nginxions clears it (an administrator locked out waits, or
// restarts the container).
import errs from "../lib/error.js";
import { global as logger } from "../logger.js";

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;
/** entries kept at most (the oldest go first): a flood of made-up emails cannot fill the memory */
const MAX_ENTRIES = 10000;

/** @type {Map<string, {count: number, first: number, lockedUntil: number}>} */
const entries = new Map();

const keyOf = (kind, id) =>
	`${kind}:${String(id ?? "")
		.toLowerCase()
		.trim()}`;

export class LoginLockedError extends Error {
	constructor(until) {
		super(`Too many failed attempts: the account is locked until ${new Date(until).toISOString()}`);
		this.name = "LoginLockedError";
		this.status = 429;
		this.public = true;
		this.retryAfter = Math.max(1, Math.ceil((until - Date.now()) / 1000));
	}
}

/**
 * @param {"password" | "2fa"} kind
 * @param {string | number} id  the email, or the id of the user for 2FA
 * @param {number} [now]
 */
export const assertNotLocked = (kind, id, now = Date.now()) => {
	const entry = entries.get(keyOf(kind, id));
	if (entry && entry.lockedUntil > now) throw new LoginLockedError(entry.lockedUntil);
};

/** a wrong password or code: counted, and the account locked at the limit */
export const recordFailure = (kind, id, now = Date.now()) => {
	const key = keyOf(kind, id);
	let entry = entries.get(key);
	if (!entry || now - entry.first > WINDOW_MS || (entry.lockedUntil && entry.lockedUntil <= now)) {
		entry = { count: 0, first: now, lockedUntil: 0 };
	}
	entry.count += 1;
	if (entry.count >= MAX_FAILURES) {
		entry.lockedUntil = now + LOCK_MS;
		logger.warn(
			`Login: ${kind} of ${String(id).slice(0, 200)} locked for ${LOCK_MS / 60000} min after ${entry.count} failures`,
		);
	}
	entries.delete(key);
	entries.set(key, entry);
	while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
};

/** a successful login clears the count */
export const recordSuccess = (kind, id) => {
	entries.delete(keyOf(kind, id));
};

/**
 * Runs a login step: refused while locked, a failure of the step (errs.AuthError) counted.
 * @template T
 * @param {"password" | "2fa"} kind
 * @param {string | number} id
 * @param {() => Promise<T>} step
 * @returns {Promise<T>}
 */
export const guarded = async (kind, id, step) => {
	assertNotLocked(kind, id);
	try {
		const result = await step();
		recordSuccess(kind, id);
		return result;
	} catch (err) {
		if (err instanceof errs.AuthError) recordFailure(kind, id);
		throw err;
	}
};

/** for the tests */
export const resetLoginGuard = () => entries.clear();
