import { migrate as logger } from "../../logger.js";

const migrateName = "nginxions_event_repeats";

/**
 * Repeated events collapsed into one row: a browser without a client certificate opening a page protected by mTLS
 * sends its page, scripts and API calls at once, every one refused. Refusals of the same source, host and reason
 * within a minute are one event with the number of requests (pki/denials.js).
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	await knex.schema.alterTable("nginxions_security_event", (table) => {
		table.integer("repeats").notNull().defaultTo(1);
	});
	logger.info(`[${migrateName}] nginxions_security_event.repeats added`);
};

const down = async (knex) => {
	await knex.schema.alterTable("nginxions_security_event", (table) => {
		table.dropColumn("repeats");
	});
};

export { down, up };
