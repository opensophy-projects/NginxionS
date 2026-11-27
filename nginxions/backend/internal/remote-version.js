// NginxionS: compatibility with the upstream version endpoint and the opt-in environment flag.
import { currentVersion, releaseService } from "../nginxions/system/releases.js";

export default {
	get: async () => {
		const release = process.env.NGINXIONS_CHECK_VERSION === "true" ? await releaseService.check() : null;
		return {
			current: currentVersion,
			latest: release?.tag ?? "unknown",
			update_available: release?.status === "available",
		};
	},
};
