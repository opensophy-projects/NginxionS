import { migrate as logger } from "../../logger.js";

const migrateName = "nginxions_cluster_ban";

/**
 * The bans each node of a manager shares with the cluster (docs/ROADMAP.md, phase 15, step 15.3): the manager keeps
 * the last list each node sent (its own bans of CrowdSec and of the agent) and gives every server the bans of the
 * others; each server holds them in its CrowdSec (crowdsec/cluster-bans.js).
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	await knex.schema.createTable("nginxions_cluster_ban", (table) => {
		table.string("origin", 64).notNull();
		table.string("value", 64).notNull();
		table.string("scope", 16).notNull();
		table.string("type", 16).notNull();
		table.dateTime("until").notNull().index();
		table.string("scenario", 255).notNull().defaultTo("");
		table.primary(["origin", "value", "type"]);
	});
	logger.info(`[${migrateName}] nginxions_cluster_ban created`);
};

const down = async (knex) => {
	await knex.schema.dropTableIfExists("nginxions_cluster_ban");
};

export { down, up };
