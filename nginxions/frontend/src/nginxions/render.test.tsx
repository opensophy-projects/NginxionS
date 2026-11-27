// Every component and every window of the interface of NginxionS renders, in both languages, with the data the API
// answers (test/fixtures.ts): a page that throws on the data of a real stack, a window that does not open, a missing
// provider or prop fail here, not in the browser of an administrator.
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import EasyModal from "ez-modal-react";
import { changeLocale } from "src/locale";
import Users from "src/pages/Users";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { toWafForm } from "./components/WafFields";
import AgentOpenappsec from "./pages/AgentOpenappsec";
import { type HostRow, recommendations, toRows } from "./pages/Hosts/rows";
import Roles from "./pages/Roles";
import { RefsEditor } from "./policy/RefsEditor";
import { showRoleModal } from "./rbac/RoleModal";
import { showUserRolesModal } from "./rbac/UserRolesModal";
import * as f from "./test/fixtures";
import { answer, mockApi, renderApp, settle } from "./test/harness";

beforeAll(mockApi);
afterEach(cleanup);

const noop = () => {};
const fn = () => vi.fn();

it("replaces a threat protection profile while preserving the other policy references", async () => {
	await changeLocale("en");
	const change = vi.fn();
	await renderApp(
		<RefsEditor
			value={{ threatPreventionPractices: [1], exceptions: [3] }}
			objects={[
				{ ...f.policyObject, kind: "threat_prevention", name: "first" },
				{ ...f.policyObject, id: 2, kind: "threat_prevention", name: "second" },
				{ ...f.policyObject, id: 3 },
			]}
			onChange={change}
		/>,
	);

	const profile = screen.getByRole("combobox", { name: "Threat protection profile" });
	fireEvent.change(profile, { target: { value: "2" } });
	expect(change).toHaveBeenCalledWith({ threatPreventionPractices: [2], exceptions: [3] });
});

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
	HostsPicker: { hosts: [{ id: 1, domainNames: ["app.example.com"] }], picked: new Set([1]) },
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
	ServiceTokens: { roles: [f.role] },
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
	showNodeLogs: [f.node, "openappsec"],
	showPackages: [f.node],
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

