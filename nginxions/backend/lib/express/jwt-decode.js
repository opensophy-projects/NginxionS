import Access from "../access.js";
// NginxionS: service credentials are only accepted on explicitly enabled API routes.
import { authenticateServiceToken, serviceCredential } from "../../nginxions/rbac/service-tokens.js";
import errs from "../error.js";

export default ({ serviceTokens = false } = {}) => {
	return async (req, res, next) => {
		// NginxionS: a presented credential takes precedence over the browser session.
		const credential = serviceCredential(req.get("authorization"));
		if (credential !== undefined) {
			if (!serviceTokens) return next(new errs.PermissionError());
			try {
				res.locals.access = await authenticateServiceToken(credential);
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
		}

		const token = req.signedCookies?.["__Host-Http-token"] || null;

		//if (!token) {
		//	return res.status(401).json({
		//		error: {
		//			message: "Missing token",
		//		},
		//	});
		//}

		try {
			res.locals.access = null;
			const access = new Access(token);
			await access.load();
			res.locals.access = access;
			next();
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
	};
};
