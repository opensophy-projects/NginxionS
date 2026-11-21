// Every component and every window of the interface of NginxionS renders, in both languages, with the data the API
// answers (test/fixtures.ts): a page that throws on the data of a real stack, a window that does not open, a missing
// provider or prop fail here, not in the browser of an administrator.
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import EasyModal from "ez-modal-react";
import { changeLocale } from "src/locale";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { toWafForm } from "./components/WafFields";
import { type HostRow, recommendations, toRows } from "./pages/Hosts/rows";
import * as f from "./test/fixtures";
import { mockApi, renderApp, settle } from "./test/harness";

beforeAll(mockApi);
afterEach(cleanup);

const noop = () => {};
const fn = () => vi.fn();

// a host of each type, as the hosts page builds it
const rows: HostRow[] = toRows(
	{
		proxy: [
			{
				...f.proxyHost,
				npmplusAccessListType: "custom",
				npmplusAccessListIds: [1],
				meta: { nginxOnline: false, nginxErr: "bad", npmplusMtlsCertificateId: 1, directory: "prod" },
			},
		],
		redirect: [
			{
				id: 3,
				enabled: true,
				domainNames: ["old.example.com"],
				forwardScheme: "$scheme",
				forwardDomainName: "new.example.com",
				forwardHttpCode: 301,
				meta: { nginxOnline: true },
				modifiedOn: "",
			},
		],
		stream: [{ id: 4, enabled: false, incomingPort: 5432, forwardingHost: "db", forwardingPort: 5432, meta: {} }],
		dead: [{ id: 5, enabled: true, domainNames: ["gone.example.com"], meta: {} }],
		waf: { proxy_host_1: { enabled: true, mode: "prevent-learn" } },
		changes: [],
		checks: [],
	} as any,
	Date.parse("2026-11-18T10:00:00Z"),
);

// the context of the cells of the hosts table: every callback a spy, every list one item
const cellContext: any = new Proxy(
	{
		certificates: [],
		accessLists: [{ id: 1, name: "Office" }],
		pki: {
			cas: [f.ca],
			canIssue: true,
			canManage: () => true,
			accessCerts: () => [f.pkiCert],
			set: noop,
			enable: noop,
			configure: noop,
			issue: noop,
			certs: noop,
			details: noop,
		},
		canManage: () => true,
		canWaf: () => true,
		wafTemplate: () => null,
		wafReady: () => true,
		attacks: new Map([
			["app.example.com", { host: "app.example.com", events: 5, prevented: 4, hours: Array(24).fill(1) }],
		]),
		crowdsec: {
			enabled: true,
			off: new Set(["stream-4"]),
			bans: { "app.example.com": 2 },
			canManage: true,
			set: noop,
			open: noop,
			settings: noop,
		},
	},
	{ get: (target, key) => (key in target ? target[key as keyof typeof target] : fn()) },
);

const diff = [
	{ op: " ", line: "mode: prevent-learn" },
	{ op: "-", line: "exceptions: []" },
	{ op: "+", line: "exceptions: [allow-health]" },
];
const trafficFilters = { host: "app.example.com", country: "DE", status: "200", method: "GET", q: "login" };

