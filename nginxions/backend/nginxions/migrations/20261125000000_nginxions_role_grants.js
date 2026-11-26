import { migrate as logger } from "../../logger.js";

export async function up(knex) {
	await knex.schema.alterTable("nginxions_user_role", (table) => {
		table.boolean("manual_grant").notNullable().defaultTo(true);
		table.boolean("oidc_grant").notNullable().defaultTo(false);
	});

	// Older OIDC refreshes replaced all non-administrator memberships. The newest role-writing
	// audit entry identifies these grants. Keep unclassified grants and legacy administrator flags.
	const assigned = new Set(await knex("nginxions_user_role").distinct("user_id").pluck("user_id"));
	const batchSize = 1000;
	let before;
	while (assigned.size) {
		const query = knex("audit_log")
			.where({ object_type: "user" })
			.whereIn("action", ["created", "updated"])
			.select("id", "object_id", "meta")
			.orderBy("id", "desc")
			.limit(batchSize);
		if (before !== undefined) query.where("id", "<", before);
		const entries = await query;
		for (const { object_id, meta } of entries) {
			if (!assigned.has(object_id)) continue;
			const value = typeof meta === "string" ? JSON.parse(meta) : meta;
			if (!Array.isArray(value?.roles)) continue;
			assigned.delete(object_id);
			if (value.source === "oidc") {
				await knex("nginxions_user_role")
					.where({ user_id: object_id })
					.update({ manual_grant: false, oidc_grant: true });
			}
		}
		if (entries.length < batchSize) break;
		before = entries.at(-1).id;
	}
	logger.info("Manual and OIDC grants are tracked separately");
}

export async function down(knex) {
	await knex("nginxions_user_role")
		.whereIn("role_id", knex("nginxions_role").where({ builtin: "administrator" }).select("id"))
		.delete();
	await knex.schema.alterTable("nginxions_user_role", (table) => {
		table.dropColumns("manual_grant", "oidc_grant");
	});
}
