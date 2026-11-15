// The contract of the policy with the agent (scripts/test-policy-contract.sh): policies as NginxionS writes them, from
// the built-in objects and templates, the examples of open-appsec and a policy with every kind of object and every
// engine on. The test gives each to the agent of the image and checks that it applies it (compare.js), so a field
// the agent cannot read fails in minutes, not in the smoke test of the full stack. Pure functions, no database.
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { forAgent } from "../engines.js";
import { withRelays } from "../syslog.js";
import { asV2 } from "./format.js";
import { BUILTIN, builtinSpec, DEFAULT_POLICY, KINDS, normalize, TEMPLATES } from "./model.js";

const EXAMPLES = ["default", "example", "prevent"];

/** a snort rule the test puts next to the policy (snortSignatures reads files of the agent) */
export const SNORT_FILE = "/ext/appsec/contract.rules";
export const SNORT_RULE =
	'alert tcp any any -> any any (msg:"NginxionS contract"; content:"nginxions-contract-probe"; sid:9000001; rev:1;)\n';

const empty = () => Object.fromEntries(Object.values(KINDS).map((section) => [section, []]));

/** objects through normalize, as the API stores them: a fixture the backend would refuse fails here */
const objects = (kind, list) =>
	list.map(({ name, ...input }) => {
		const { spec, errors } = normalize(kind, input);
		if (errors) throw new Error(`contract fixture ${kind} ${name}: ${errors.join("; ")}`);
		return { name, ...spec };
	});

const builtins = () => {
	const doc = empty();
	for (const [name, { kind }] of Object.entries(BUILTIN)) doc[KINDS[kind]].push({ name, ...builtinSpec(name) });
	return doc;
};

/** the built-in objects, the default policy and a host for each template */
const templatesCase = () => ({
	...builtins(),
	policies: {
		default: { ...DEFAULT_POLICY },
		specificRules: Object.entries(TEMPLATES).map(([name, rule]) => ({
			name: `template-${name}`,
			host: `${name}.contract.test`,
			...rule,
		})),
	},
});

