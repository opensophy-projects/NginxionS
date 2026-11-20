// The role of this server in the learning of several servers (step 15.4, docs/adr/0012-nodes.md 5c), from what it is:
//   - smartsync: it has active nodes (a manager): smartsync of its openappsec container puts the learning together;
//   - viaManager: it is a node of a manager (not disabled): its agent learns through the manager (relay.js).
// Both at once is a manager that is a node of itself (the smoke test) or of another manager: the agent of this server
// learns through that manager, smartsync here serves the nodes of this one.
import { readFile } from "node:fs/promises";
import db from "../../db.js";
import { debug, global as logger } from "../../logger.js";
import { MEMBER_FILE } from "./model.js";

/** @returns {Promise<{smartsync: boolean, viaManager: boolean}>} */
export const learningRole = async () => {
	let viaManager = false;
	try {
		const state = JSON.parse(await readFile(MEMBER_FILE, "utf8"));
		viaManager = Boolean(state?.manager_url && !state.disabled);
	} catch {
		viaManager = false;
	}
	let smartsync = false;
	try {
		const row = await db()("nginxions_node").where({ status: "active" }).count({ n: "id" }).first();
		smartsync = Number(row?.n ?? 0) > 0;
	} catch (err) {
		// no table yet (a start before the migrations): no nodes
		debug(logger, `Cluster: nodes not counted: ${err.message}`);
	}
	return { smartsync, viaManager };
};
