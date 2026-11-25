import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { changeLocale } from "src/locale";
import { showError, showSuccess } from "src/notifications";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxyHost, user } from "../../test/fixtures";
import { answer, mockApi, renderApp } from "../../test/harness";
import HostsPage from "./index";
import { exportData, toRows } from "./rows";

vi.mock("src/notifications", async (importOriginal) => ({
	...(await importOriginal<typeof import("src/notifications")>()),
	showError: vi.fn(),
	showSuccess: vi.fn(),
}));

const first = { ...proxyHost, domainNames: ["alpha.example.test"], forwardHost: "alpha-upstream" };
const second = { ...proxyHost, id: 2, domainNames: ["beta.example.test"], forwardHost: "beta-upstream" };
const endpoint = "/api/nginx/proxy-hosts";
const result = (value: unknown, status = 200) => Response.json(value, { status });

function fixtureApi(overrides: Record<string, Response> = {}) {
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const path = url.split("?")[0];
		const override = overrides[`${init?.method ?? "GET"} ${path}`];
		if (override) return override.clone();
		if (path === endpoint) return result([first, second]);
		if (path === "/api/nginxions/learning/hosts") return result({ hosts: [] });
		return result(answer(url));
	});
	vi.stubGlobal("fetch", fetch);
	return fetch;
}

function SearchLocation() {
	const { search } = useLocation();
	return <output data-testid="query">{search}</output>;
}

const showHosts = () =>
	renderApp(
		<>
			<HostsPage />
			<SearchLocation />
		</>,
	);
const host = (name: string) => screen.getByRole("checkbox", { name });
const tableNames = () =>
	within(screen.getByRole("table"))
		.getAllByRole("row")
		.slice(1)
		.flatMap((row) => within(row).queryAllByRole("checkbox").slice(0, 1))
		.map((checkbox) => checkbox.getAttribute("aria-label"));

