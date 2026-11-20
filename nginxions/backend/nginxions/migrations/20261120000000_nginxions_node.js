import { migrate as logger } from "../../logger.js";

const migrateName = "nginxions_node";

/**
 * Servers of NginxionS connected to this one (docs/ROADMAP.md, phase 15; docs/adr/0012-nodes.md). uid is the node_id of
 * the rows that come from the node ("local" stays this server). A node is added with a one-time join code (only its
 * hash), registered with a CSR signed by the PKI, then sends a heartbeat with its token (only its hash).
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	await knex.schema.createTable("nginxions_node", (table) => {
		table.increments("id").primary();
		table.dateTime("created_on").notNull();
		table.dateTime("modified_on").notNull();
		table.string("uid", 64).notNull().unique();
		table.string("name", 100).notNull();
		// pending (waits for its registration), active, revoked
		table.string("status", 16).notNull().defaultTo("pending");
		table.text("labels").notNull();
		table.string("code_hash", 64);
		table.dateTime("code_expires_on");
		table.string("token_hash", 64);
		table.integer("cert_id");
		table.string("fingerprint", 128).notNull().defaultTo("");
		table.dateTime("registered_on");
		table.dateTime("last_seen_on");
		table.string("address", 64).notNull().defaultTo("");
		// what the node tells in its heartbeat: version, agent, nginx, hosts
		table.text("info").notNull();
		table.integer("created_by").notNull().defaultTo(0);
	});
	logger.info(`[${migrateName}] nginxions_node created`);
};

const down = async (knex) => {
	await knex.schema.dropTable("nginxions_node");
};

export { down, up };