// the props a component needs; the others render with these defaults
const DEFAULT_PROPS = { onClose: noop, visible: true, remove: noop, hide: noop, resolve: noop, refresh: noop };
const PROPS: Record<string, Record<string, unknown>> = {
	ActiveFilters: {
		filters: { q: "app", rules: [{ field: "type", op: "is", value: "proxy" }] },
		options: { accessLists: [], groups: ["prod"], types: ["proxy", "stream"] },
		onChange: noop,
	},
	AddMenu: { types: ["proxy", "redirect", "stream", "dead"], onAdd: noop },
	RequestFilters: { filters: trafficFilters, set: noop },
	FilterChips: { filters: trafficFilters, remove: noop, clear: noop },
	DefaultPolicyTab: {
		data: { objects: [f.policyObject], policy: f.defaultPolicy, hosts: [], templates: [] },
		manage: true,
		refresh: noop,
	},
	LinkBox: {
		link: { id: 1, path: "/pki/link/abc", expiresOn: "2026-11-19T10:00:00Z" },
		publicUrl: "https://pki.example.com",
	},
	Delivery: {
		result: {
			certificate: f.pkiCert,
			files: { filename: "alice", p12: "AAAA", pem: "-----BEGIN", key: "-----BEGIN" },
			link: { id: 1, path: "/pki/link/abc", expiresOn: "2026-11-19T10:00:00Z" },
			password: "secret",
		},
		publicUrl: "https://pki.example.com",
	},
	CasTab: { data: f.pkiOverview, refresh: noop },
	SettingsTab: { data: f.pkiOverview, refresh: noop },
	RefsEditor: { value: { exceptions: [1], customResponse: null }, objects: [f.policyObject], onChange: noop },
	Review: {
		preview: {
			valid: true,
			changed: true,
			diff,
			format: "v1beta2",
			warnings: ["w"],
		},
	},
	Recommendations: { items: recommendations(rows, true), onShow: noop },
	FiltersViewPopover: {
		filters: { q: "", rules: [] },
		options: { accessLists: [], groups: ["prod"], types: ["proxy"] },
		onChange: noop,
		view: { hidden: [], compact: false },
		onViewChange: noop,
	},
	BulkBar: {
		count: 2,
		hasProxy: true,
		certificates: [],
		accessLists: [],
		onClear: noop,
		onToggle: noop,
		onWaf: noop,
		onCertificate: noop,
		onAccess: noop,
		onDelete: noop,
	},
	ObjectsTab: {
		kind: "exception",
		data: { objects: [f.policyObject], policy: f.defaultPolicy, hosts: [], templates: [] },
		manage: true,
		refresh: noop,
	},
	HostsCard: { data: f.pkiOverview, certs: [f.pkiCert], refresh: noop, filter: noop },
	TemplatesTab: { data: f.pkiOverview, refresh: noop },
	"pages/Crowdsec/Settings.tsx SettingsTab": { data: f.crowdsecSettings, refresh: noop },
	BarList: { items: [{ label: "DE", value: 3 }], emptyText: "none" },
	Label: { id: "nginxions.hosts.add" },
	HostPicker: { value: [], onChange: noop, hosts: [] },
	StackedBars: { data: [{ label: "a", values: [1, 2] }], series: ["x", "y"] },
	CodeDiff: { diff },
	Diff: { diff },
	Sparkline: { values: [1, null, 3, 2] },
	Dropdown: { items: [{ label: "One", onSelect: noop }], label: "Menu" },
	AreaChart: {
		data: [
			{ t: "10:00", v: 1 },
			{ t: "11:00", v: 3 },
		],
		series: [{ key: "v", label: "V", value: (d: { v: number }) => d.v }],
		xLabel: (d: { t: string }) => d.t,
	},
	WorldMap: { values: new Map([["DE", 3]]) },
	ShiftList: { snapshot: { shift: [] } },
};
// the values of the form a field component lives in
const FORM: Record<string, Record<string, unknown>> = {
	WafFields: { nginxionsWaf: toWafForm(), locations: [{ path: "/api" }] },
};
// not React components (a CodeMirror widget class)
const NOT_COMPONENTS = new Set(["SelectionText"]);

const modules = import.meta.glob(["./**/*.tsx", "!./**/*.test.tsx", "!./test/**"], { eager: true }) as Record<
	string,
	Record<string, unknown>
>;
const components = Object.entries(modules).flatMap(([file, mod]) =>
	Object.entries(mod)
		.filter(([name, value]) => typeof value === "function" && /^[A-Z]/.test(name === "default" ? "Page" : name))
		.filter(([name]) => !NOT_COMPONENTS.has(name) && !name.startsWith("show"))
		.map(([name, value]) => ({
			id: `${file.slice(2)} ${name}`,
			name,
			Component: value as React.ComponentType<any>,
		})),
);

describe.each(["en", "ru"])("components (%s)", (locale) => {
	beforeAll(() => changeLocale(locale));
	it.each(components)("$id", async ({ id, name, Component }) => {
		const errors = vi.spyOn(console, "error").mockImplementation(noop);
		const props = PROPS[id] ?? PROPS[name] ?? (name.endsWith("Cell") ? { row: rows[0], ctx: cellContext } : {});
		const { container } = await renderApp(<Component {...DEFAULT_PROPS} {...props} />, FORM[name]);
		// a component may render nothing (no data, no permission), but React must not have reported an error
		expect(container).toBeDefined();
		const reported = errors.mock.calls.map((c) => String(c[0])).filter((m) => /The above error|Uncaught/.test(m));
		errors.mockRestore();
		expect(reported).toEqual([]);
	});
});

