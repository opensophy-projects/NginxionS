// Security → CrowdSec (docs/ROADMAP.md, phase 7; ADR-0010), instead of the CrowdSec Console and
// cscli: the state of the local API, what CrowdSec reads and decides, decisions and alerts, local
// blocklists, the hub, machines and bouncers, and every setting. Nothing here needs the internet.
import { useQueryClient } from "@tanstack/react-query";
import cn from "classnames";
import { useLayoutEffect, useRef, useState } from "react";
import Alert from "react-bootstrap/Alert";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { HasPermission, LoadingPage } from "src/components";
import { intl, T } from "src/locale";
import { VIEW } from "src/modules/Permissions";
import { showError, showSuccess } from "src/notifications";
import {
	applySettings,
	type CrowdsecOverview,
	type CrowdsecSettingsState,
	getSettingsCode,
	putSettingsCode,
	useCrowdsec,
	useCrowdsecSettings,
} from "../../crowdsec/api";
import { showBanModal } from "../../crowdsec/BanModal";
import { originLabel, t } from "../../crowdsec/labels";
import styles from "../../pki/Pki.module.css";
import { CodePane } from "../../policy/CodePane";
import { NodePicker, NodeServiceView } from "../../nodes/NodeView";
import { useCan } from "../../rbac/hooks";
import agentStyles from "../AgentOpenappsec/Agent.module.css";
import hostStyles from "../Hosts/Hosts.module.css";
import { BlocklistsTab, RegistryTab } from "./Blocklists";
import { AlertsTab, DecisionsTab } from "./Decisions";
import { HubTab } from "./Hub";
import { MetricsPanel } from "./Metrics";
import crowdsecStyles from "./Crowdsec.module.css";
import { SettingsTab } from "./Settings";
import { AgentTriggersTab } from "./Triggers";

// Agents → CrowdSec: the agent, its policy and its alerts; Analytics → Blocks: what the agents block (one page,
// two places). "Triggers" lists the refusals of open-appsec and the bans of CrowdSec together.
const AGENT_TABS = ["overview", "alerts", "settings", "hub", "registry"] as const;
const BLOCK_TABS = ["decisions", "triggers", "blocklists"] as const;
const TABS = [...AGENT_TABS, ...BLOCK_TABS] as const;
type Tab = (typeof TABS)[number];
type Place = "agent" | "blocks";

function SettingsView({
	data,
	refresh,
	manage,
}: {
	data: CrowdsecSettingsState;
	refresh: () => void;
	manage: boolean;
}) {
	const [view, setView] = useState<"gui" | "code">("gui");
	return (
		<>
			<div className={agentStyles.toggle} role="group" aria-label={t("nginxions.agent.view")}>
				{(["gui", "code"] as const).map((v) => (
					<button
						key={v}
						type="button"
						className={cn(agentStyles.toggleItem, view === v && agentStyles.toggleOn)}
						aria-pressed={view === v}
						onClick={() => setView(v)}
					>
						<T id={`nginxions.agent.view.${v}`} />
					</button>
				))}
			</div>
			{view === "gui" ? (
				<SettingsTab data={data} refresh={refresh} />
			) : (
				<section className={cn("card", styles.card)}>
					<CodePane
						id="crowdsec-settings"
						manage={manage}
						hint={<T id="nginxions.crowdsec.settings.code.hint" />}
						load={async () => (await getSettingsCode()).content}
						check={(content) => putSettingsCode(content, true)}
						apply={async (content) => {
							const r = await putSettingsCode(content, false);
							if (!r.valid) throw new Error(r.error);
							refresh();
						}}
					/>
				</section>
			)}
		</>
	);
}

const n = (v: number) => intl.formatNumber(v);

