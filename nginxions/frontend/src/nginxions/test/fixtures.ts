// Data of the tests of the interface (render.test.tsx): one realistic object of each kind the API of NginxionS answers
// with, so that a page or a window renders its rows, badges and branches, not only its empty state.
import type { ProxyHost } from "src/api/backend";

const now = "2026-11-18T10:00:00.000Z";
const later = "2027-02-18T10:00:00.000Z";

export const subject = { CN: "Example CA", O: "Example", C: "DE" };

export const ca = {
	id: 1,
	createdOn: now,
	name: "Example CA",
	kind: "root",
	parentId: null,
	upstreamCertificateId: null,
	subject,
	subjectDn: "CN=Example CA,O=Example,C=DE",
	serial: "01",
	notBefore: now,
	notAfter: later,
	fingerprint: "AA:BB",
	keyType: "ec-p256",
	hasKey: true,
	certificates: 1,
	hasCrl: true,
	crlNumber: 3,
	crlUpdatedOn: now,
	crlNextUpdate: later,
	issued: 1,
	active: 1,
	revoked: 0,
	revokedOn: null,
	revokeReason: null,
	hosts: ["app.example.com"],
};

export const hostRef = { hostType: "proxy_host", hostId: 1, name: "app.example.com" };

export const pkiCert = {
	id: 1,
	createdOn: now,
	caId: 1,
	profile: "client",
	serial: "0A",
	commonName: "alice",
	subject: { CN: "alice" },
	sans: { dns: ["alice.example.com"], ip: [], email: ["alice@example.com"], uri: [] },
	notBefore: now,
	notAfter: later,
	daysLeft: 92,
	fingerprint: "CC:DD",
	keyType: "ec-p256",
	status: "active",
	revokedOn: null,
	revokeReason: null,
	replacedBy: null,
	template: "",
	notes: "laptop",
	hasKey: true,
	ownerUserId: 1,
	certificateId: null,
	hosts: ["app.example.com"],
	access: [hostRef],
};

export const pkiTemplate = {
	id: "t1",
	name: "Staff",
	profile: "client",
	caId: 1,
	days: 365,
	keyType: "ec-p256",
	subject: { O: "Example" },
};

export const pkiOverview = {
	cas: [ca],
	certificates: [pkiCert],
	settings: {
		publicUrl: "https://pki.example.com",
		crlDays: 7,
		clientDays: 365,
		serverDays: 90,
		keyType: "ec-p256",
		p12Compatible: false,
		templates: [pkiTemplate],
	},
	panelUrls: [{ url: "https://panel.example.com", mtls: false }],
	protected: [{ ...hostRef, mode: "on", caIds: [1], rules: 1, active: true }],
};

export const request = {
	id: "r1",
	time: now,
	host: "app.example.com",
	known: true,
	port: 443,
	ip: "203.0.113.7",
	country: "DE",
	method: "GET",
	path: "/login?next=/",
	status: 200,
	bytes: 5120,
	requestBytes: 300,
	durationMs: 42,
	upstreamMs: 30,
	upstreamStatus: 200,
	upstreamAddr: "10.0.0.2:8080",
	cache: "",
	protocol: "HTTP/2.0",
	tls: "TLSv1.3",
	contentType: "text/html",
	refererHost: "example.org",
	userAgent: "Mozilla/5.0",
	browser: "Firefox",
	os: "Linux",
	device: "desktop",
	client: "human",
	mitigated: false,
};

export const event = {
	id: "e1",
	time: now,
	kind: "security",
	request,
	name: "Cross Site Scripting",
	severity: "Critical",
	priority: "High",
	confidence: "Very High",
	action: "Prevent",
	incidentType: "Cross Site Scripting",
	sourceIp: "203.0.113.7",
	sourcePort: 51000,
	proxyIp: "",
	sourceCountry: "DE",
	host: "app.example.com",
	asset: "app.example.com",
	method: "GET",
	uri: "/search",
	query: "q=<script>",
	responseCode: 403,
	location: "url",
	parameter: "q",
	sample: "<script>alert(1)</script>",
	indicators: "<script",
	score: 9.5,
	rule: "rule-1",
	practice: "nginxions-recommended",
	override: "",
	service: "",
	repeats: 2,
};