const everything = () => {
	const doc = builtins();
	doc.threatPreventionPractices.push(
		...objects("threat_prevention", [
			{
				name: "all-engines",
				practiceMode: "prevent",
				webAttacks: {
					overrideMode: "prevent",
					minimumConfidence: "medium",
					maxUrlSizeBytes: 16384,
					maxObjectDepth: 20,
					maxBodySizeKb: 2000000,
					maxHeaderSizeBytes: 51200,
					protections: {
						csrfProtection: "prevent",
						errorDisclosure: "detect",
						openRedirect: "prevent",
						nonValidHttpMethods: true,
					},
				},
				intrusionPrevention: {
					overrideMode: "prevent",
					maxPerformanceImpact: "high",
					minSeverityLevel: "low",
					minCveYear: 2010,
					highConfidenceEventAction: "prevent",
					mediumConfidenceEventAction: "prevent",
					lowConfidenceEventAction: "detect",
				},
				fileSecurity: {
					overrideMode: "prevent",
					minSeverityLevel: "low",
					highConfidenceEventAction: "prevent",
					mediumConfidenceEventAction: "prevent",
					lowConfidenceEventAction: "detect",
					archiveInspection: {
						extractArchiveFiles: true,
						scanMaxFileSize: 20,
						scanMaxFileSizeUnit: "MB",
						archivedFilesWithinArchivedFiles: "prevent",
						archivedFilesWhereContentExtractionFailed: "detect",
					},
					largeFileInspection: {
						fileSizeLimit: 50,
						fileSizeLimitUnit: "MB",
						filesExceedingSizeLimitAction: "detect",
					},
					unnamedFilesAction: "prevent",
					threatEmulationEnabled: true,
				},
				snortSignatures: { overrideMode: "prevent", files: [SNORT_FILE] },
				schemaValidation: {
					overrideMode: "prevent",
					enforcementLevel: "fullSchema",
					files: ["contract-api.yaml"],
				},
				antiBot: {
					overrideMode: "prevent",
					injectedUris: [{ uri: "/" }, { uri: "/shop" }],
					validatedUris: [{ uri: "/login" }, { uri: "/api/pay" }],
				},
			},
			{
				name: "detect-only",
				practiceMode: "detect",
				webAttacks: { overrideMode: "detect", minimumConfidence: "critical" },
			},
		]),
	);
	doc.accessControlPractices.push(
		...objects("access_control", [
			{
				name: "rate-limits",
				practiceMode: "prevent",
				rateLimit: {
					overrideMode: "prevent",
					rules: [
						{ uri: "/login", limit: 10, unit: "minute", action: "prevent", comment: "login" },
						{ uri: "/api", limit: 50, unit: "second", action: "detect", triggers: ["all-destinations"] },
						...["sourceIp", "sourceIdentifier", "countryCode", "countryName", "url"].map((key, i) => ({
							uri: `/by-${key}`,
							limit: 100 + i,
							unit: "minute",
							action: "inherited",
							condition: [{ key, value: key === "url" ? "/by-url" : "x" }],
						})),
					],
				},
			},
		]),
	);
	doc.logTriggers.push(
		...objects("log_trigger", [
			{
				name: "all-destinations",
				accessControlLogging: { allowEvents: true, dropEvents: true },
				appsecLogging: { detectEvents: true, preventEvents: true, allWebRequests: true },
				additionalSuspiciousEventsLogging: {
					enabled: true,
					minSeverity: "critical",
					responseBody: true,
					responseCode: true,
				},
				extendedLogging: { urlPath: true, urlQuery: true, httpHeaders: true, requestBody: true },
				logDestination: {
					"local-tuning": true,
					logToAgent: true,
					stdout: { format: "json-formatted" },
					// one IPv4 server: the agent sends itself
					syslogService: [{ address: "192.0.2.10", port: 514, proto: "udp" }],
					// a name, IPv6 and TCP, several servers: through the relay of NginxionS
					cefService: [
						{ address: "siem.contract.test", port: 6514, proto: "tcp" },
						{ address: "2001:db8::10", port: 514, proto: "udp" },
					],
				},
			},
			{
				name: "syslog-relay",
				logDestination: {
					syslogService: [
						{ address: "192.0.2.11", port: 514 },
						{ address: "logs.contract.test", port: 1514, proto: "tcp" },
					],
				},
			},
		]),
	);
	doc.customResponses.push(
		...objects("custom_response", [
			{
				name: "redirect",
				mode: "redirect",
				redirectUrl: "https://contract.test/blocked",
				redirectAddXEventId: true,
			},
			{ name: "redirect-path", mode: "redirect", redirectUrl: "/blocked" },
			{
				name: "page-429",
				mode: "block-page",
				httpResponseCode: 429,
				messageTitle: "Slow down",
				messageBody: "Later.",
			},
		]),
	);
	doc.exceptions.push(
		...objects("exception", [
			{ name: "skip-health", action: "skip", condition: [{ key: "url", value: "/healthz" }] },
			{ name: "accept-office", action: "accept", condition: [{ key: "sourceIp", value: "192.0.2.0/24" }] },
			{ name: "drop-country", action: "drop", condition: [{ key: "countryCode", value: "ZZ" }] },
			{
				name: "suppress-noise",
				action: "suppressLog",
				condition: [
					{ key: "paramName", value: "token" },
					{ key: "protectionName", value: "Cross Site Scripting" },
				],
			},
			// the keys and operators of the extension x-nginxions
			{
				name: "extension",
				action: "accept",
				condition: [
					{ key: "method", value: "OPTIONS" },
					{ key: "headerName", op: "exist" },
					{ key: "hostName", op: "not-equals", value: "admin.contract.test" },
					{ key: "countryName", op: "in", value: "Utopia" },
					{ key: "indicator", op: "not-in", value: "union" },
					{ key: "paramLocation", value: "body" },
					{ key: "headerValue", value: "contract" },
					{ key: "paramValue", value: "x" },
					{ key: "sourceIdentifier", value: "id-1" },
				],
			},
		]),
	);
	doc.sourcesIdentifiers.push(
		...objects("source_identifiers", [
			{
				name: "behind-proxy",
				sourcesIdentifiers: [
					{ identifier: "x-forwarded-for" },
					{ identifier: "headerkey", value: ["x-real-ip"] },
					{ identifier: "cookie", value: ["session"] },
					{ identifier: "JWTKey", value: ["sub"] },
					{ identifier: "sourceip" },
				],
			},
		]),
	);
	doc.trustedSources.push(
		...objects("trusted_sources", [{ name: "office", minNumOfSources: 1, sourcesIdentifiers: ["behind-proxy"] }]),
	);
	doc.policies = {
		default: {
			mode: "prevent-learn",
			threatPreventionPractices: ["nginxions-recommended"],
			accessControlPractices: ["rate-limits"],
			triggers: ["nginxions-log"],
			customResponse: "nginxions-403",
			sourceIdentifiers: "behind-proxy",
			trustedSources: "office",
			exceptions: ["skip-health"],
		},
		specificRules: [
			{
				name: "everything",
				host: "everything.contract.test",
				mode: "prevent",
				threatPreventionPractices: ["all-engines"],
				accessControlPractices: ["rate-limits"],
				triggers: ["all-destinations"],
				customResponse: "redirect",
				sourceIdentifiers: "behind-proxy",
				trustedSources: "office",
				exceptions: ["skip-health", "accept-office", "drop-country", "suppress-noise", "extension"],
			},
			{
				name: "location",
				host: "everything.contract.test/api",
				mode: "detect",
				threatPreventionPractices: ["detect-only"],
				triggers: ["syslog-relay"],
				customResponse: "page-429",
			},
			{
				name: "redirect-path",
				host: "path.contract.test",
				mode: "prevent-learn",
				threatPreventionPractices: ["nginxions-strict"],
				customResponse: "redirect-path",
			},
			{ name: "inactive", host: "off.contract.test", mode: "inactive", threatPreventionPractices: [] },
		],
	};
	return doc;
};

