import { migrate as logger } from "../../logger.js";

const migrateName = "nginxions_node_drain";

/**
 * A node taken out of work (docs/ROADMAP.md, phase 15, step 15.6): its package has no hosts while it is drained (the
 * node removes them and serves nothing), its hosts stay given to it and come back when it is put back.
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	await knex.schema.alterTable("nginxions_node", (table) => {
		table.boolean("drained").notNull().defaultTo(false);
	});
	logger.info(`[${migrateName}] nginxions_node.drained added`);
};

const down = async (knex) => {
	await knex.schema.alterTable("nginxions_node", (table) => {
		table.dropColumn("drained");
	});
};

export { down, up };
