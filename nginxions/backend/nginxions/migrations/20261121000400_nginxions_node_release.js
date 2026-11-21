import { migrate as logger } from "../../logger.js";

const migrateName = "nginxions_node_release";

/**
 * How the packages reach the nodes (docs/ROADMAP.md, phase 15, step 15.2; docs/adr/0012-nodes.md 5a):
 *   - nginxions_label_host: proxy hosts given to a label: every node with the label serves them;
 *   - nginxions_node_package: the packages a manager gave each node (the last 20), so a node can be held on one of
 *     them: "back to this package" in the GUI, or the nodes left out of a staged rollout;
 *   - nginxions_node: canary (the nodes a staged rollout reaches first), pinned_version / pinned_by (the package a
 *     node is held on, and why: "manual" for a rollback, "staged" while a staged rollout waits).
 */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	await knex.schema.createTable("nginxions_label_host", (table) => {
		table.string("label", 32).notNull();
		table.integer("proxy_host_id").notNull();
		table.primary(["label", "proxy_host_id"]);
	});
	await knex.schema.createTable("nginxions_node_package", (table) => {
		table.increments().primary();
		table.integer("node_id").notNull().index();
		table.string("version", 64).notNull();
		table.text("body", "longtext").notNull();
		table.dateTime("created_on").notNull();
		table.unique(["node_id", "version"]);
	});
	await knex.schema.alterTable("nginxions_node", (table) => {
		table.boolean("canary").notNull().defaultTo(false);
		table.string("pinned_version", 64).nullable();
		table.string("pinned_by", 16).nullable();
	});
	logger.info(`[${migrateName}] nginxions_label_host, nginxions_node_package, nginxions_node.canary/pinned created`);
};

const down = async (knex) => {
	await knex.schema.alterTable("nginxions_node", (table) => {
		table.dropColumn("canary");
		table.dropColumn("pinned_version");
		table.dropColumn("pinned_by");
	});
	await knex.schema.dropTableIfExists("nginxions_node_package");
	await knex.schema.dropTableIfExists("nginxions_label_host");
};

export { down, up };