export const decision = {
	id: 7,
	origin: "crowdsec",
	type: "ban",
	scope: "Ip",
	value: "203.0.113.7",
	duration: "3h59m",
	scenario: "crowdsecurity/http-probing",
};

export const blocklist = {
	id: 1,
	createdOn: now,
	modifiedOn: now,
	name: "Firehol",
	enabled: true,
	source: "url",
	url: "https://lists.example.com/level1.netset",
	hasToken: false,
	insecure: false,
	lines: 100,
	decision: "ban",
	duration: "24h",
	refreshMinutes: 60,
	syncedOn: now,
	count: 100,
	error: "",
	sync: { count: 100, invalid: 0 },
};

export const crowdsecProfile = {
	name: "default_ip_remediation",
	enabled: true,
	scope: "Ip",
	scenarios: [],
	filter: "Alert.Remediation == true && Alert.GetScope() == 'Ip'",
	type: "ban",
	duration: "4h",
	escalate: false,
};

export const channel = {
	id: 1,
	name: "Ops mail",
	type: "email",
	enabled: true,
	config: {
		host: "smtp.example.com",
		port: 587,
		security: "starttls",
		verifyTls: true,
		username: "ops",
		hasPassword: true,
		from: "nginxions@example.com",
		to: ["ops@example.com"],
		language: "en",
	},
	modifiedOn: now,
};

export const rule = {
	id: 1,
	name: "Certificates expire",
	type: "certificate_expiry",
	enabled: true,
	params: { days: 14 },
	channelIds: [1],
	repeatMinutes: 1440,
	notifyResolved: true,
	active: ["app.example.com"],
};

export const notifications = {
	channels: [channel],
	rules: [rule],
	log: [{ id: 1, time: now, ruleId: 1, channelId: 1, ok: true, error: "", title: "Certificate expires" }],
	ruleTypes: [{ type: "certificate_expiry", severity: "warning", defaults: { days: 14 } }],
	channelTypes: ["email", "webhook", "telegram"],
};

export const role = {
	id: 2,
	name: "Analyst",
	description: "Reads events",
	builtin: null,
	scope: "all",
	oidcGroups: ["analysts"],
	permissions: ["events:view", "hosts:view"],
	hosts: [],
	users: [{ id: 1, name: "Admin", email: "admin@example.com" }],
	createdOn: now,
	modifiedOn: now,
};

export const learningHost = {
	id: 1,
	name: "app.example.com",
	mode: "detect-learn",
	minimumConfidence: "high",
	stats: {
		elapsedHours: 30,
		requests: 12000,
		uniqueSources: 40,
		level: "Kindergarten",
		readiness: 60,
		recommendation: "keep learning",
	},
	labels: { benign: 2, malicious: 1, dismiss: 0, exceptions: 1 },
	enforced: 1,
	falsePositives: { before: 3, after: 1 },
	queue: 2,
	readyToPrevent: false,
	trial: null,
};

export const queueGroup = {
	key: "g1",
	hostId: 1,
	hostName: "app.example.com",
	hostMode: "detect-learn",
	host: "app.example.com",
	uri: "/search",
	parameter: "q",
	indicators: "<script",
	incidentType: "Cross Site Scripting",
	sample: "<script>",
	eventId: 1,
	events: 3,
	sources: 2,
	blocked: 1,
	score: 8,
	first: now,
	last: now,
	reason: "blocked",
	new: true,
	scopes: [{ type: "parameter", value: "q" }],
};

export const suggestion = {
	id: "s1",
	asset: "app.example.com",
	hostId: 1,
	hostName: "app.example.com",
	type: "parameter",
	title: "q",
	severity: "high",
	attackTypes: ["XSS"],
	metrics: [{ name: "count", value: 3 }],
};

export const policyObject = {
	id: 1,
	kind: "exception",
	name: "allow-health",
	description: "health checks",
	spec: { match: { operator: "equals", key: "url", value: ["/health"] }, action: "skip" },
	builtin: false,
};

