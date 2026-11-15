import { migrate as logger } from "../../logger.js";

const migrateName = "nginxions_acme_tci_name";

/** The preset of tlscc.ru is the CA of TCI (Технический центр Интернет), not of the ministry: servers named after it. */
const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	await knex("nginxions_acme_server")
		.where({ preset: "tlscc-stage", name: "ТЦИ / НУЦ Минцифры (stage)" })
		.update({ name: "ТЦИ, tlscc.ru (stage)" });
};

const down = async () => {};

export { down, up };