beforeEach(() => {
	localStorage.clear();
	mockApi();
	changeLocale("en");
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("the Hosts page", () => {
	it("filters via the keyboard search and keeps sort order and filters in the URL", async () => {
		fixtureApi();
		await showHosts();
		await screen.findByRole("checkbox", { name: "alpha.example.test" });
		expect(tableNames()).toEqual(["alpha.example.test", "beta.example.test"]);

		const heading = within(screen.getByRole("columnheader", { name: /^Name/ }));
		fireEvent.click(heading.getByRole("button", { name: /^Name/ }));
		expect(tableNames()).toEqual(["beta.example.test", "alpha.example.test"]);
		expect(screen.getByTestId("query")).toHaveTextContent("desc=1");
		fireEvent.click(heading.getByRole("button", { name: /^Name/ }));
		expect(tableNames()).toEqual(["alpha.example.test", "beta.example.test"]);

		const search = screen.getByPlaceholderText(/Search hosts/);
		fireEvent.keyDown(document.body, { key: "/" });
		expect(search).toHaveFocus();
		fireEvent.change(search, { target: { value: "beta-upstream" } });
		expect(tableNames()).toEqual(["beta.example.test"]);
		expect(screen.getByTestId("query")).toHaveTextContent("q=beta-upstream");

		fireEvent.change(search, { target: { value: "missing.example.test" } });
		expect(screen.getByText("Nothing found")).toBeInTheDocument();
		fireEvent.change(search, { target: { value: "" } });
		expect(tableNames()).toEqual(["alpha.example.test", "beta.example.test"]);
	});

	it("applies multiple filters and clears them from both the table and URL", async () => {
		fixtureApi();
		await showHosts();
		await screen.findByRole("checkbox", { name: "alpha.example.test" });
		fireEvent.click(screen.getByRole("button", { name: "Filters and view" }));
		fireEvent.change(screen.getByRole("combobox", { name: "Field" }), { target: { value: "target" } });
		fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "beta-upstream" } });
		fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
		fireEvent.change(screen.getAllByRole("combobox", { name: "Field" })[1], { target: { value: "status" } });
		expect(screen.getByRole("combobox", { name: "Value" })).toHaveValue("online");
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));

		expect(tableNames()).toEqual(["beta.example.test"]);
		const query = new URLSearchParams(screen.getByTestId("query").textContent ?? "");
		expect(query.getAll("f")).toEqual(["target:has:beta-upstream", "status:is:online"]);
		fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
		expect(tableNames()).toEqual(["alpha.example.test", "beta.example.test"]);
		expect(screen.getByTestId("query")).toBeEmptyDOMElement();
	});

	it("keeps new columns hidden in old preferences and persists display changes and reset", async () => {
		fixtureApi();
		const key = `nginxions.hosts.view.${user.id}`;
		localStorage.setItem(key, JSON.stringify({ v: 2, hidden: ["tls"], compact: false }));
		await showHosts();
		await screen.findByRole("checkbox", { name: "alpha.example.test" });
		expect(screen.queryByRole("columnheader", { name: "Attacks 24 h" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Filters and view" }));
		fireEvent.click(screen.getByRole("tab", { name: "Display options" }));
		fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Attacks 24 h" }));
		fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Compact rows" }));
		expect(screen.getByRole("columnheader", { name: "Attacks 24 h" })).toBeInTheDocument();
		expect(JSON.parse(localStorage.getItem(key) ?? "")).toEqual({
			v: 4,
			hidden: ["tls", "crowdsec"],
			compact: true,
		});

		fireEvent.click(screen.getByRole("button", { name: "Reset" }));
		expect(JSON.parse(localStorage.getItem(key) ?? "")).toEqual({
			v: 4,
			hidden: ["changed", "attacks", "crowdsec"],
			compact: false,
		});
		expect(screen.queryByRole("columnheader", { name: "Attacks 24 h" })).toBeNull();
	});

	it("reports partial bulk updates and lets the operator clear the selection", async () => {
		const fetch = fixtureApi({
			[`POST ${endpoint}/2/disable`]: result({ error: { message: "Host is locked" } }, 409),
		});
		await showHosts();
		await screen.findByRole("checkbox", { name: "alpha.example.test" });
		fireEvent.click(screen.getByRole("checkbox", { name: "Select all shown hosts" }));
		expect(host("alpha.example.test")).toBeChecked();
		expect(host("beta.example.test")).toBeChecked();

		fireEvent.click(screen.getByRole("button", { name: "Disable" }));
		await waitFor(() =>
			expect(showError).toHaveBeenCalledWith("Succeeded: 1. Failed: 1.\nbeta.example.test: Host is locked"),
		);
		expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST").map(([path]) => path)).toEqual([
			`${endpoint}/1/disable`,
			`${endpoint}/2/disable`,
		]);
		expect(showSuccess).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
		expect(host("alpha.example.test")).not.toBeChecked();
		expect(host("beta.example.test")).not.toBeChecked();
	});

	it("exports only the selected host and releases the download URL", async () => {
		fixtureApi();
		const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:hosts-export");
		const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
		await showHosts();
		fireEvent.click(await screen.findByRole("checkbox", { name: "beta.example.test" }));
		fireEvent.click(screen.getByRole("button", { name: "Export" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Export CSV (selected: 1)" }));

		expect(click).toHaveBeenCalledTimes(1);
		const blob = create.mock.calls[0][0] as Blob;
		const csv = await blob.text();
		expect(csv).toContain("beta.example.test");
		expect(csv).not.toContain("alpha.example.test");
		expect(revoke).toHaveBeenCalledWith("blob:hosts-export");
	});

	it("validates imported files and requires a destination for its references before creating hosts", async () => {
		const fetch = fixtureApi({ "GET /api/nginx/access-lists": result([{ id: 55, name: "Destination" }]) });
		const view = await showHosts();
		await screen.findByRole("checkbox", { name: "alpha.example.test" });
		const upload = view.container.querySelector<HTMLInputElement>('input[type="file"]');
		if (!upload) throw new Error("Missing host import file picker");
		fireEvent.change(upload, { target: { files: [new File(["{}"], "invalid.json")] } });
		await waitFor(() => expect(showError).toHaveBeenCalledWith("This is not an NginxionS hosts export"));

		const file = exportData(
			toRows({
				proxy: [{ ...second, enabled: false, npmplusAccessListIds: [7], npmplusAccessListType: "custom" }],
			}),
		);
		fireEvent.change(upload, { target: { files: [new File([JSON.stringify(file)], "hosts.json")] } });
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Import" }));
		expect(
			await within(dialog).findByText("Select a target for every reference before importing."),
		).toBeInTheDocument();
		expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

		fireEvent.change(within(dialog).getByRole("combobox", { name: /Source access list/ }), {
			target: { value: "55" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Import" }));
		await waitFor(() => expect(showSuccess).toHaveBeenCalledWith("Hosts imported: 1"));
		const request = fetch.mock.calls.find(([url, init]) => url === endpoint && init?.method === "POST")?.[1];
		expect(JSON.parse(String(request?.body))).toMatchObject({ enabled: false, npmplus_access_list_ids: [55] });
	});

	it("keeps a view-only role from selecting rows or importing hosts", async () => {
		fixtureApi({
			"GET /api/users/me": result({ ...user, roles: [], permissions: { visibility: "all", proxyHosts: "view" } }),
		});
		await showHosts();
		expect(await screen.findByRole("checkbox", { name: "alpha.example.test" })).toBeDisabled();
		expect(screen.getByRole("checkbox", { name: "Select all shown hosts" })).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "Export" }));
		expect(screen.queryByRole("menuitem", { name: "Import hosts (JSON)" })).toBeNull();
	});
});