export const defaultPolicy = {
	mode: "prevent-learn",
	threatPreventionPractices: ["nginxions-recommended"],
	accessControlPractices: [],
	triggers: ["nginxions-log"],
	customResponse: "nginxions-403",
	exceptions: [],
	trustedSources: "",
	sourceIdentifiers: "",
};

export const acmePreset = {
	id: "letsencrypt",
	name: "Let's Encrypt",
	directory: "https://acme-v02.api.letsencrypt.org/directory",
	client: "certbot",
	eab: "",
	profiles: ["classic"],
};

export const acmeServer = {
	id: 1,
	name: "Let's Encrypt",
	preset: "letsencrypt",
	directory: "https://acme-v02.api.letsencrypt.org/directory",
	client: "certbot",
	email: "admin@example.com",
	eabKid: "",
	eabHmacKey: "",
	profile: "",
	tlsVerify: true,
	isDefault: true,
	usedBy: 1,
};

export const proxyHost: ProxyHost = {
	id: 1,
	createdOn: now,
	modifiedOn: now,
	ownerUserId: 1,
	domainNames: ["app.example.com"],
	forwardScheme: "http",
	forwardHost: "app",
	forwardPort: 8080,
	npmplusAccessListIds: [],
	npmplusAccessListType: "public",
	certificateId: 0,
	sslForced: false,
	cachingEnabled: false,
	blockExploits: false,
	advancedConfig: "",
	npmplusLocationConfig: "",
	meta: {},
	allowWebsocketUpgrade: true,
	http2Support: true,
	npmplusHttp3Support: false,
	enabled: true,
	locations: [],
	hstsEnabled: false,
	hstsSubdomains: false,
	trustForwardedProto: false,
	npmplusNoindex: false,
	npmplusCrowdsecAppsec: false,
	npmplusProxyResponseBuffering: false,
	npmplusProxyRequestBuffering: false,
	npmplusDisableUriSanitisation: false,
	npmplusSpoofHostHeader: false,
	npmplusUpstreamCompression: false,
	npmplusFancyindex: false,
	npmplusXFrameOptions: "",
	npmplusAuthRequest: "",
	npmplusAuthRequestUpstream: "",
};

export const user = {
	id: 1,
	createdOn: now,
	modifiedOn: now,
	email: "admin@example.com",
	name: "Admin",
	nickname: "admin",
	isDisabled: false,
	roles: ["admin"],
	permissions: { visibility: "all", proxyHosts: "manage" },
};

export const crowdsecSettings = {
	bouncer: {
		enabled: true,
		admin: false,
		mode: "stream",
		fallback: "ban",
		updateFrequency: 10,
		excludeLocations: ["/health"],
		captcha: { provider: "turnstile", siteKey: "", secretKey: "", hasSecret: false },
	},
	sources: { nginx: true, openappsec: true },
	appsec: { enabled: true, failureAction: "passthrough", configs: ["crowdsecurity/appsec-default"] },
	profiles: [crowdsecProfile],
	allowlist: { ips: ["10.0.0.0/8"], expressions: [], private: true },
	openappsecBan: { enabled: true, events: 5, minutes: 10 },
	simulation: { all: false, scenarios: [] },
	logLevel: "info",
	onlineHub: false,
	pending: [],
	perHost: false,
	shareEnabled: false,
};

export const mtlsHost = {
	enabled: true,
	caIds: [1],
	mode: "on",
	depth: 1,
	sendCaNames: false,
	rules: [],
	requiredPaths: [],
	headers: true,
	revocation: "crl",
	deniedPage: "certificate",
	name: "app.example.com",
	hasCertificate: true,
	paths: ["/", "/api"],
	issuerCheck: false,
	upstreamCaCertificateId: null,
	nginx: { nginxOnline: true, nginxErr: null },
};

