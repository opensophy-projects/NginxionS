// Application shell in the look of opensophy.com/docs (content/ContentSectionLayout): the sidebar
// on the left, the page in an inset panel that scrolls on its own; on narrow screens a top bar
// and the sidebar as a drawer from the left. Replaces the upstream header, top menu and footer.
import { IconLayoutSidebarLeftExpand, IconX } from "@tabler/icons-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { intl, T } from "src/locale";
import { useCloseLabels } from "./closeLabels";
import { SectionTabs } from "./SectionTabs";
import styles from "./Shell.module.css";
import { Sidebar } from "./Sidebar";

const MAIN_ID = "nginxions-main";
const SCROLL_ID = "nginxions-content";

function MobileDrawer() {
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const toggle = useRef<HTMLButtonElement>(null);
	const drawer = useRef<HTMLDialogElement>(null);
	const closeButton = useRef<HTMLButtonElement>(null);

	const close = useCallback(() => {
		drawer.current?.close();
		setOpen(false);
		toggle.current?.focus({ preventScroll: true });
	}, []);

	useEffect(() => {
		if (!open) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const desktop = window.matchMedia("(min-width: 1024px)");
		const onResize = (event: MediaQueryListEvent) => {
			if (event.matches) close();
		};
		desktop.addEventListener("change", onResize);
		return () => {
			document.body.style.overflow = previousOverflow;
			desktop.removeEventListener("change", onResize);
		};
	}, [open, close]);

	const show = () => {
		const panel = drawer.current;
		if (!panel || panel.open) return;
		panel.showModal();
		setOpen(true);
		closeButton.current?.focus({ preventScroll: true });
	};

	return (
		<>
			<div className={styles.mobileBar}>
				<button
					ref={toggle}
					type="button"
					className={styles.iconButton}
					aria-label={intl.formatMessage({ id: "nginxions.nav.open-menu" })}
					aria-controls="nginxions-mobile-drawer"
					aria-expanded={open}
					onClick={show}
				>
					<IconLayoutSidebarLeftExpand size={16} />
				</button>
				<a
					href="/"
					className={styles.mobileBrand}
					onClick={(e) => {
						e.preventDefault();
						navigate("/");
					}}
				>
					<img src="/images/logo-no-text.svg" alt="" />
					NginxionS
				</a>
			</div>
			<dialog
				ref={drawer}
				id="nginxions-mobile-drawer"
				className={styles.drawer}
				aria-label={intl.formatMessage({ id: "nginxions.nav.menu" })}
				onCancel={(event) => {
					event.preventDefault();
					close();
				}}
				onClick={(event) => {
					const bounds = event.currentTarget.getBoundingClientRect();
					if (event.target === event.currentTarget && event.clientX >= bounds.right) close();
				}}
				onKeyDown={(event) => {
					if (event.key !== "Tab" || event.defaultPrevented) return;
					const buttons = Array.from(
						event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"),
					).filter((node) => !node.closest("[inert]") && node.getClientRects().length > 0);
					const edge = event.shiftKey ? buttons[0] : buttons.at(-1);
					if (document.activeElement === edge) {
						event.preventDefault();
						(event.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
					}
				}}
			>
				<button
					ref={closeButton}
					type="button"
					className={styles.drawerClose}
					aria-label={intl.formatMessage({ id: "nginxions.nav.close-menu" })}
					onClick={close}
				>
					<IconX size={24} />
				</button>
				<Sidebar onNavigate={close} />
			</dialog>
		</>
	);
}

export function Shell({ children }: { children: ReactNode }) {
	const { pathname } = useLocation();
	useCloseLabels();

	// a new page starts at the top of the panel
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on navigation
	useEffect(() => {
		document.getElementById(SCROLL_ID)?.scrollTo({ top: 0 });
	}, [pathname]);

	return (
		<>
			<a href={`#${MAIN_ID}`} className={styles.skip}>
				<T id="nginxions.nav.skip" />
			</a>
			<main className={styles.main}>
				<MobileDrawer />
				<div className={styles.grid}>
					<div className={styles.sidebarShell}>
						<Sidebar />
					</div>
					<div className={styles.contentShell}>
						<div className={styles.content}>
							<div id={SCROLL_ID} className={styles.scroll}>
								<div id={MAIN_ID} tabIndex={-1} className={styles.page}>
									<SectionTabs />
									{children}
								</div>
							</div>
						</div>
					</div>
				</div>
			</main>
		</>
	);
}