// every window, opened as the pages open it
type Show = (...args: any[]) => unknown;
const MODALS: Record<string, unknown[]> = {
	showAcmeServerModal: [[f.acmePreset], noop],
	showHostHistoryModal: ["proxy_host", 1, "app.example.com"],
	showWafEventModal: [f.event, noop],
	showServiceLogsModal: ["nginxions"],
	showConfirmModal: [
		{ tTitle: "nginxions.hosts.add", children: "?", tConfirm: "nginxions.hosts.add", onConfirm: noop },
	],
	showRequestModal: [f.request, noop, noop],
	showImportModal: [{ onImported: noop }],
	showObjectModal: [{ kind: "exception", object: f.policyObject, objects: [f.policyObject], onSaved: noop }],
	showReviewModal: [{ change: { policy: f.defaultPolicy }, title: "Review", onApply: async () => {} }],
	showAccessModal: [{ data: f.pkiOverview, host: f.hostRef, onDone: noop }],
	showIssueModal: [{ data: f.pkiOverview, onDone: noop }],
	showTemplateModal: [{ data: f.pkiOverview, template: f.pkiTemplate, onDone: noop }],
	showCertSettingsModal: [{ refresh: noop }],
	showCaModal: [{ data: f.pkiOverview, onDone: noop }],
	showRevokeModal: [{ certs: [f.pkiCert], ca: f.ca, onDone: noop }],
	showHostCertsModal: [{ host: f.hostRef, openHost: noop }],
	showMtlsModal: [{ type: "proxy_host", hostId: 1, onDone: noop }],
	showCertModal: [{ certId: 1, openHost: noop }],
	showSecretModal: [
		{ action: "link", objectId: 1, name: "alice", publicUrl: "https://pki.example.com", compatible: false },
	],
	showDecisionModal: [{ value: "203.0.113.7", type: "ban", decisions: [f.decision], onChange: noop, navigate: noop }],
	showBanModal: [{ values: ["203.0.113.7"], reason: "scan", onDone: noop }],
	showBlocklistModal: [{ list: f.blocklist, onDone: noop }],
	showProfileModal: [{ profile: f.crowdsecProfile, names: [], onSave: noop }],
	showRuleModal: [f.notifications, f.rule],
	showChannelModal: ["email", f.channel],
	showSetupModal: [],
	showUserRolesModal: [1, "Admin"],
	showRoleModal: [{ role: f.role }],
	showAcmeCertificateModal: [],
	showCsrModal: [],
	showAcmeLogModal: [],
	showSnapshotsModal: [{ label: true, manage: true }],
	showProfilesModal: [{ label: true, manage: true, nodes: true }],
	showLabelModal: [{ group: f.queueGroup, decision: "benign", onDone: noop }],
	showStartTrialModal: [{ host: f.learningHost, onDone: noop }],
	showTrialReportModal: [{ host: f.learningHost, manage: true, onDone: noop }],
	showLearnedModal: [{ host: f.learningHost }],
	showWafPolicyModal: [],
};
const shows = Object.values(modules).flatMap((mod) =>
	Object.entries(mod).filter(([name, value]) => name.startsWith("show") && typeof value === "function"),
) as [string, Show][];

describe("windows", () => {
	beforeAll(() => changeLocale("en"));
	it("every window of the interface has its arguments here", () => {
		expect(shows.map(([name]) => name).filter((name) => !(name in MODALS))).toEqual([]);
	});
	it.each(shows)("%s opens", async (name, show) => {
		const errors = vi.spyOn(console, "error").mockImplementation(noop);
		await renderApp(<div data-testid="page" />);
		await act(async () => {
			void show(...(MODALS[name] ?? []));
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		await settle();
		expect(document.querySelector(".modal")).not.toBeNull();
		const reported = errors.mock.calls.map((c) => String(c[0])).filter((m) => /The above error|Uncaught/.test(m));
		errors.mockRestore();
		expect(reported).toEqual([]);
		// the buttons of the window: closing it must not throw either
		for (const button of screen.queryAllByRole("button", { name: /close|cancel|закрыть|отмена/i })) {
			fireEvent.click(button);
		}
		EasyModal.hide?.(name);
	});
});

// the pages, used: every tab and every button pressed once (the windows they open are covered above); what a page
// shows after a click must render too
const pages = components.filter(({ id, name }) => id.startsWith("pages/") && name === "default");

describe("pages, used", () => {
	beforeAll(() => changeLocale("en"));
	it.each(pages)("$id", async ({ Component }) => {
		const errors = vi.spyOn(console, "error").mockImplementation(noop);
		const { container } = await renderApp(<Component />);
		const clickable = () =>
			[...container.querySelectorAll<HTMLElement>('[role="tab"], .nav-link, button:not([disabled])')].filter(
				(el) => !/delete|remove|logout|удал|выйти/i.test(el.textContent ?? ""),
			);
		const count = clickable().length;
		for (let i = 0; i < count; i++) {
			const el = clickable()[i];
			if (!el) break;
			await act(async () => {
				fireEvent.click(el);
				await new Promise((resolve) => setTimeout(resolve, 5));
			});
		}
		await settle();
		const reported = errors.mock.calls.map((c) => String(c[0])).filter((m) => /The above error|Uncaught/.test(m));
		errors.mockRestore();
		expect(reported).toEqual([]);
	});
});