function Summary({ data }: { data: CrowdsecOverview }) {
	const items: [string, React.ReactNode, string?][] = [
		[
			"nginxions.crowdsec.summary.lapi",
			<T key="lapi" id={data.lapi.healthy ? "nginxions.crowdsec.lapi.ok" : "nginxions.crowdsec.lapi.down"} />,
			data.lapi.healthy ? "text-green" : "text-red",
		],
		["nginxions.crowdsec.summary.decisions", n(data.decisions.total)],
		["nginxions.crowdsec.summary.alerts", n(data.alerts24h)],
		["nginxions.crowdsec.summary.machines", n(data.machines.length)],
		["nginxions.crowdsec.summary.bouncers", n(data.bouncers.length)],
		[
			"nginxions.crowdsec.summary.hub",
			data.hub.outdated ? `${n(data.hub.installed)} / ${n(data.hub.outdated)}` : n(data.hub.installed),
			data.hub.outdated ? "text-yellow" : undefined,
		],
	];
	return (
		<div className={styles.summary}>
			{items.map(([label, value, tone]) => (
				<div className={cn("card", styles.stat)} key={label}>
					<div className={cn(styles.statValue, tone)}>{value}</div>
					<div className={styles.statLabel}>
						<T id={label} />
					</div>
				</div>
			))}
		</div>
	);
}

function Status({ on, label }: { on: boolean; label: string }) {
	return (
		<li className={styles.item}>
			<span className={cn("badge", on ? "bg-green-lt" : "bg-secondary-lt")}>
				<T id={on ? "enabled" : "disabled"} />
			</span>
			<span>
				<T id={label} />
			</span>
		</li>
	);
}

function OverviewTab({ data, go }: { data: CrowdsecOverview; go: (tab: Tab) => void }) {
	const m = data.metrics;
	const s = data.settings;
	return (
		<>
			<Summary data={data} />
			<div className={crowdsecStyles.metricsGrid}>
				<MetricsPanel kind="sources" rows={m?.linesRead} />
				<MetricsPanel kind="overflows" rows={m?.overflows} />
			</div>
			<div className="row g-3">
				<div className="col-lg-6">
					<section className={cn("card h-100", styles.card)}>
						<h3 className="card-title">
							<T id="nginxions.crowdsec.protection" />
						</h3>
						<ul className={styles.list}>
							<Status on={s.bouncer} label="nginxions.crowdsec.protection.bouncer" />
							<Status on={s.sources.nginx} label="nginxions.crowdsec.protection.nginx" />
							<Status on={s.sources.openappsec} label="nginxions.crowdsec.protection.openappsec" />
							<li className={styles.item}>
								<span
									className={cn("badge", s.openappsecBan.enabled ? "bg-green-lt" : "bg-secondary-lt")}
								>
									<T id={s.openappsecBan.enabled ? "enabled" : "disabled"} />
								</span>
								<span>
									<T
										id="nginxions.crowdsec.protection.openappsec-ban"
										data={{ events: s.openappsecBan.events, minutes: s.openappsecBan.minutes }}
									/>
								</span>
							</li>
							<Status on={s.appsec} label="nginxions.crowdsec.protection.appsec" />
						</ul>
						<button
							type="button"
							className="btn btn-sm mt-3 align-self-start"
							onClick={() => go("settings")}
						>
							<T id="nginxions.crowdsec.open-settings" />
						</button>
					</section>
				</div>
				<div className="col-lg-6">
					<section className={cn("card h-100", styles.card)}>
						<h3 className="card-title">
							<T id="nginxions.crowdsec.activity" />
						</h3>
						{m ? (
							<ul className={styles.list}>
								<li className={cn(styles.item, "justify-content-between")}>
									<T id="nginxions.crowdsec.metrics.parsed" />
									<span>
										{n(m.linesParsed)} / {n(m.linesParsed + m.linesUnparsed)}
									</span>
								</li>
								{s.appsec && (
									<li className={cn(styles.item, "justify-content-between")}>
										<T id="nginxions.crowdsec.metrics.appsec" />
										<span>
											{n(m.appsecBlocked)} / {n(m.appsecRequests)}
										</span>
									</li>
								)}
								{Object.entries(data.decisions.byOrigin).map(([origin, count]) => (
									<li className={cn(styles.item, "justify-content-between")} key={origin}>
										<span>
											<T
												id="nginxions.crowdsec.metrics.decisions-of"
												data={{ origin: originLabel(origin) }}
											/>
										</span>
										<span>{n(count)}</span>
									</li>
								))}
								<li className={cn(styles.item, "justify-content-between")}>
									<T id="nginxions.crowdsec.version" />
									<span className="font-monospace">{m.version || "—"}</span>
								</li>
							</ul>
						) : (
							<p className={styles.empty}>
								<T id="nginxions.crowdsec.metrics.none" />
							</p>
						)}
					</section>
				</div>
			</div>
		</>
	);
}

