// The frame of the tests of the interface: the providers of App.tsx around an element, and the API of NginxionS
// answered from fixtures.ts (fetch replaced), so that a page or a window renders as it does in the browser.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import EasyModal from "ez-modal-react";
import { Formik } from "formik";
import type { ReactNode } from "react";
import { RawIntlProvider } from "react-intl";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, LocaleProvider, ThemeProvider } from "src/context";
import { intl } from "src/locale";
import { vi } from "vitest";
import * as f from "./fixtures";

const page = (items: unknown[]) => ({ items, total: items.length, limit: 50, offset: 0 });

// the first pattern that matches the path of a request answers it; anything else: an empty list
const ROUTES: [RegExp, unknown][] = [
	[/\/api\/tokens/, { token: "t", expires: "2099-01-01T00:00:00Z" }],
	[/\/api\/users\/me/, f.user],
	[/\/api\/users$/, [f.user]],
	[/\/api\/nginx\/proxy-hosts$/, [f.proxyHost]],
	[
		/\/nginxions\/rbac\/me$/,
		{
			admin: true,
			scope: "all",
			permissions: [],
			roles: [{ id: 1, name: "Administrator", builtin: "administrator" }],
		},
	],
	[/\/nginxions\/rbac\/roles$/, [f.role]],
	[/\/nginxions\/pki$/, f.pkiOverview],
	[/\/nginxions\/pki\/certs\/\d+$/, f.pkiCert],
	[/\/nginxions\/notifications$/, f.notifications],
	[/\/nginxions\/acme\/servers$/, { items: [f.acmeServer], presets: [f.acmePreset], clients: ["certbot", "lego"] }],
	[/\/nginxions\/crowdsec\/settings$/, f.crowdsecSettings],
	[
		/\/nginxions\/crowdsec\/hosts$/,
		{
			bouncerEnabled: true,
			perHost: true,
			bans: { "app.example.com": 2 },
			hosts: [{ hostType: "proxy_host", hostId: 1, bouncer: true }],
		},
	],
	[/\/nginxions\/rbac\/oidc$/, { claim: "groups", requestScope: true }],
	[/\/nginxions\/analytics\/traffic$/, f.traffic],
	[/\/nginxions\/crowdsec\/decisions$/, [f.decision]],
	[/\/nginxions\/crowdsec\/blocklists$/, [f.blocklist]],
	[
		/\/nginxions\/events$/,
		{
			events: [f.event],
			next: null,
			total: 1,
			totalCapped: false,
			from: "2026-11-17T10:00:00.000Z",
			to: "2026-11-18T10:00:00.000Z",
			available: true,
			ingestError: null,
		},
	],
	[/\/nginxions\/events\/[^/]+$/, { ...f.event, raw: {} }],
	[/\/nginxions\/audit$/, { ...page([]), facets: { actions: [], objects: [], users: [] } }],
	[
		/\/nginxions\/certificates$/,
		{
			...page([]),
			counts: { source: {}, status: {} },
			kinds: [],
			expiringDays: 14,
			can: { tls: true, pki: true },
		},
	],
	[/\/nginxions\/learning\/hosts$/, [f.learningHost]],
	[/\/nginxions\/nodes$/, [f.node]],
	[/\/nginxions\/nodes\/rollout$/, f.rollout],
	[/\/nginxions\/nodes\/\d+\/logs$/, f.nodeLogs],
	[/\/nginxions\/nodes\/cluster-learning$/, f.clusterLearningSites],
	[/\/nginxions\/learning\/queue$/, { groups: [f.queueGroup], suggestions: [f.suggestion], total: 1 }],
	[/\/nginxions\/waf\/policy\/objects$/, f.policyObjects],
	[/\/nginxions\/waf\/agent$/, f.wafAgent],
	[/\/nginxions\/analytics$/, f.analytics],
	[/\/nginxions\/crowdsec$/, f.crowdsecOverview],
	[/\/nginxions\/waf\/files$/, f.wafFiles],
	[/\/nginxions\/waf\/policy\/custom$/, f.wafCustomPolicy],
	[/\/nginxions\/block-page$/, f.blockPage],
	[/\/nginxions\/mtls\/[a-z_]+\/\d+$/, f.mtlsHost],
	[/\/nginxions\/learning\/snapshots$/, f.snapshots],
	[/\/nginxions\/learning\/profiles$/, f.profiles],
	[/\/nginxions\/learning\/hosts\/\d+\/learned$/, f.learned],
];

export const answer = (url: string): unknown => {
	const path = url.split("?")[0];
	for (const [pattern, data] of ROUTES) if (pattern.test(path)) return structuredClone(data);
	return [];
};

/** fetch answers from the fixtures; a signed in administrator */
export const mockApi = () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			return new Response(JSON.stringify(answer(url)), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}),
	);
	localStorage.setItem("authentications", JSON.stringify([{ expires: "2099-01-01T00:00:00Z" }]));
};

export const Providers = ({ children, form = {} }: { children: ReactNode; form?: Record<string, unknown> }) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return (
		<RawIntlProvider value={intl}>
			<LocaleProvider>
				<ThemeProvider>
					<QueryClientProvider client={client}>
						<AuthProvider>
							<EasyModal.Provider>
								<MemoryRouter>
									<Formik initialValues={form} onSubmit={() => {}}>
										{() => children}
									</Formik>
								</MemoryRouter>
							</EasyModal.Provider>
						</AuthProvider>
					</QueryClientProvider>
				</ThemeProvider>
			</LocaleProvider>
		</RawIntlProvider>
	);
};

/** renders inside the providers and lets the queries of the element answer */
export const renderApp = async (element: ReactNode, form?: Record<string, unknown>) => {
	let result: ReturnType<typeof render> | undefined;
	await act(async () => {
		result = render(<Providers form={form}>{element}</Providers>);
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	return result as ReturnType<typeof render>;
};

/** lets the queries started after an event answer */
export const settle = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
