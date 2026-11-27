import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { changeLocale } from "src/locale";
import { afterEach, expect, it, vi } from "vitest";
import { LearningTab } from "../learning/Learning";
import WafEvents from "../pages/WafEvents";
import { event } from "../test/fixtures";
import { answer, mockApi, renderApp } from "../test/harness";
import { Dropdown } from "./Dropdown";
import { Popover } from "./Popover";
import { SearchField } from "./SearchField";
import { Shell } from "./Shell";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("paginates learning history on the server with the same controls as Events", async () => {
	changeLocale("en");
	mockApi();
	const offsets: [number, number][] = [];
	vi.mocked(fetch).mockImplementation(async (input) => {
		const url = new URL(String(input), "http://localhost");
		if (!url.pathname.endsWith("/learning/labels")) return Response.json(answer(String(input)));
		const offset = Number(url.searchParams.get("offset"));
		const limit = Number(url.searchParams.get("limit"));
		offsets.push([offset, limit]);
		const total = 26;
		const items = Array.from({ length: Math.min(limit, total - offset) }, (_, i) => ({
			id: total - offset - i,
			host: `host-${total - offset - i}.example`,
			createdOn: "2026-11-18T10:00:00.000Z",
			decision: "dismiss",
			origin: "group",
			scopes: [],
			features: {},
		}));
		return Response.json({ items, total, limit, offset });
	});
	await renderApp(<LearningTab />);

	expect(await screen.findByText("Page 1 of 2")).toBeVisible();
	expect(screen.getAllByText(/^host-\d+\.example$/)).toHaveLength(25);
	expect(screen.getByRole("button", { name: "Newer" })).toBeDisabled();
	fireEvent.click(screen.getByRole("button", { name: "Older" }));
	expect(await screen.findByText("Page 2 of 2")).toBeVisible();
	expect(screen.getByText("host-1.example")).toBeVisible();
	expect(screen.queryByText("host-2.example")).toBeNull();
	expect(screen.getByRole("button", { name: "Older" })).toBeDisabled();
	fireEvent.click(screen.getByRole("button", { name: "Newer" }));
	expect(await screen.findByText("Page 1 of 2")).toBeVisible();
	expect(offsets).toEqual(
		expect.arrayContaining([
			[0, 25],
			[25, 25],
		]),
	);
});

it("renders event flags for stored country names and GeoIP codes, including the event details", async () => {
	changeLocale("en");
	mockApi();
	const security = { ...event, sourceCountry: "Germany", proxyIp: "192.0.2.8", proxyCountryCode: "FR" };
	const crowdsec = {
		...event,
		id: "2",
		kind: "crowdsec",
		sourceIp: "198.51.100.8",
		sourceCountry: "",
		sourceCountryCode: "SG",
	};
	const unknown = { ...event, id: "3", kind: "system", sourceIp: "192.168.0.8", sourceCountry: "" };
	vi.mocked(fetch).mockImplementation(async (input) => {
		const path = new URL(String(input), "http://localhost").pathname;
		if (path.endsWith("/nginxions/events")) {
			return Response.json({ ...(answer(path) as object), events: [security, crowdsec, unknown] });
		}
		if (path.endsWith(`/nginxions/events/${security.id}`)) return Response.json({ ...security, raw: {} });
		return Response.json(answer(String(input)));
	});
	await renderApp(<WafEvents />);

	const germany = await screen.findByRole("img", { name: "Germany" });
	expect(germany.closest("button")).toHaveTextContent(security.sourceIp);
	expect(screen.getByRole("img", { name: "Singapore" }).closest("button")).toHaveTextContent(crowdsec.sourceIp);
	expect(within(screen.getByRole("button", { name: unknown.sourceIp })).queryByRole("img")).toBeNull();
	const row = germany.closest("tr");
	if (!row) throw new Error("Missing event row");
	fireEvent.click(row);
	const details = await screen.findByRole("dialog");
	expect(within(details).getByRole("img", { name: "Germany" })).toBeVisible();
	expect(within(details).getByRole("img", { name: "France" })).toBeVisible();
});

it("opens a floating menu on an enabled choice and skips disabled choices with the arrow keys", async () => {
	const first = vi.fn();
	const disabled = vi.fn();
	const last = vi.fn();
	const parent = render(
		<Dropdown
			floating
			ariaLabel="Options"
			trigger="Options"
			items={[
				{ key: "first", label: "First", onSelect: first },
				{ key: "disabled", label: "Unavailable", disabled: true, active: true, onSelect: disabled },
				{ key: "last", label: "Last", onSelect: last },
			]}
		/>,
	);
	const trigger = screen.getByRole("button", { name: "Options" });
	fireEvent.click(trigger);
	const menu = screen.getByRole("menu");
	const firstItem = within(menu).getByRole("menuitem", { name: "First" });
	const lastItem = within(menu).getByRole("menuitem", { name: "Last" });
	expect(parent.container).not.toContainElement(menu);
	expect(within(menu).getByRole("menuitem", { name: "Unavailable" })).toBeDisabled();
	await waitFor(() => expect(firstItem).toHaveFocus());
	fireEvent.keyDown(firstItem, { key: "ArrowDown" });
	expect(lastItem).toHaveFocus();
	fireEvent.keyDown(lastItem, { key: "ArrowUp" });
	expect(firstItem).toHaveFocus();
	fireEvent.keyDown(firstItem, { key: "Escape" });
	expect(screen.queryByRole("menu")).toBeNull();
	expect(trigger).toHaveFocus();

	fireEvent.click(trigger);
	fireEvent.click(screen.getByRole("menuitem", { name: "Last" }));
	expect(last).toHaveBeenCalledOnce();
	expect(first).not.toHaveBeenCalled();
	expect(disabled).not.toHaveBeenCalled();
	expect(trigger).toHaveAttribute("aria-expanded", "false");
});

