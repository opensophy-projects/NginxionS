import db from "../../db.js";
import errs from "../../lib/error.js";
import userModel from "../../models/user.js";

export const isAdminRoles = (roles) =>
	(typeof roles === "string" ? JSON.parse(roles) : (roles ?? [])).includes("admin");

export const withRbacWrite = (change) =>
	db().transaction(async (trx) => {
		// The check and the write must see the same set of active administrators and role memberships.
		// PostgreSQL and MySQL lock the built-in role row; SQLite serializes transactions on one connection.
		const lock = await trx("nginxions_role").select("id").where({ builtin: "administrator" }).forUpdate().first();
		if (!lock) throw new errs.InternalError("Administrator role is missing");
		return change(trx);
	});

export const hasOtherActiveAdministrator = async (trx, id) => {
	const remaining = await userModel
		.query(trx)
		.select("roles")
		.where({ is_deleted: 0, is_disabled: 0 })
		.whereNot("id", id);
	return remaining.some((user) => isAdminRoles(user.roles));
};

export const assertActiveAdministrator = async (trx, current, changes) => {
	if (current.is_deleted || current.is_disabled || !isAdminRoles(current.roles)) return;
	const next = { ...current, ...changes };
	if (!next.is_deleted && !next.is_disabled && isAdminRoles(next.roles)) return;
	if (!(await hasOtherActiveAdministrator(trx, current.id))) {
		throw new errs.ValidationError("The last active administrator cannot be removed, disabled or demoted");
	}
};
