// Tabs of the section the page belongs to (menu.ts): the pages of a section next to each other,
// e.g. Analytics → Analytics · Events · Audit log. Hidden for a section with one visible page.
import cn from "classnames";
import { useLayoutEffect, useMemo, useRef } from "react";
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
	const strip = useRef<HTMLElement>(null);
	// the most specific tab: /a/b is the tab of /a/b, not of /a
	const active = section?.tabs
		?.filter((tab) => containsActive(tab, pathname))
		.sort((a, b) => (b.to?.length ?? 0) - (a.to?.length ?? 0))[0];
	useLayoutEffect(() => {
		const nav = strip.current;
		const current = nav?.querySelector('[aria-current="page"]');
		if (!active || !nav || !current || nav.scrollWidth <= nav.clientWidth) return;

		const stripBounds = nav.getBoundingClientRect();
		const tabBounds = current.getBoundingClientRect();
		if (tabBounds.left < stripBounds.left) {
			nav.scrollLeft += tabBounds.left - stripBounds.left;
		} else if (tabBounds.right > stripBounds.right) {
			nav.scrollLeft += tabBounds.right - stripBounds.right;
		}
	}, [active]);

	if (!section?.tabs || section.tabs.length < 2) return null;
	return (
		<nav ref={strip} className={styles.tabs} aria-label={intl.formatMessage({ id: section.label })}>
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
