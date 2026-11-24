import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { freshDatabase, postgres } from "../test/postgres.js";

const listen = async (t, app, tls) => {
	const server = createServer(tls, app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	return `https://127.0.0.1:${server.address().port}`;
};

test("OIDC sign-in assigns, refreshes and revokes roles with a local identity provider", {
	skip: !postgres,
}, async (t) => {
	const db = await freshDatabase("rbac_oidc");
	t.after(() => db.destroy());
	const { default: oidc } = await import("../../routes/oidc.js");
	const { default: User } = await import("../../models/user.js");
	const { default: rbac } = await import("./index.js");
	const admin = await User.query().insert({
		name: "Admin",
		nickname: "admin",
		email: "admin@example.test",
		avatar: "",
		roles: ["admin"],
	});
	const identity = await User.query().insert({
		name: "Viewer",
		nickname: "viewer",
		email: "viewer@example.test",
		avatar: "",
		roles: [],
	});
	const adminAccess = { can: async () => true, token: { getUserId: () => admin.id } };
	const viewerRole = (await rbac.list(adminAccess)).find((role) => role.builtin === "viewer");
	await rbac.update(adminAccess, viewerRole.id, { oidc_groups: ["Readers"] });
	await rbac.setOidc(adminAccess, { claim: "teams", requestScope: true });

	const dir = await mkdtemp(join(tmpdir(), "nginxions-oidc-test-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const keyFile = join(dir, "key.pem");
	const certFile = join(dir, "cert.pem");
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-days",
			"1",
			"-subj",
			"/CN=127.0.0.1",
			"-addext",
			"subjectAltName=IP:127.0.0.1",
			"-keyout",
			keyFile,
			"-out",
			certFile,
		],
		{ stdio: "ignore" },
	);
	const tls = { key: await readFile(keyFile), cert: await readFile(certFile) };
	const originalCas = getCACertificates("default");
	setDefaultCACertificates([...originalCas, tls.cert.toString()]);
	t.after(() => setDefaultCACertificates(originalCas));

	const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const clientId = "nginxions-test";
	const subject = "fixture-viewer";
	let grant;
	let tokenGroups;
	let userinfoGroups;
	let verified = true;
	const provider = express();
	provider.use(express.urlencoded({ extended: false }));
	const issuer = await listen(t, provider, tls);
	provider.get("/.well-known/openid-configuration", (_, res) =>
		res.json({
			issuer,
			authorization_endpoint: `${issuer}/authorize`,
			token_endpoint: `${issuer}/token`,
			userinfo_endpoint: `${issuer}/userinfo`,
			jwks_uri: `${issuer}/jwks`,
			response_types_supported: ["code"],
			subject_types_supported: ["public"],
			id_token_signing_alg_values_supported: ["RS256"],
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
		}),
	);
	provider.get("/jwks", (_, res) =>
		res.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "fixture", alg: "RS256" }] }),
	);
	provider.get("/authorize", (req, res) => {
		grant = req.query;
		const callback = new URL(grant.redirect_uri);
		callback.searchParams.set("code", "fixture-code");
		callback.searchParams.set("state", grant.state);
		res.redirect(callback.toString());
	});
	provider.post("/token", (req, res) => {
		const challenge = createHash("sha256")
			.update(req.body.code_verifier || "")
			.digest("base64url");
		if (req.body.code !== "fixture-code" || challenge !== grant.code_challenge) {
			return res.status(400).json({ error: "invalid_grant" });
		}
		const idToken = jwt.sign(
			{
				nonce: grant.nonce,
				email: identity.email,
				email_verified: verified,
				teams: tokenGroups,
			},
			privateKey,
			{ algorithm: "RS256", issuer, audience: clientId, subject, keyid: "fixture", expiresIn: "5m" },
		);
		res.json({ token_type: "Bearer", access_token: "fixture-access", id_token: idToken });
	});
	provider.get("/userinfo", (_, res) => res.json({ sub: subject, email: identity.email, teams: userinfoGroups }));

	const panel = express();
	panel.use(cookieParser("fixture-session-cookies"));
	panel.use("/api/oidc", oidc);
	const origin = await listen(t, panel, tls);
	Object.assign(process.env, {
		OIDC_ISSUER_URL: issuer,
		OIDC_CLIENT_ID: clientId,
		OIDC_CLIENT_SECRET: "fixture-client",
		OIDC_REDIRECT_DOMAIN: new URL(origin).host,
		OIDC_REQUIRE_VERIFIED_EMAIL: "true",
	});

	const login = async () => {
		const start = await fetch(`${origin}/api/oidc`, { redirect: "manual" });
		const authorization = new URL(start.headers.get("location"));
		assert.equal(authorization.searchParams.get("scope"), "openid email groups");
		const approved = await fetch(authorization, { redirect: "manual" });
		const callback = approved.headers.get("location");
		const cookie = start.headers
			.getSetCookie()
			.map((item) => item.split(";")[0])
			.join("; ");
		const completed = await fetch(callback, { redirect: "manual", headers: { cookie } });
		return completed.headers.getSetCookie().some((item) => item.startsWith("__Host-Http-token="));
	};
	const membership = async () =>
		(await db("nginxions_user_role").where({ user_id: identity.id })).map((row) => row.role_id);

	tokenGroups = ["Readers"];
	assert.equal(await login(), true);
	assert.deepEqual(await membership(), [viewerRole.id]);

	tokenGroups = undefined;
	userinfoGroups = ["Readers"];
	assert.equal(await login(), true);
	assert.deepEqual(await membership(), [viewerRole.id]);

	userinfoGroups = undefined;
	assert.equal(await login(), true);
	assert.deepEqual(await membership(), []);

	verified = false;
	tokenGroups = ["Readers"];
	assert.equal(await login(), false);
	assert.deepEqual(await membership(), []);
});
