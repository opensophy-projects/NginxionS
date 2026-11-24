import _ from "lodash";
import crypto from "node:crypto";
import { writeFile } from "node:fs/promises";
import errs from "../lib/error.js";
import utils from "../lib/utils.js";
import { gravatar as logger } from "../logger.js";
import authModel from "../models/auth.js";
import userModel from "../models/user.js";
import userPermissionModel from "../models/user_permission.js";
// NginxionS: disabling, deleting and changing administrator flags use the same lock as role changes.
import { assertUserMutation, resolve as resolveRoles } from "../nginxions/rbac/index.js";
import { assertActiveAdministrator, withRbacWrite } from "../nginxions/rbac/write.js";
import internalAuditLog from "./audit-log.js";
import internalToken from "./token.js";
import pjson from "../package.json" with { type: "json" };

const omissions = () => {
	return ["is_deleted", "permissions.id", "permissions.user_id", "permissions.created_on", "permissions.modified_on"];
};

// NginxionS: read the latest user under the lock and preserve at least one active administrator.
const withAccountChange = (access, id, changes, change) =>
	withRbacWrite(async (trx) => {
		const user = await userModel.query(trx).where({ id, is_deleted: 0 }).withGraphFetched("permissions").first();
		if (!user) throw new errs.ItemNotFoundError(id);
		await assertUserMutation(access, user, trx, changes);
		await assertActiveAdministrator(trx, user, changes);
		return change(trx, user);
	});