export const snapshots = {
	snapshots: [
		{
			id: "20261118T100000Z-abcd",
			takenOn: now,
			reason: "manual",
			userId: 1,
			size: 2048,
			files: 3,
			assets: [{ asset: "app.example.com", params: 4, values: 20 }],
			shift: [{ asset: "app.example.com", before: 10, after: 20 }],
			comparedWith: null,
			sourceTakenOn: null,
			restoredOn: null,
		},
	],
	keepAuto: 7,
};

export const profiles = {
	profiles: [
		{
			id: "p-0123456789ab",
			name: "Shop prod",
			createdOn: now,
			origin: "taken",
			source: { server: "manager", snapshot: null },
			sites: [{ domains: ["app.example.com"] }],
			assets: [{ asset: "app.example.com", params: 4, values: 20 }],
			files: 2,
			size: 2048,
			version: "a".repeat(64),
			fingerprint: Array(32).fill("AB").join(":"),
			own: true,
			forNewNodes: true,
			policy: { sites: 1, objects: 2 },
			appliedOn: null,
		},
	],
	fingerprint: Array(32).fill("AB").join(":"),
};

export const learned = {
	id: 1,
	name: "app.example.com",
	stats: learningHost.stats,
	assets: [
		{
			asset: "app.example.com",
			updatedOn: now,
			indicators: [{ param: "q", values: ["select"] }],
			types: [{ param: "id", values: ["numeric"] }],
		},
	],
	error: null,
};

export const analytics = {
	period: "24h",
	from: "2026-11-17T10:00:00.000Z",
	to: now,
	bucket: 3600,
	host: null,
	kpi: {
		requests: 12000,
		attacks: 5,
		prevented: 4,
		detected: 1,
		sources: 3,
		crowdsecAlerts: 2,
		crowdsecBans: 1,
		readiness: null,
	},
	timeline: [{ t: now, prevent: 4, detect: 1, other: 0 }],
	traffic: {
		requests: 12000,
		ok: 11000,
		s2xx: 11000,
		s3xx: 500,
		s4xx: 400,
		s5xx: 100,
		blocked: 4,
		bytes: 1048576,
		hosts: [{ host: "app.example.com", requests: 12000, errors: 100, blocked: 4 }],
		timeline: [{ t: now, requests: 12000, blocked: 4 }],
	},
	actions: [{ action: "Prevent", events: 4 }],
	severities: [{ severity: "Critical", events: 4 }],
	types: [{ type: "Cross Site Scripting", events: 4 }],
	hosts: [{ host: "app.example.com", events: 5, prevented: 4 }],
	uris: [{ host: "app.example.com", uri: "/search", events: 5 }],
	sources: [{ ip: "203.0.113.7", country: "DE", events: 5 }],
	countries: [{ country: "DE", events: 5 }],
	lastBlocked: [event],
};

export const wafAgent = {
	failOpen: { enabled: false, timeoutMs: 50 },
	restartRequired: false,
	model: { present: true, size: 1024, modifiedOn: now },
};

export const policyObjects = {
	objects: [policyObject],
	policy: defaultPolicy,
	templates: { strict: defaultPolicy },
	state: {
		file: "local_policy.yaml",
		generatedAt: now,
		hosts: 1,
		format: "v1beta2",
		warnings: [],
		applied: { ok: true, at: now, error: null },
	},
};

export const crowdsecOverview = {
	settings: {
		bouncer: true,
		sources: { nginx: true, openappsec: true },
		appsec: true,
		openappsecBan: { enabled: true, events: 5, minutes: 10 },
	},
	lapi: { healthy: true, error: "" },
	metrics: null,
	machines: [
		{ machineId: "nginxions", isValidated: true, lastHeartbeat: now, version: "v1.8.2", ipAddress: "10.0.0.3" },
	],
	bouncers: [{ name: "nginxions", ipAddress: "10.0.0.2", lastPull: now, version: "v1.0.19", type: "nginx" }],
	decisions: { total: 1, byOrigin: { crowdsec: 1 }, byType: { ban: 1 } },
	alerts24h: 2,
	hub: { installed: 10, outdated: 0, error: "" },
	pending: [],
	errors: [],
};

