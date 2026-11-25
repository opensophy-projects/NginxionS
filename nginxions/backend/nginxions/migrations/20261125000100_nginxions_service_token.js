export async function up(knex) {
	await knex.schema.createTable("nginxions_service_token", (table) => {
		table.increments("id");
		table.string("name", 100).notNullable();
		table.integer("created_by").unsigned().notNullable();
		table.string("token_digest", 64).notNullable().unique();
		table.dateTime("created_on").notNullable();
		table.dateTime("expires_on").notNullable();
		table.dateTime("revoked_on");
	});
	await knex.schema.createTable("nginxions_service_token_role", (table) => {
		table
			.integer("token_id")
			.unsigned()
			.notNullable()
			.references("id")
			.inTable("nginxions_service_token")
			.onDelete("CASCADE");
		table
			.integer("role_id")
			.unsigned()
			.notNullable()
			.references("id")
			.inTable("nginxions_role")
			.onDelete("CASCADE");
		table.primary(["token_id", "role_id"]);
		table.index("role_id");
	});
}

export async function down(knex) {
	await knex.schema.dropTable("nginxions_service_token_role");
	await knex.schema.dropTable("nginxions_service_token");
}