function CrowdsecPage({ place }: { place: Place }) {
	const can = useCan();
	const queryClient = useQueryClient();
	const [params, setParams] = useSearchParams();
	const navigate = useNavigate();
	const tabs: readonly Tab[] = place === "agent" ? AGENT_TABS : BLOCK_TABS;
	// links of before: the open-appsec tab of Blocks is part of "triggers"
	const askedTab = params.get("tab") === "openappsec" ? "triggers" : params.get("tab");
	const asked = TABS.find((x) => x === askedTab);
	const tab = (asked && tabs.includes(asked) ? asked : tabs[0]) as Tab;
	const tabList = useRef<HTMLUListElement>(null);
	const activeTab = useRef<HTMLButtonElement>(null);
	// a tab of the other place (links of before) opens there
	const go = (x: Tab) => {
		if (tabs.includes(x)) setParams(x === tabs[0] ? {} : { tab: x }, { replace: true });
		else navigate(`${place === "agent" ? "/analytics/blocks" : "/crowdsec"}?tab=${x}`);
	};
	// a node of this manager instead of this server (Agents → CrowdSec only)
	const [nodeId, setNodeId] = useState(0);
	const overview = useCrowdsec({ refetchInterval: 30000 });
	const settings = useCrowdsecSettings();
	const tabsVisible = !!overview.data && !nodeId && (!asked || tabs.includes(asked));
	useLayoutEffect(() => {
		const list = tabList.current;
		const active = activeTab.current;
		if (!tab || !tabsVisible || !list || !active || list.scrollWidth <= list.clientWidth) return;
		const bounds = list.getBoundingClientRect();
		const target = active.getBoundingClientRect();
		if (target.left < bounds.left) list.scrollLeft += target.left - bounds.left;
		else if (target.right > bounds.right) list.scrollLeft += target.right - bounds.right;
	}, [tab, tabsVisible]);
	const refresh = () => {
		for (const key of [
			"nginxions-crowdsec",
			"nginxions-crowdsec-settings",
			"nginxions-crowdsec-decisions",
			"nginxions-crowdsec-alerts",
			"nginxions-crowdsec-hosts",
			"nginxions-blocks-triggers",
		])
			queryClient.invalidateQueries({ queryKey: [key] });
	};

	if (asked && !tabs.includes(asked)) {
		return (
			<Navigate to={`${place === "agent" ? "/analytics/blocks" : "/crowdsec"}?${params.toString()}`} replace />
		);
	}
	if (overview.isLoading) return <LoadingPage noLogo />;
	if (overview.isError || !overview.data)
		return <Alert variant="danger">{overview.error?.message || <T id="nginxions.common.unknown-error" />}</Alert>;
	const data = overview.data;

	return (
		<div className={hostStyles.page}>
			<div className={hostStyles.head}>
				<div>
					<h1 className={hostStyles.title}>
						<T id={place === "agent" ? "nginxions.crowdsec" : "nginxions.nav.blocks"} />
					</h1>
					<p className={hostStyles.subtitle}>
						<T
							id={
								place === "agent"
									? "nginxions.crowdsec.agent.description"
									: "nginxions.blocks.description"
							}
						/>
					</p>
				</div>
				<div className={hostStyles.toolbar}>
					{place === "agent" && <NodePicker value={nodeId} onChange={setNodeId} />}
					{can("crowdsec", "decide") && !nodeId && (
						<button
							type="button"
							className={cn("btn btn-primary btn-sm", hostStyles.add)}
							onClick={() => showBanModal({ onDone: refresh })}
						>
							<T id="nginxions.crowdsec.ban.title" />
						</button>
					)}
				</div>
			</div>

			{nodeId ? (
				<NodeServiceView nodeId={nodeId} service="crowdsec" />
			) : (
				<>
					{!data.lapi.healthy && (
						<Alert variant="danger" className="mb-0">
							<T id="nginxions.crowdsec.lapi.down.text" data={{ error: data.lapi.error }} />{" "}
							<Link to="/system/services">
								<T id="nginxions.crowdsec.open-services" />
							</Link>
						</Alert>
					)}
					{data.pending.length > 0 && can("crowdsec", "manage") && (
						<Alert variant="warning" className="mb-0 d-flex align-items-center gap-3">
							<span>
								<T id="nginxions.crowdsec.settings.pending" data={{ files: data.pending.join(", ") }} />
							</span>
							<button
								type="button"
								className="btn btn-sm ms-auto"
								onClick={async () => {
									try {
										await applySettings();
										showSuccess(t("nginxions.crowdsec.settings.applied"));
									} catch (err: any) {
										showError(err.message);
									}
									refresh();
								}}
							>
								<T id="nginxions.crowdsec.apply" />
							</button>
						</Alert>
					)}

					<ul ref={tabList} className={cn("nav nav-tabs", crowdsecStyles.tabs)}>
						{tabs.map((x) => (
							<li className="nav-item" key={x}>
								<button
									type="button"
									ref={tab === x ? activeTab : undefined}
									className={cn("nav-link text-nowrap", { active: tab === x })}
									aria-pressed={tab === x}
									onClick={() => go(x)}
								>
									<T id={`nginxions.crowdsec.tab.${x}`} />
								</button>
							</li>
						))}
					</ul>

					{tab === "overview" && <OverviewTab data={data} go={go} />}
					{tab === "decisions" && <DecisionsTab refresh={refresh} />}
					{tab === "alerts" && <AlertsTab initialQuery={params.get("q") ?? ""} refresh={refresh} />}
					{tab === "triggers" && <AgentTriggersTab refresh={refresh} />}
					{tab === "blocklists" && (
						<BlocklistsTab shareEnabled={!!settings.data?.shareEnabled} refresh={refresh} />
					)}
					{tab === "hub" && <HubTab onlineHub={!!settings.data?.onlineHub} refresh={refresh} />}
					{tab === "settings" &&
						(settings.isLoading ? (
							<LoadingPage noLogo />
						) : settings.data ? (
							<SettingsView data={settings.data} refresh={refresh} manage={can("crowdsec", "manage")} />
						) : (
							<Alert variant="danger">
								{settings.error?.message || <T id="nginxions.common.unknown-error" />}
							</Alert>
						))}
					{tab === "registry" && <RegistryTab />}
				</>
			)}
		</div>
	);
}

const Crowdsec = () => (
	<HasPermission rbac="crowdsec" permission={VIEW} pageLoading loadingNoLogo>
		<CrowdsecPage place="agent" />
	</HasPermission>
);

/** Analytics → Blocks: bans (decisions of CrowdSec), what the agents refused, blocklists */
export const Blocks = () => (
	<HasPermission rbac="crowdsec" permission={VIEW} pageLoading loadingNoLogo>
		<CrowdsecPage place="blocks" />
	</HasPermission>
);

export default Crowdsec;
