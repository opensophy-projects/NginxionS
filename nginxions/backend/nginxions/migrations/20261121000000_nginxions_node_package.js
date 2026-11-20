import { migrate as logger } from "../../logger.js";

const migrateName = "nginxions_node_package";

/**
 * Packages of configuration of nodes (docs/ROADMAP.md, phase 15, step 15.2; docs/adr/0012-nodes.md):
 *   - on a manager, nginxions_node_host: the proxy hosts a node serves;
 *   - on a node, nginxions_managed: the rows it got from its manager (a certificate, an access list, a proxy host)
 *     with the id they have on the manager, so the next package updates them instead of adding copies.
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	await knex.schema.createTable("nginxions_node_host", (table) => {
		table.increments("id").primary();
		table.integer("node_id").notNull();
		table.integer("proxy_host_id").notNull();
		table.unique(["node_id", "proxy_host_id"]);
		table.index(["proxy_host_id"]);
	});
	await knex.schema.createTable("nginxions_managed", (table) => {
		table.increments("id").primary();
		// certificate, access_list, proxy_host
		table.string("kind", 32).notNull();
		table.integer("source_id").notNull();
		table.integer("local_id").notNull();
		table.unique(["kind", "source_id"]);
		table.index(["kind", "local_id"]);
	});
	logger.info(`[${migrateName}] nginxions_node_host, nginxions_managed created`);
};

const down = async (knex) => {
	await knex.schema.dropTable("nginxions_managed");
	await knex.schema.dropTable("nginxions_node_host");
};

export { down, up };
