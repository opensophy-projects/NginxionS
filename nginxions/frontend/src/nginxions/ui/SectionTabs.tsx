// Tabs of the section the page belongs to (menu.ts): the pages of a section next to each other,
// e.g. Analytics → Analytics · Events · Audit log. Hidden for a section with one visible page.
import cn from "classnames";
import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useUser } from "src/hooks";
import { intl, T } from "src/locale";
import { useCan } from "../rbac/hooks";
import { containsActive, navigation, sectionOf, visibleItems } from "./menu";
import styles from "./SectionTabs.module.css";

export function SectionTabs() {
	const { pathname } = useLocation();
	const { data: me } = useUser("me");
	const can = useCan();
	const section = useMemo(() => sectionOf(visibleItems(navigation, me, can), pathname), [me, can, pathname]);
	if (!section?.tabs || section.tabs.length < 2) return null;
	// the most specific tab: /a/b is the tab of /a/b, not of /a
	const active = section.tabs
		.filter((tab) => containsActive(tab, pathname))
		.sort((a, b) => (b.to?.length ?? 0) - (a.to?.length ?? 0))[0];
	return (
		<nav className={styles.tabs} aria-label={intl.formatMessage({ id: section.label })}>
			{section.tabs.map((tab) => {
				const current = tab === active;
				return (
					<Link
						key={tab.id}
						to={tab.to as string}
						className={cn(styles.tab, current && styles.active)}
						aria-current={current ? "page" : undefined}
					>
						<T id={tab.label} />
					</Link>
				);
			})}
		</nav>
	);
}