/** an example of open-appsec as the import reads it (lenient: what the agent does not have is turned off) */
const exampleCase = (dir, name) => {
	const doc = YAML.parse(readFileSync(new URL(`./examples/${name}.yaml`, dir), "utf8"));
	delete doc.apiVersion;
	for (const [kind, section] of Object.entries(KINDS)) {
		doc[section] = (doc[section] || []).map(({ name: objectName, ...input }) => {
			const { spec, errors } = normalize(kind, input, { lenient: true });
			if (errors) throw new Error(`example ${name} ${kind} ${objectName}: ${errors.join("; ")}`);
			return { name: objectName, ...spec };
		});
	}
	for (const rule of [doc.policies.default, ...(doc.policies.specificRules || [])]) {
		for (const field of ["sourceIdentifiers", "trustedSources"]) if (rule[field] === "") delete rule[field];
	}
	return doc;
};

/** the text of the file, as policy.js writes it */
export const policyYaml = (policy) => YAML.stringify(policy, { lineWidth: 0, aliasDuplicateObjects: false });

/** the file the agent gets for a policy (policy.js buildPolicy without the database) */
export const forAgentFile = (doc) => {
	const { doc: forLogs, relays } = withRelays(forAgent(doc));
	return { policy: asV2(forLogs), relays };
};

/**
 * The cases of the contract: {name, doc (what NginxionS generated, for compare.js), policy (the file), relays}.
 * @returns {{name: string, doc: object, policy: object, relays: object[]}[]}
 */
export const contractCases = () =>
	[
		["templates", templatesCase()],
		["everything", everything()],
		...EXAMPLES.map((name) => [`example-${name}`, exampleCase(import.meta.url, name)]),
	].map(([name, doc]) => ({ name, doc, ...forAgentFile(doc) }));