describe("Phase 3 permissions", () => {
	const delegate = { ...f.user, id: 2, name: "Delegate", roles: [] };
	const other = { ...f.user, id: 3, name: "Other user", roles: [] };
	const signIn = (permissions: string[]) =>
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const path = url.split("?")[0];
			const body = path.endsWith("/rbac/me")
				? { admin: false, scope: "own", permissions, roles: [] }
				: path.endsWith("/users/me")
					? delegate
					: path.endsWith("/api/users")
						? [f.user, delegate, other]
						: answer(url);
			return new Response(JSON.stringify(body), {
				headers: { "Content-Type": "application/json" },
			});
		});
	const actionsOf = (name: string) => {
		const row = screen.getByText(name).closest("tr");
		if (!row) throw new Error(`Missing row for ${name}`);
		return within(row);
	};

	afterEach(() => {
		mockApi();
	});

	it("keeps the user directory read-only except for the current profile", async () => {
		signIn(["users:view"]);
		await changeLocale("en");
		await renderApp(<Users />);
		await screen.findByText("Delegate");
		expect(screen.queryByText(/add user/i)).toBeNull();
		expect(actionsOf("Delegate").getByRole("button", { name: "User #2" })).toBeTruthy();
		expect(actionsOf("Other user").queryByRole("button")).toBeNull();
	});

	it("shows user management without administrator-only controls", async () => {
		signIn(["users:view", "users:manage"]);
		await changeLocale("en");
		await renderApp(<Users />);
		expect(await screen.findByText(/add user/i)).toBeTruthy();
		expect(actionsOf("Admin").queryByRole("button")).toBeNull();
		const otherActions = actionsOf("Other user");
		expect(otherActions.getByRole("button", { name: "User #3" })).toBeTruthy();
		expect(otherActions.queryByText(/log in as/i)).toBeNull();
		expect(otherActions.queryByText("Permissions")).toBeNull();
	});

	it("creates a role from a template and saves the chosen hosts", async () => {
		await changeLocale("en");
		await renderApp(<div />);
		act(() => {
			void showRoleModal();
		});
		const template = await screen.findByRole("combobox", { name: "Start from" });
		fireEvent.click(screen.getByRole("button", { name: "All" }));
		expect(screen.getAllByRole<HTMLInputElement>("checkbox", { name: "Manage" }).every((el) => el.checked)).toBe(
			true,
		);
		fireEvent.click(screen.getByRole("button", { name: "View only" }));
		expect(screen.getAllByRole<HTMLInputElement>("checkbox", { name: "Manage" }).some((el) => el.checked)).toBe(
			false,
		);
		fireEvent.click(screen.getByRole("button", { name: "None" }));
		expect(screen.getAllByRole<HTMLInputElement>("checkbox", { name: "View" }).some((el) => el.checked)).toBe(
			false,
		);
		fireEvent.change(template, { target: { value: "builtin:viewer" } });
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "App reviewers" } });
		fireEvent.click(screen.getByRole("radio", { name: "Own and chosen hosts" }));
		const host = await screen.findByRole<HTMLInputElement>("checkbox", { name: f.proxyHost.domainNames[0] });
		fireEvent.click(host);
		expect(host.checked).toBe(true);
		fireEvent.click(host);
		expect(host.checked).toBe(false);
		fireEvent.click(host);
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		await settle();
		const request = vi
			.mocked(fetch)
			.mock.calls.find(([url, options]) => String(url).endsWith("/rbac/roles") && options?.method === "POST");
		expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
			name: "App reviewers",
			scope: "hosts",
			permissions: f.role.permissions,
			hosts: [{ host_type: "proxy_host", host_id: f.proxyHost.id }],
		});
	});

	it("disables the scope and permissions a delegated role editor cannot grant", async () => {
		signIn(["roles:view", "roles:manage", "proxy_hosts:view"]);
		await changeLocale("en");
		await renderApp(<div />);
		act(() => {
			void showRoleModal();
		});
		expect((await screen.findByRole<HTMLInputElement>("radio", { name: "Own hosts" })).checked).toBe(true);
		expect(screen.getByRole<HTMLInputElement>("radio", { name: "All hosts" }).disabled).toBe(true);
		const [manageHosts, manageRoles] = screen.getAllByRole<HTMLInputElement>("checkbox", { name: "Manage" });
		expect(manageHosts.disabled).toBe(true);
		expect(manageRoles.disabled).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "All" }));
		expect(manageHosts.checked).toBe(false);
		expect(manageRoles.checked).toBe(true);
	});

	it("edits the OIDC groups of a built-in role with its permissions locked", async () => {
		await changeLocale("en");
		await renderApp(<div />);
		act(() => {
			void showRoleModal({ role: { ...f.role, builtin: "viewer", scope: "all" } });
		});
		const groups = await screen.findByRole<HTMLInputElement>("textbox", { name: /OIDC groups/ });
		expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Name" }).disabled).toBe(true);
		expect(screen.getAllByRole<HTMLInputElement>("checkbox").every((el) => el.disabled)).toBe(true);
		fireEvent.change(groups, { target: { value: "editors, auditors" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await settle();
		const target = `/rbac/roles/${f.role.id}`;
		const request = vi
			.mocked(fetch)
			.mock.calls.find(([url, options]) => String(url).endsWith(target) && options?.method === "PUT");
		expect(JSON.parse(String(request?.[1]?.body)).oidc_groups).toEqual(["editors", "auditors"]);
	});

	it("distinguishes OIDC assignments from roles selected manually", async () => {
		const requests = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const data = url.endsWith("/rbac/users")
				? { 1: [{ id: f.role.id, name: f.role.name, builtin: null, oidcGrant: true, manualGrant: false }] }
				: answer(url);
			return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
		});
		await changeLocale("en");
		await renderApp(<div />);
		act(() => {
			void showUserRolesModal(1, f.user.name);
		});
		const role = (await screen.findByRole("checkbox", { name: /Analyst.*OIDC/ })) as HTMLInputElement;
		expect(role.checked).toBe(false);
		fireEvent.click(role);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await settle();
		const request = requests.mock.calls.find(([input]) => String(input).endsWith("/rbac/users/1"));
		expect(JSON.parse(String(request?.[1]?.body))).toEqual({ roles: [f.role.id] });
	});

	it("issues, edits and revokes a service token in the Roles panel", async () => {
		const urlPath = "/rbac/service-tokens";
		const viewer = { ...f.role, id: 3, builtin: "viewer", name: "Viewer" };
		const admin = { ...f.role, id: 1, builtin: "administrator", name: "Administrator" };
		const secret = "one-time-fixture-value";
		const issued = {
			id: 7,
			name: "Deployment job",
			roles: [viewer.id],
			expiresOn: "2099-01-01T00:00:00Z",
			status: "active",
			revokedOn: null as string | null,
		};
		let exists = false;
		let rejectFirstIssue = true;
		const api = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			let data = answer(url);
			if (url.endsWith("/rbac/roles")) data = [admin, viewer, f.role];
			if (url.endsWith(urlPath)) {
				if (options?.method === "POST") {
					if (rejectFirstIssue) {
						rejectFirstIssue = false;
						return Response.json({ error: { message: "Please retry issuance" } }, { status: 400 });
					}
					exists = true;
					data = { ...issued, secret };
				} else {
					data = exists ? [issued] : [];
				}
			}
			if (url.endsWith(`${urlPath}/${issued.id}`)) {
				if (options?.method === "PUT") issued.roles = [f.role.id];
				if (options?.method === "DELETE") {
					issued.revokedOn = "2026-11-25T00:00:00Z";
					issued.status = "revoked";
				}
				data = { ...issued };
			}
			return Response.json(data);
		});
		await changeLocale("en");
		await renderApp(<Roles />);
		fireEvent.click(await screen.findByRole("button", { name: "Create token" }));
		const editor = await screen.findByRole("dialog");
		const dialog = within(editor);
		expect(dialog.queryByRole("checkbox", { name: "Administrator" })).toBeNull();
		fireEvent.change(dialog.getByRole("textbox", { name: "Name" }), { target: { value: issued.name } });
		fireEvent.click(dialog.getByRole("checkbox", { name: "Viewer" }));
		const days = dialog.getByRole("spinbutton", { name: "Valid for, days" });
		const create = dialog.getByRole<HTMLButtonElement>("button", { name: "Create" });
		fireEvent.change(days, { target: { value: "" } });
		expect(create.disabled).toBe(true);
		fireEvent.change(days, { target: { value: "366" } });
		expect(create.disabled).toBe(true);
		fireEvent.change(days, { target: { value: "14" } });
		fireEvent.click(create);
		expect(await dialog.findByText("Please retry issuance")).toBeTruthy();
		fireEvent.click(create);
		const value = await dialog.findByRole<HTMLInputElement>("textbox", { name: "Token value" });
		expect(value.value).toBe(secret);
		fireEvent.focus(value);
		expect(value.selectionEnd).toBe(secret.length);
		const clipboard = vi
			.spyOn(navigator.clipboard, "writeText")
			.mockRejectedValueOnce(new Error("Clipboard denied"))
			.mockResolvedValueOnce(undefined);
		fireEvent.click(dialog.getByRole("button", { name: "Copy token" }));
		expect(await dialog.findByText(/clipboard unavailable/i)).toBeTruthy();
		fireEvent.click(dialog.getByRole("button", { name: "Copy token" }));
		expect(await dialog.findByRole("button", { name: "Copied" })).toBeTruthy();
		expect(clipboard).toHaveBeenLastCalledWith(secret);
		clipboard.mockRestore();
		fireEvent.click(dialog.getByText("Close"));
		await settle();
		expect(screen.queryByDisplayValue(secret)).toBeNull();
		fireEvent.click(await screen.findByRole("button", { name: "Permissions" }));
		const edit = within(await screen.findByRole("dialog"));
		expect(edit.getByRole<HTMLInputElement>("checkbox", { name: "Viewer" }).checked).toBe(true);
		fireEvent.click(edit.getByRole("checkbox", { name: "Viewer" }));
		fireEvent.click(edit.getByRole("checkbox", { name: "Analyst" }));
		fireEvent.click(edit.getByRole("button", { name: "Save" }));
		await settle();
		fireEvent.click(await screen.findByRole("button", { name: "Revoke token" }));
		fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke token" }));
		expect(await screen.findByText("Revoked")).toBeTruthy();
		const requests = api.mock.calls.filter(([url]) => String(url).includes(urlPath));
		expect(requests.filter(([, opt]) => opt?.method !== "GET").map(([, opt]) => opt?.method)).toEqual([
			"POST",
			"POST",
			"PUT",
			"DELETE",
		]);
		expect(JSON.parse(String(requests.find(([, opt]) => opt?.method === "POST")?.[1]?.body))).toEqual({
			name: issued.name,
			roles: [viewer.id],
			expires_in_days: 14,
		});
	});

	it("hides the service token panel for delegated role editors", async () => {
		const requests = signIn(["roles:view", "roles:manage"]);
		await changeLocale("en");
		await renderApp(<Roles />);
		await screen.findByRole("heading", { name: "Roles", level: 1 });
		expect(screen.queryByRole("heading", { name: "Service API tokens" })).toBeNull();
		expect(requests.mock.calls.some(([url]) => String(url).endsWith("/rbac/service-tokens"))).toBe(false);
	});

	it("keeps scoped WAF navigation on host policies and learning", async () => {
		const requests = signIn(["waf_policy:view", "waf_learning:view"]);
		await changeLocale("en");
		await renderApp(<AgentOpenappsec />);
		expect(await screen.findByRole("button", { name: /app\.example\.com/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Agent" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Versions" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Learning" }));
		await settle();
		expect(requests.mock.calls.some(([url]) => /learning\/(snapshots|profiles)/.test(String(url)))).toBe(false);
	});
});