const internalUser = {
	/**
	 * Create a user can happen unauthenticated only once and only when no active users exist.
	 * Otherwise, a valid auth method is required.
	 *
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @returns {Promise}
	 */
	create: async (access, data) => {
		const auth = data.auth || null;
		delete data.auth;

		data.avatar = data.avatar || "";
		data.roles = data.roles || [];

		data.email = data.email.toLowerCase().trim();
		if (typeof data.is_disabled !== "undefined") {
			data.is_disabled = data.is_disabled ? 1 : 0;
		}

		await access.can("users:create", data);

		// NginxionS: awaited (an un-awaited rejection crashed the backend and let duplicates through)
		// and checked after the permission check, so it does not reveal registered emails
		if (!(await internalUser.isEmailAvailable(data.email))) {
			throw new errs.ValidationError(`Email address already in use - ${data.email}`);
		}

		if (process.env.DISABLE_GRAVATAR === "true") {
			data.avatar = "/images/default-avatar.jpg";
		} else {
			try {
				const hash = crypto.createHash("sha256").update(data.email.trim().toLowerCase()).digest("hex");
				const response = await fetch(
					`https://www.gravatar.com/avatar/${hash}?s=64&default=initials&name=${encodeURIComponent(
						data.name
							.split(" ")
							.map((n) => n[0])
							.join(""),
					)}`,
					{
						headers: {
							"User-Agent": `NPMplus/${pjson.version}`,
						},
					},
				);

				if (!response.ok) throw new Error(`Status code: ${response.status}`);

				let ext;
				switch (response.headers.get("content-type")) {
					case "image/png":
						ext = "png";
						break;
					case "image/jpeg":
						ext = "jpeg";
						break;
					case "image/gif":
						ext = "gif";
						break;
					default:
						throw new Error();
				}

				const buffer = await response.arrayBuffer();
				await writeFile(`/data/npmplus/gravatar/${hash}.${ext}`, Buffer.from(buffer));

				data.avatar = `/images/gravatar/${hash}.${ext}`;
			} catch (err) {
				logger.error(`Error downloading gravatar: ${err.message}`);
				data.avatar = "/images/default-avatar.jpg";
			}
		}

		// NginxionS: creation and the projection of the initial roles use the new user ID.
		const id = await withRbacWrite(async (trx) => {
			const created = await userModel.query(trx).insertAndFetch(data);
			if (auth) {
				await authModel.query(trx).insert({
					user_id: created.id,
					type: auth.type,
					secret: auth.secret,
					meta: {},
				});
			}
			await resolveRoles(created, trx);
			return created.id;
		});
		const user = await internalUser.get(access, { id, expand: ["permissions"] });

		await internalAuditLog.add(access, {
			action: "created",
			object_type: "user",
			object_id: id,
			meta: user,
		});

		return user;
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Integer} data.id
	 * @param  {String}  [data.email]
	 * @param  {String}  [data.name]
	 * @return {Promise}
	 */
	update: (access, data) => {
		if (typeof data.is_disabled !== "undefined") {
			data.is_disabled = data.is_disabled ? 1 : 0;
		}

		return access
			.can("users:permissions", data.id)
			.catch(() => {
				delete data.roles;
			})
			.then(() => {
				return access.can("users:update", data.id);
			})
			.then(() => {
				// Make sure that the user being updated doesn't change their email to another user that is already using it
				// 1. get user we want to update
				return internalUser.get(access, { id: data.id }).then((user) => {
					// 2. if email is to be changed, find other users with that email
					if (typeof data.email !== "undefined") {
						data.email = data.email.toLowerCase().trim();

						if (user.email !== data.email) {
							return internalUser.isEmailAvailable(data.email, data.id).then((available) => {
								if (!available) {
									throw new errs.ValidationError(`Email address already in use - ${data.email}`);
								}
								return user;
							});
						}
					}

					// No change to email:
					return user;
				});
			})
			.then(async (user) => {
				if (user.id !== data.id) {
					// Sanity check that something crazy hasn't happened
					throw new errs.InternalValidationError(
						`User could not be updated, IDs do not match: ${user.id} !== ${data.id}`,
					);
				}

				if (process.env.DISABLE_GRAVATAR === "true") {
					data.avatar = "/images/default-avatar.jpg";
				} else {
					try {
						const hash = crypto
							.createHash("sha256")
							.update((data.email || user.email).trim().toLowerCase())
							.digest("hex");
						const response = await fetch(
							`https://www.gravatar.com/avatar/${hash}?s=64&default=initials&name=${encodeURIComponent(
								(data.name || user.name)
									.split(" ")
									.map((n) => n[0])
									.join(""),
							)}`,
							{
								headers: {
									"User-Agent": `NPMplus/${pjson.version}`,
								},
							},
						);

						if (!response.ok) throw new Error(`Status code: ${response.status}`);

						let ext;
						switch (response.headers.get("content-type")) {
							case "image/png":
								ext = "png";
								break;
							case "image/jpeg":
								ext = "jpg";
								break;
							case "image/gif":
								ext = "gif";
								break;
							default:
								throw new Error();
						}

						const buffer = await response.arrayBuffer();
						await writeFile(`/data/npmplus/gravatar/${hash}.${ext}`, Buffer.from(buffer));

						data.avatar = `/images/gravatar/${hash}.${ext}`;
					} catch (err) {
						logger.error(`Error downloading gravatar: ${err.message}`);
						data.avatar = "/images/default-avatar.jpg";
					}
				}

				// NginxionS: guard the final write after profile validation and avatar loading.
				return withAccountChange(access, user.id, data, async (trx, current) => {
					await userModel.query(trx).patch(data).where("id", current.id);
					if (data.roles !== undefined) await resolveRoles({ ...current, roles: data.roles }, trx);
					await internalAuditLog.add(
						access,
						{
							action: "updated",
							object_type: "user",
							object_id: current.id,
							meta: { ...data, id: current.id, name: data.name ?? current.name },
						},
						trx,
					);
				});
			})
			.then(() => internalUser.get(access, { id: data.id }));
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   [data]
	 * @param  {Integer}  [data.id]          Defaults to the token user
	 * @param  {Array}    [data.expand]
	 * @param  {Array}    [data.omit]
	 * @return {Promise}
	 */
	get: (access, data) => {
		const thisData = data || {};

		if (typeof thisData.id === "undefined" || !thisData.id) {
			thisData.id = access.token.getUserId(0);
		}

		return access
			.can("users:get", thisData.id)
			.then(() => {
				const query = userModel
					.query()
					.where("is_deleted", 0)
					.andWhere("id", thisData.id)
					.allowGraph("[permissions]")
					.first();

				if (typeof thisData.expand !== "undefined" && thisData.expand !== null) {
					query.withGraphFetched(`[${thisData.expand.join(", ")}]`);
				}

				return query.then(utils.omitRow(omissions()));
			})
			.then((row) => {
				if (!row?.id) {
					throw new errs.ItemNotFoundError(thisData.id);
				}
				// Custom omissions
				if (typeof thisData.omit !== "undefined" && thisData.omit !== null) {
					return _.omit(row, thisData.omit);
				}

				if (row.avatar === "") {
					row.avatar = "/images/default-avatar.jpg";
				}

				return row;
			});
	},

	/**
	 * Checks if an email address is available, but if a user_id is supplied, it will ignore checking
	 * against that user.
	 *
	 * @param email
	 * @param user_id
	 */
	isEmailAvailable: (email, user_id) => {
		const query = userModel.query().where("email", "=", email.toLowerCase().trim()).where("is_deleted", 0).first();

		if (typeof user_id !== "undefined") {
			query.where("id", "!=", user_id);
		}

		return query.then((user) => {
			return !user;
		});
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Integer} data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	delete: (access, data) => {
		return access
			.can("users:delete", data.id)
			.then(() => {
				return internalUser.get(access, { id: data.id });
			})
			.then((user) => {
				if (!user) {
					throw new errs.ItemNotFoundError(data.id);
				}

				// Make sure user can't delete themselves
				if (user.id === access.token.getUserId(0)) {
					throw new errs.PermissionError("You cannot delete yourself.");
				}

				// NginxionS: deleting an account must preserve the active administrator.
				return withAccountChange(access, user.id, { is_deleted: 1 }, async (trx, current) => {
					await userModel.query(trx).where("id", current.id).patch({ is_deleted: 1 });
					await internalAuditLog.add(
						access,
						{
							action: "deleted",
							object_type: "user",
							object_id: current.id,
							meta: _.omit(current, omissions()),
						},
						trx,
					);
				});
			})
			.then(() => {
				return true;
			});
	},

	/**
	 * This will only count the users
	 *
	 * @param   {Access}  access
	 * @param   {String}  [search_query]
	 * @returns {*}
	 */
	getCount: (access, search_query) => {
		return access
			.can("users:list")
			.then(() => {
				const query = userModel.query().count("id as count").where("is_deleted", 0).first();

				// Query is used for searching
				if (typeof search_query === "string") {
					query.where(function () {
						this.where("user.name", "like", `%${search_query}%`).orWhere(
							"user.email",
							"like",
							`%${search_query}%`,
						);
					});
				}

				return query;
			})
			.then((row) => {
				return Number.parseInt(row.count, 10);
			});
	},

	/**
	 * All users
	 *
	 * @param   {Access}  access
	 * @param   {Array}   [expand]
	 * @param   {String}  [search_query]
	 * @returns {Promise}
	 */
	getAll: async (access, expand, search_query) => {
		await access.can("users:list");
		const query = userModel
			.query()
			.where("is_deleted", 0)
			.groupBy("id")
			.allowGraph("[permissions]")
			.orderBy("name", "ASC");

		// Query is used for searching
		if (typeof search_query === "string") {
			query.where(function () {
				this.where("name", "like", `%${search_query}%`).orWhere("email", "like", `%${search_query}%`);
			});
		}

		if (typeof expand !== "undefined" && expand !== null) {
			query.withGraphFetched(`[${expand.join(", ")}]`);
		}

		const res = await query;
		return utils.omitRows(omissions())(res);
	},

	/**
	 * @param   {Access} access
	 * @param   {Integer} [id_requested]
	 * @returns {[String]}
	 */
	getUserOmisionsByAccess: (access, idRequested) => {
		let response = []; // Admin response

		if (!access.token.hasScope("admin") && access.token.getUserId(0) !== idRequested) {
			response = ["is_deleted"]; // Restricted response
		}

		return response;
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Integer} data.id
	 * @param  {String}  data.type
	 * @param  {String}  data.secret
	 * @return {Promise}
	 */
	setPassword: (access, data) => {
		return (
			access
				.can("users:password", data.id)
				.then(() => {
					return internalUser.get(access, { id: data.id });
				})
				.then((user) => {
					if (user.id !== data.id) {
						// Sanity check that something crazy hasn't happened
						throw new errs.InternalValidationError(
							`User could not be updated, IDs do not match: ${user.id} !== ${data.id}`,
						);
					}

					if (user.id === access.token.getUserId(0)) {
						// they're setting their own password. Make sure their current password is correct
						if (typeof data.current === "undefined" || !data.current) {
							throw new errs.ValidationError("Current password was not supplied");
						}

						return internalToken
							.getTokenFromEmail({
								identity: user.email.toLowerCase().trim(),
								secret: data.current,
							})
							.then(() => {
								return user;
							});
					}

					return user;
				})
				// NginxionS: delegated account changes must respect role changes made during password verification.
				.then((user) =>
					withAccountChange(access, user.id, {}, async (trx, current) => {
						const existing = await authModel
							.query(trx)
							.where({ user_id: current.id, type: data.type })
							.first();
						if (existing) {
							await authModel
								.query(trx)
								.where("id", existing.id)
								.patch({ type: data.type, secret: data.secret });
						} else {
							await authModel
								.query(trx)
								.insert({ user_id: current.id, type: data.type, secret: data.secret, meta: {} });
						}
						await internalAuditLog.add(
							access,
							{
								action: "updated",
								object_type: "user",
								object_id: current.id,
								meta: { name: current.name, password_changed: true, auth_type: data.type },
							},
							trx,
						);
					}),
				)
				.then(() => {
					return true;
				})
		);
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @return {Promise}
	 */
	setPermissions: (access, data) => {
		return access
			.can("users:permissions", data.id)
			.then(() => {
				return internalUser.get(access, { id: data.id });
			})
			.then((user) => {
				if (user.id !== data.id) {
					// Sanity check that something crazy hasn't happened
					throw new errs.InternalValidationError(
						`User could not be updated, IDs do not match: ${user.id} !== ${data.id}`,
					);
				}

				return user;
			})
			.then((user) => {
				// Get perms row, patch if it exists
				return userPermissionModel
					.query()
					.where("user_id", user.id)
					.first()
					.then((existing_auth) => {
						if (existing_auth) {
							// patch
							return userPermissionModel
								.query()
								.where("user_id", user.id)
								.patchAndFetchById(existing_auth.id, _.assign({ user_id: user.id }, data));
						}
						// insert
						return userPermissionModel.query().insertAndFetch(_.assign({ user_id: user.id }, data));
					})
					.then((permissions) => {
						// Add to Audit Log
						return internalAuditLog.add(access, {
							action: "updated",
							object_type: "user",
							object_id: user.id,
							meta: {
								name: user.name,
								permissions: permissions,
							},
						});
					});
			})
			.then(() => {
				return true;
			});
	},

	/**
	 * @param {Access}   access
	 * @param {Object}   data
	 * @param {Integer}  data.id
	 */
	loginAs: (access, data) => {
		return access
			.can("users:loginas", data.id)
			.then(() => {
				return internalUser.get(access, data);
			})
			.then((user) => {
				return internalToken.getTokenFromUser(user);
			});
	},
};

export default internalUser;
