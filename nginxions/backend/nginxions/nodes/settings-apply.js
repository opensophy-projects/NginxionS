// The settings a node takes from the package of its manager besides its hosts (docs/ROADMAP.md, phase 15, step 15.2;
// docs/adr/0012-nodes.md 5a): the block page and the settings of CrowdSec (profiles, allowlist, scenarios, bouncer).
// Each is applied only when it differs from what the node has, through the same functions as the GUI (CrowdSec checks
// its files and rolls back on its own). The secret key of a captcha never leaves the manager: the node keeps its own;
// a captcha without one on the node is told, and its CrowdSec stays as it is.
import { getSetting } from "../settings.js";
import { canonical } from "./package-model.js";

/** the node itself applies what its manager decided (audit: the system) */
const SYSTEM = { can: async () => true, token: { getUserId: () => 0 } };

/** the settings of CrowdSec as a node gets them: without the secret of the captcha */
export const crowdsecForNodes = (settings) => {
	if (!settings) return undefined;
	const captcha = { ...(settings.bouncer?.captcha ?? {}), secret_key: "" };
	return { ...settings, bouncer: { ...(settings.bouncer ?? {}), captcha } };
};

const defaultIo = {
	setBlockPage: async (data) => (await import("../block-page.js")).default.set(SYSTEM, data),
	setCrowdsec: async (data) => (await import("../crowdsec/index.js")).default.setSettings(SYSTEM, data),
};

/**
 * @param {{block_page?: object, crowdsec?: object}} content  the content of the package
 * @returns {Promise<string>} what failed ("" when all is applied)
 */
export const applySettings = async (content, io = defaultIo) => {
	const errors = [];
	if (content.block_page) {
		try {
			if (canonical(await getSetting("block.page")) !== canonical(content.block_page)) {
				await io.setBlockPage(content.block_page);
			}
		} catch (err) {
			errors.push(`block page: ${err.message}`);
		}
	}
	if (content.crowdsec) {
		try {
			const own = await getSetting("crowdsec");
			if (canonical(crowdsecForNodes(own)) !== canonical(content.crowdsec)) {
				if (content.crowdsec.bouncer?.captcha?.provider && !own.bouncer?.captcha?.secret_key) {
					throw new Error("the captcha needs its secret key on this node (Agents → CrowdSec here)");
				}
				// an empty secret keeps the one of this node
				await io.setCrowdsec(content.crowdsec);
			}
		} catch (err) {
			errors.push(`CrowdSec: ${err.message}`);
		}
	}
	return errors.join("; ").slice(0, 300);
};