export const wafFiles = {
	enabled: true,
	hosts: 1,
	clamd: "ClamAV 1.5.4/27000/Tue Nov 17 2026",
	uploaded: ["custom.ndb"],
	settings: { online_updates: false },
};

const policyState = {
	file: "local_policy.yaml",
	generatedAt: now,
	hosts: 1,
	applied: { ok: true, at: now, error: null },
};

export const wafCustomPolicy = {
	id: 1,
	content: "policies:\n  default: {}\n",
	versions: [{ id: 1, createdOn: now, userId: 1, userName: "Admin", comment: "first", size: 30 }],
	policy: policyState,
};

export const blockPage = {
	settings: {
		enabled: true,
		title: "Access denied",
		text: "Your request was blocked.",
		contact: "security@example.com",
		details: true,
		accent: "#d63939",
		language: "en",
	},
	preview: "<html><body>Access denied</body></html>",
};

const bucket = (t: string) => ({
	t,
	requests: 100,
	blocked: 2,
	cacheable: 10,
	cached: 5,
	s2xx: 90,
	s3xx: 5,
	s4xx: 4,
	s5xx: 1,
	p50: 12,
	p95: 80,
	p99: 120,
	bytes: 2048,
});

export const traffic = {
	tab: "requests",
	period: "24h",
	from: "2026-11-17T10:00:00.000Z",
	to: now,
	bucket: 3600,
	requestDays: 7,
	detailFrom: null,
	kpi: {
		requests: { value: 12000, previous: 10000, spark: [1, 2, 3] },
		bytes: { value: 1048576, previous: 900000, spark: [1, 2, 3] },
	},
	timeline: [bucket("2026-11-18T08:00:00.000Z"), bucket("2026-11-18T09:00:00.000Z")],
	countries: [{ value: "DE", requests: 100, bytes: 2048, country: "DE" }],
	top: {
		hosts: [{ value: "app.example.com", requests: 100, bytes: 2048, known: true, mitigated: 2 }],
		paths: [{ value: "/login", requests: 50, bytes: 1024 }],
	},
	percentiles: [bucket("2026-11-18T09:00:00.000Z")],
	breakdown: { connectMs: 2, upstreamMs: 30 },
	actions: [{ kind: "security", action: "Prevent", events: 4 }],
};

export const node = {
	id: 1,
	uid: "n-0123456789abcdef",
	name: "edge-1",
	status: "active",
	state: "online",
	labels: ["eu"],
	fingerprint: Array(32).fill("AB").join(":"),
	address: "198.51.100.7",
	info: { version: "2.0.0", hostname: "edge-1", hosts: 2, packageVersion: "a".repeat(64), packageSkipped: 0 },
	hostIds: [1],
	createdOn: now,
	registeredOn: now,
	lastSeenOn: now,
	codeExpiresOn: null,
	drained: false,
	command: null,
	canary: true,
	pinned: { version: "b".repeat(64), by: "staged" },
};

export const nodePackages = [
	{ version: "a".repeat(64), createdOn: now, applied: true, pinned: false },
	{ version: "b".repeat(64), createdOn: now, applied: false, pinned: true },
];

export const rollout = [
	{
		id: 2,
		nodeId: 1,
		nodeName: "edge-1",
		kind: "model",
		version: "b".repeat(64),
		result: "failed",
		error: "the model is not the one of the package",
		createdOn: now,
	},
	{
		id: 1,
		nodeId: 1,
		nodeName: "edge-1",
		kind: "package",
		version: "a".repeat(64),
		result: "applied",
		error: "",
		createdOn: now,
	},
];

export const clusterLearningSites = {
	available: true,
	error: "",
	assets: [
		{
			asset: "app.example.com",
			local: { windows: 3, lastOn: now },
			nodes: [{ uid: "n-0123456789abcdef", name: "edge-1", windows: 5, lastOn: now }],
			mergedOn: now,
		},
	],
};

export const nodeLogs = {
	collectedOn: now,
	logs: {
		openappsec: [{ stream: "stdout", line: "agent started" }],
		crowdsec: [{ stream: "stderr", line: "lapi ready" }],
	},
};
