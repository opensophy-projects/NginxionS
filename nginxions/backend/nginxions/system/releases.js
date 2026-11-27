// Version metadata and user consent for the host updater. The backend has no access to the host updater or Docker.
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RELEASE_API = "https://api.github.com/repos/opensophy-projects/NginxionS/releases/latest";
const RELEASE_TAG = /^[Vv](0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const CACHE_MS = 60_000;
export const currentVersion = process.env.NGINXIONS_BUILD_VERSION || "develop";

const parts = (tag) => (typeof tag === "string" ? RELEASE_TAG.exec(tag)?.slice(1).map(Number) : undefined);

export function newerRelease(current, tag) {
	const next = parts(tag);
	if (!next) return false;
	const installed = parts(current);
	if (!installed) return true;
	const index = next.findIndex((value, i) => value !== installed[i]);
	return index !== -1 && next[index] > installed[index];
}

export function createReleaseService({
	current = currentVersion,
	hostUpdater = process.env.NGINXIONS_HOST_UPDATER === "true",
	directory = "/data/nginxions",
	request = fetch,
	now = Date.now,
} = {}) {
	const canAutoUpdate = hostUpdater && !!parts(current);
	const marker = join(directory, "auto-update");
	let cached;
	let pending;

	const status = async () => {
		let autoUpdate = false;
		if (canAutoUpdate) {
			try {
				autoUpdate = (await readFile(marker, "utf8")) === "true\n";
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
		}
		return { current, canAutoUpdate, autoUpdate };
	};

	const check = async () => {
		if (cached && now() < cached.expires) return cached.result;
		if (!pending) {
			pending = (async () => {
				let result;
				try {
					const response = await request(RELEASE_API, {
						headers: { Accept: "application/vnd.github+json", "User-Agent": "NginxionS" },
						redirect: "error",
						signal: AbortSignal.timeout(5000),
					});
					if (response.status === 404) {
						result = { status: "unpublished" };
					} else {
						if (!response.ok) throw new Error("Release metadata is unavailable");
						const release = await response.json();
						const tag = release?.tag_name;
						if (release?.draft || release?.prerelease || !parts(tag))
							throw new Error("Invalid stable release");
						result = { status: newerRelease(current, tag) ? "available" : "current", tag };
					}
				} catch {
					result = { status: "unavailable" };
				}
				cached = { result, expires: now() + CACHE_MS };
				return result;
			})().finally(() => {
				pending = undefined;
			});
		}
		return pending;
	};

	const setAutoUpdate = async (enabled) => {
		if (!canAutoUpdate || typeof enabled !== "boolean") throw new Error("Host updater unavailable");
		await mkdir(directory, { recursive: true });
		const temporary = await mkdtemp(join(directory, ".update-"));
		try {
			const file = join(temporary, "auto-update");
			await writeFile(file, enabled ? "true\n" : "false\n", { mode: 0o600 });
			await rename(file, marker);
		} finally {
			await rm(temporary, { recursive: true });
		}
		return status();
	};
	return { status, check, setAutoUpdate };
}

export const releaseService = createReleaseService();
