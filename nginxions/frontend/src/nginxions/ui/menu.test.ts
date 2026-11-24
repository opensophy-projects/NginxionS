import type { UserPermissions } from "src/api/backend";
import { describe, expect, it } from "vitest";
import { containsActive, type NavItem, navigation, sectionOf, visibleItems } from "./menu";

const permissions: UserPermissions = {
	visibility: "user",
	proxyHosts: "hidden",
	redirectionHosts: "hidden",
	deadHosts: "hidden",
	streams: "hidden",
	certificates: "hidden",
	accessLists: "hidden",
};
const none = () => false;

describe("sidebar navigation", () => {
	it("does not show restricted tabs and sections before user permissions load", () => {
		const items = visibleItems(navigation, undefined, none);
		expect(items.map((item) => [item.id, item.to])).toEqual([["overview", "/"]]);
		expect(sectionOf(items, "/system/services")).toBeUndefined();
	});

	it("opens a section on its first permitted tab", () => {
		const me = { permissions: { ...permissions, accessLists: "view" } };
		const items = visibleItems(navigation, me, none);
		const hosts = sectionOf(items, "/access");
		expect(hosts?.to).toBe("/access");
		expect(hosts?.tabs?.map((item) => item.id)).toEqual(["access"]);
		expect(sectionOf(items, "/hosts")).toBeUndefined();
	});

	it("shows the unified hosts page for any allowed host type and certificates for PKI readers", () => {
		const me = { permissions: { ...permissions, streams: "view" } };
		const items = visibleItems(navigation, me, (resource) => resource === "pki");
		expect(sectionOf(items, "/hosts")?.to).toBe("/hosts");
		expect(items.find((item) => item.id === "certificates")?.to).toBe("/certificates");
	});

	it("marks real descendant paths active and drops recursively empty groups", () => {
		const groups: NavItem[] = [
			{
				id: "restricted",
				label: "restricted",
				items: [{ id: "hidden", label: "hidden", to: "/hidden", rbac: "admin" }],
			},
			{ id: "nodes", label: "nodes", items: [{ id: "nodes-list", label: "nodes.list", to: "/agents/nodes" }] },
		];
		const items = visibleItems(groups, undefined, none);
		expect(items.map((item) => item.id)).toEqual(["nodes"]);
		expect(containsActive(items[0], "/agents/nodes/one")).toBe(true);
		expect(containsActive(items[0], "/agents/nodes-backup")).toBe(false);
	});
});