it("closes an open menu on Tab, outside pointer input, resize or page scroll", async () => {
	render(
		<Dropdown
			floating
			ariaLabel="Actions"
			trigger="Open"
			items={[{ key: "save", label: "Save", onSelect: vi.fn() }]}
		/>,
	);
	const trigger = screen.getByRole("button", { name: "Actions" });
	fireEvent.click(trigger);
	const item = screen.getByRole("menuitem", { name: "Save" });
	await waitFor(() => expect(item).toHaveFocus());
	fireEvent.scroll(screen.getByRole("menu"));
	expect(item).toHaveFocus();
	fireEvent.keyDown(item, { key: "Tab" });
	expect(screen.queryByRole("menu")).toBeNull();
	for (const close of [
		() => fireEvent.mouseDown(document.body),
		() => fireEvent(window, new Event("resize")),
		() => fireEvent.scroll(document),
	]) {
		fireEvent.click(trigger);
		expect(trigger).toHaveAttribute("aria-expanded", "true");
		close();
		expect(trigger).toHaveAttribute("aria-expanded", "false");
	}
});

it("keeps a popover open for its controls and marked portal content, then restores focus on Escape", () => {
	const title = "Display settings";
	const portal = "Portal content";
	const doneLabel = "Done";
	render(
		<>
			<div data-popover-keep>{portal}</div>
			<Popover trigger="Options" ariaLabel="Display" title={title}>
				{(close) => (
					<button type="button" onClick={close}>
						{doneLabel}
					</button>
				)}
			</Popover>
		</>,
	);
	const trigger = screen.getByRole("button", { name: "Display" });
	fireEvent.click(trigger);
	const dialog = screen.getByRole("dialog", { name: "Display" });
	const done = within(dialog).getByRole("button", { name: doneLabel });
	fireEvent.mouseDown(screen.getByText(portal));
	fireEvent.mouseDown(done);
	expect(dialog).toBeInTheDocument();
	done.focus();
	fireEvent.keyDown(done, { key: "Escape" });
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(trigger).toHaveFocus();

	fireEvent.click(trigger);
	fireEvent.click(screen.getByRole("button", { name: doneLabel }));
	expect(trigger).toHaveFocus();
	fireEvent.click(trigger);
	fireEvent.mouseDown(document.body);
	expect(screen.queryByRole("dialog")).toBeNull();
	fireEvent.click(trigger);
	fireEvent(window, new Event("resize"));
	expect(screen.queryByRole("dialog")).toBeNull();
});

it("moves a wide popover inside the right edge of the viewport", () => {
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
		if (this.getAttribute("role") === "dialog") {
			const right = this.style.right === "16px" ? window.innerWidth - 16 : window.innerWidth + 50;
			return new DOMRect(right - 400, 50, 400, 200);
		}
		return new DOMRect(window.innerWidth / 2 - 100, 12, 48, 30);
	});
	const label = "Display";
	render(
		<Popover trigger={label} ariaLabel={label} title={label} width="400px">
			{() => null}
		</Popover>,
	);
	fireEvent.click(screen.getByRole("button", { name: label }));
	expect(screen.getByRole("dialog", { name: label })).toHaveStyle({ right: "16px", left: "auto", top: "50px" });
});

it("clears a nonempty search without closing its enclosing dialog", () => {
	const escaped = vi.fn();
	const placeholder = "Search entries";
	function Search() {
		const [value, setValue] = useState("");
		return <SearchField value={value} onChange={setValue} placeholder={placeholder} variant="inset" hotkey="/" />;
	}
	document.addEventListener("keydown", escaped);
	try {
		render(<Search />);
		const field = screen.getByRole("searchbox", { name: placeholder });
		expect(screen.getByText("/")).toBeInTheDocument();
		fireEvent.change(field, { target: { value: "table" } });
		expect(field).toHaveValue("table");
		escaped.mockClear();
		fireEvent.keyDown(field, { key: "Escape" });
		expect(field).toHaveValue("");
		expect(escaped).not.toHaveBeenCalled();
		fireEvent.keyDown(field, { key: "Escape" });
		expect(escaped).toHaveBeenCalledOnce();
	} finally {
		document.removeEventListener("keydown", escaped);
	}
});

