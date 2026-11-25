import Access from "../access.js";
// NginxionS: service credentials are only accepted on explicitly enabled API routes.
import { authenticateServiceToken, serviceCredential } from "../../nginxions/rbac/service-tokens.js";
import errs from "../error.js";

const loadSession = async (token, res, next) => {
	try {
		const access = new Access(token);
		await access.load();
		res.locals.access = access;
	} catch {
		res.clearCookie("__Host-Http-token", {
			httpOnly: true,
			secure: true,
			sameSite: "Strict",
		});
		return res.status(403).json({
			error: {
				message: "Invalid or expired token",
			},
		});
	}
	return next();
};

const loadService = async (secret, res, next) => {
	try {
		res.locals.access = await authenticateServiceToken(secret);
	} catch (err) {
		if (err instanceof errs.AuthError) {
			return res
				.status(401)
				.set("WWW-Authenticate", "Bearer")
				.json({
					error: { code: 401, message: "Invalid or expired service token" },
				});
		}
		return next(err);
	}
	return next();
};

const rejectService = (_secret, _res, next) => next(new errs.PermissionError());

// NginxionS: give an explicit service credential precedence over the cookie. Each credential
// is sent to exactly one handler, and the route controls which kinds of credential it accepts.
const requestCredential = (req) => {
	const service = serviceCredential(req.get("authorization"));
	if (service !== undefined) return { kind: "service", value: service };
	return { kind: "session", value: req.signedCookies?.["__Host-Http-token"] || null };
};

export default ({ serviceTokens = false } = {}) => {
	const methods = {
		session: loadSession,
		service: serviceTokens ? loadService : rejectService,
	};
	return (req, res, next) => {
		res.locals.access = null;
		const { kind, value } = requestCredential(req);
		return methods[kind](value, res, next);
	};
};
