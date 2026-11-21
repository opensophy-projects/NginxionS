import { migrate as logger } from "../../logger.js";

const migrateName = "nginxions_node_command";

/**
 * A command of the manager to a node (docs/ROADMAP.md, phase 15, step 15.6; docs/adr/0012-nodes.md): the manager never
 * calls a node, so a command (restart the agent) waits here and goes to the node with the answer to its next
 * heartbeat; the node tells it is done with the heartbeat after.
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	await knex.schema.alterTable("nginxions_node", (table) => {
		table.string("command", 32).nullable();
		table.string("command_id", 16).nullable();
		table.dateTime("command_on").nullable();
	});
	logger.info(`[${migrateName}] nginxions_node.command added`);
};

const down = async (knex) => {
	await knex.schema.alterTable("nginxions_node", (table) => {
		table.dropColumn("command");
		table.dropColumn("command_id");
		table.dropColumn("command_on");
	});
};

export { down, up };
