import { migrate as logger } from "../../logger.js";

const migrateName = "nginxions_node_rollout";

/**
 * The rollout to the nodes (docs/ROADMAP.md, phase 15, step 15.6; docs/adr/0012-nodes.md): what each node applied of
 * its manager and when (a package of configuration, the model of the agent, a learning profile), or what failed.
 * A manager writes a row when the heartbeat of a node tells something new.
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	await knex.schema.createTable("nginxions_node_rollout", (table) => {
		table.increments("id").primary();
		table.integer("node_id").notNull();
		// package, model, profile
		table.string("kind", 16).notNull();
		table.string("version", 64).notNull().defaultTo("");
		// applied, failed
		table.string("result", 8).notNull();
		table.string("error", 300).notNull().defaultTo("");
		table.dateTime("created_on").notNull();
		table.index(["node_id", "created_on"]);
		table.index(["created_on"]);
	});
	logger.info(`[${migrateName}] nginxions_node_rollout created`);
};

const down = async (knex) => {
	await knex.schema.dropTable("nginxions_node_rollout");
};

export { down, up };
