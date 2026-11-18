// NGINXIONS_TEST_POSTGRES=1 too: a guard against a real database in the environment.
// The tests that need PostgreSQL (the SQL of analytics, events and settings uses functions of PostgreSQL such as
// date_bin): they run when DB_POSTGRES_HOST names a database for tests (CI: a postgres service; locally:
// docker run -e POSTGRES_PASSWORD=test -p 55432:5432 postgres, then DB_POSTGRES_HOST=127.0.0.1 DB_POSTGRES_PORT=55432
// DB_POSTGRES_USER=postgres DB_POSTGRES_PASSWORD=test DB_POSTGRES_NAME=postgres). Without it they are skipped.
// Each file of tests gets a database of its own next to it (dropped and created again): never point it at a real one.

export const postgres = Boolean(process.env.DB_POSTGRES_HOST) && process.env.NGINXIONS_TEST_POSTGRES === "1";

/**
 * A database of its own for a file of tests (node --test runs the files at the same time), created anew from the
 * database of DB_POSTGRES_NAME, migrated as NginxionS migrates it at its start; the knex of the backend.
 * @param {string} name  a short name of the file of tests ([a-z_])
 */
export const freshDatabase = async (name) => {
	const { default: knex } = await import("knex");
	const base = process.env.DB_POSTGRES_NAME;
	const database = `${base}_test_${name}`;
	const admin = knex({
		client: "pg",
		connection: {
			host: process.env.DB_POSTGRES_HOST,
			port: Number(process.env.DB_POSTGRES_PORT || 5432),
			user: process.env.DB_POSTGRES_USER,
			password: process.env.DB_POSTGRES_PASSWORD,
			database: base,
		},
	});
	try {
		await admin.raw("DROP DATABASE IF EXISTS ?? WITH (FORCE)", [database]);
		await admin.raw("CREATE DATABASE ??", [database]);
	} finally {
		await admin.destroy();
	}
	process.env.DB_POSTGRES_NAME = database;
	// the JWT key pair of the backend is written at its first start: a temporary file, not /data of a real one
	if (!process.env.NGINXIONS_JWT_KEYS_FILE) {
		const { mkdtempSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		process.env.NGINXIONS_JWT_KEYS_FILE = join(mkdtempSync(join(tmpdir(), "nginxions-keys-")), "keys.json");
	}
	const { migrateUp } = await import("../../migrate.js");
	await migrateUp();
	return (await import("../../db.js")).default();
};

/** an access that may do everything (the RBAC has tests of its own) */
export const admin = {
	can: async () => true,
	token: { getUserId: () => 1 },
	allows: () => true,
};