function CurrentPage() {
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const back = "Go back";
	return (
		<>
			<output data-testid="page">{pathname}</output>
			<button type="button" onClick={() => navigate(-1)}>
				{back}
			</button>
		</>
	);
}

const renderShell = () => {
	localStorage.clear();
	localStorage.setItem("tabler-theme", "light");
	changeLocale("en");
	mockApi();
	return renderApp(
		<Shell>
			<CurrentPage />
		</Shell>,
	);
};

it("traps focus in the mobile menu and closes it on navigation, Escape, backdrop or a desktop resize", async () => {
	const desktop = new EventTarget();
	const matchMedia = window.matchMedia.bind(window);
	vi.stubGlobal("matchMedia", (query: string) => (query === "(min-width: 1024px)" ? desktop : matchMedia(query)));
	const root = await renderShell();
	const toggle = screen.getByRole("button", { name: "Open menu" });
	const dialog = () => screen.getByRole("dialog", { name: "Navigation" });
	const open = () => {
		fireEvent.click(toggle);
		expect(toggle).toHaveAttribute("aria-expanded", "true");
		return dialog();
	};
	const closed = () => {
		expect(toggle).toHaveAttribute("aria-expanded", "false");
		expect(toggle).toHaveFocus();
	};

	const skip = screen.getByRole("link", { name: "Skip to content" });
	expect(root.container.querySelector(skip.getAttribute("href") ?? "#missing")).toContainElement(
		screen.getByTestId("page"),
	);
	const content = root.container.querySelector<HTMLElement>("#nginxions-content");
	if (!content) throw new Error("Missing scrollable content");
	const scroll = vi.spyOn(content, "scrollTo");
	const panel = open();
	const close = within(panel).getByRole("button", { name: "Close menu" });
	const last = within(panel).getByRole("button", { name: "Language" });
	expect(close).toHaveFocus();
	fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
	expect(last).toHaveFocus();
	fireEvent.keyDown(last, { key: "Tab" });
	expect(close).toHaveFocus();
	fireEvent.click(within(panel).getByRole("link", { name: "Hosts" }));
	closed();
	expect(screen.getByTestId("page")).toHaveTextContent("/hosts");
	expect(scroll).toHaveBeenCalledWith({ top: 0 });

	fireEvent(open(), new Event("cancel", { cancelable: true }));
	closed();
	fireEvent.click(open(), { clientX: 500 });
	closed();
	open();
	const resized = Object.assign(new Event("change"), { matches: true });
	act(() => {
		desktop.dispatchEvent(resized);
	});
	closed();

	fireEvent.click(within(open()).getByRole("button", { name: "Close menu" }));
	closed();
	const bar = toggle.parentElement;
	if (!bar) throw new Error("Missing mobile toolbar");
	fireEvent.click(within(bar).getByRole("link", { name: "NginxionS" }));
	expect(screen.getByTestId("page").textContent).toBe("/");
});

it("marks the active section and tab and changes theme and language without leaving the page", async () => {
	await renderShell();
	const navigation = screen.getByRole("navigation", { name: "Navigation" });
	const admin = within(navigation).getByRole("link", { name: "Administration" });
	expect(admin).not.toHaveAttribute("aria-current");
	fireEvent.mouseEnter(admin);
	expect(navigation.style.getPropertyValue("--hover-opacity")).toBe("1");
	fireEvent.mouseLeave(navigation);
	expect(navigation.style.getPropertyValue("--hover-opacity")).toBe("0");
	act(() => admin.focus());
	expect(navigation.style.getPropertyValue("--hover-opacity")).toBe("1");
	act(() => screen.getByRole("link", { name: "Skip to content" }).focus());
	expect(navigation.style.getPropertyValue("--hover-opacity")).toBe("0");
	fireEvent.click(admin);
	const tabs = within(screen.getByRole("navigation", { name: "Administration" }));
	const users = tabs.getByRole("link", { name: "Users" });
	const roles = tabs.getByRole("link", { name: "Roles" });
	expect(users).toHaveAttribute("aria-current", "page");
	fireEvent.click(roles);
	expect(screen.getByTestId("page")).toHaveTextContent("/roles");
	expect(roles).toHaveAttribute("aria-current", "page");
	expect(admin).toHaveAttribute("aria-current", "page");
	fireEvent.click(screen.getByRole("button", { name: "Go back" }));
	expect(users).toHaveAttribute("aria-current", "page");

	const sidebar = within(screen.getByRole("complementary", { name: "Navigation" }));
	fireEvent.click(sidebar.getByRole("button", { name: "Dark theme" }));
	expect(document.documentElement).toHaveAttribute("data-bs-theme", "dark");
	fireEvent.click(sidebar.getByRole("button", { name: "Language" }));
	fireEvent.click(sidebar.getByRole("menuitem", { name: "Русский" }));
	expect(document.documentElement).toHaveAttribute("lang", "ru");
	expect(screen.getByTestId("page")).toHaveTextContent("/users");
	fireEvent.click(sidebar.getByRole("link", { name: "NginxionS" }));
	expect(screen.getByTestId("page").textContent).toBe("/");
});
