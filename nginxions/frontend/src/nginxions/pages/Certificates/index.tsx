// Certificates: the whole section on one page, like Hosts. A summary; the hosts protected by mTLS; one table of
// every certificate (TLS of the hosts from ACME or uploaded, certificates issued by the PKI with the access
// certificates of mTLS, files on disk no record describes) with pages from the server, search, the soonest expiry
// first, filters by source, status, type and use, bulk revocation; then the CAs and the ACME servers, each a block
// of its own; the settings (PKI, templates, renewal) in a window. ?cert=12 opens a certificate of the PKI,
// ?section=cas|acme|mtls scrolls to a block (the old pages /pki, /mtls and /certificates/acme lead here).
import {
	IconChevronLeft,
	IconChevronRight,
	IconDots,
	IconFilter,
	IconPlus,
	IconSettings,
	IconSortDescending,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import cn from "classnames";
import { type ReactNode, useEffect, useState } from "react";
import Alert from "react-bootstrap/Alert";
import { useSearchParams } from "react-router-dom";
import { deleteCertificate, downloadCertificate, getCertificate } from "src/api/backend";
import { HasPermission, LoadingPage } from "src/components";
import { useUser } from "src/hooks";
import { intl, T } from "src/locale";
import {
	showCustomCertificateModal,
	showDeleteConfirmModal,
	showReachabilityModal,
	showRenewCertificateModal,
} from "src/modals";
import { CERTIFICATES, hasPermission, MANAGE, VIEW } from "src/modules/Permissions";
import { showError, showObjectSuccess, showSuccess } from "src/notifications";
import { AcmeServers, showAcmeServerModal } from "../../acme/AcmeServers";
import { useAcmeServers } from "../../acme/api";
import type { CertSource, CertStatus, EventQuery, RegistryCert } from "../../api";
import { showAcmeCertificateModal } from "../../certs/AcmeCertificateModal";
import { showAcmeLogModal } from "../../certs/AcmeLog";
import { useCertificateRegistry } from "../../hooks";
import { showConfirmModal } from "../../modals/ConfirmModal";
import { showAccessModal } from "../../pki/AccessModal";
import { deleteCerts, formatShort, type PkiOverview, usePki } from "../../pki/api";
import { showCaModal } from "../../pki/CaModal";
import { showCertModal } from "../../pki/CertModal";
import { showIssueModal } from "../../pki/IssueModal";
import { HostsCard, ProtectHost } from "../../pki/MtlsHosts";
import pkiStyles from "../../pki/Pki.module.css";
import { showRevokeModal } from "../../pki/RevokeModal";
import { CasTab } from "../../pki/Sections";
import { showCertSettingsModal } from "../../pki/SettingsModal";
import { useCan } from "../../rbac/hooks";
import { Dropdown, type DropdownItem } from "../../ui/Dropdown";
import { Popover } from "../../ui/Popover";
import { SearchField } from "../../ui/SearchField";
import hostStyles from "../Hosts/Hosts.module.css";
import styles from "../WafEvents/Events.module.css";
import own from "./Certificates.module.css";

const t = (id: string, values?: Record<string, any>) => intl.formatMessage({ id }, values);
const PAGE_SIZE = 25;
// the CAs are a block of their own below the table
const SOURCES: CertSource[] = ["tls", "pki", "file"];
const STATUSES: CertStatus[] = ["expiring", "expired", "revoked"];
const SORTS = ["expires", "-expires", "name", "-created"] as const;
const DAY = 86400000;

const STATUS_TONE: Record<CertStatus, string> = {
	valid: "bg-green-lt",
	expiring: "bg-yellow-lt",
	expired: "bg-red-lt",
	revoked: "bg-red-lt",
};

/** what the certificate is, in the words of the interface */
const kindLabel = (c: Pick<RegistryCert, "source" | "kind" | "dnsProvider" | "acmeServer">) => {
	const ids: Record<string, string> = {
		"tls:letsencrypt": "lets-encrypt",
		"tls:other": "certificates.custom",
		"ca:root": "nginxions.certs.kind.root",
		"ca:intermediate": "nginxions.certs.kind.intermediate",
		"ca:external": "nginxions.certs.kind.external",
		"pki:client": "nginxions.pki.profile.client",
		"pki:server": "nginxions.pki.profile.server",
		"file:ca": "nginxions.certs.kind.file-ca",
		"file:file": "nginxions.certs.kind.file",
		"file:dummy": "nginxions.certs.kind.dummy",
	};
	const id = ids[`${c.source}:${c.kind}`];
	const kind = id ? t(id) : c.kind;
	// ACME: which server (and so which CA) issued it
	const name = c.acmeServer ? `${kind} · ${c.acmeServer}` : kind;
	return c.dnsProvider ? `${name} – ${c.dnsProvider}` : name;
};

/** a type of the filter: the kinds of different sources have different names */
const kindName = (kind: string) =>
	SOURCES.map((source) => kindLabel({ source, kind })).find((label) => label !== kind) ?? kind;

function Expiry({ value, status }: { value: string | null; status: CertStatus }) {
	if (!value) return <span className="text-secondary">—</span>;
	const days = Math.floor((new Date(value).getTime() - Date.now()) / DAY);
	return (
		<>
			<div>{formatShort(value, intl.locale)}</div>
			<div className={cn(own.left, (status === "expiring" || status === "expired") && own[status])}>
				{days < 0 ? (
					<T id="nginxions.certs.expired-ago" data={{ days: -days }} />
				) : (
					<T id="nginxions.certs.days-left" data={{ days }} />
				)}
			</div>
		</>
	);
}

function UsedBy({ cert }: { cert: RegistryCert }) {
	if (!cert.usedBy.length) return <span className="text-secondary">—</span>;
	if (cert.usedBy[0].type === "default") return <T id="nginxions.certs.default-server" />;
	const [first, ...rest] = cert.usedBy;
	return (
		<span title={cert.usedBy.map((u) => u.name).join("\n")}>
			{first.name}
			{rest.length > 0 && <span className="text-secondary"> +{rest.length}</span>}
		</span>
	);
}

/** a tile of the summary */
function Stat({ value, label, tone }: { value: number; label: ReactNode; tone?: string }) {
	return (
		<div className={cn("card", pkiStyles.stat)}>
			<div className={cn(pkiStyles.statValue, tone)}>{value}</div>
			<div className={pkiStyles.statLabel}>{label}</div>
		</div>
	);
}

/** a block of the page with its title and buttons */
function Block({
	id,
	title,
	hint,
	extra,
	children,
}: {
	id: string;
	title: ReactNode;
	hint?: ReactNode;
	extra?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section id={id} className={own.block}>
			<div className={own.blockHead}>
				<div>
					<h2 className={own.blockTitle}>{title}</h2>
					{hint && <p className={own.blockHint}>{hint}</p>}
				</div>
				{extra && <div className={hostStyles.toolbar}>{extra}</div>}
			</div>
			{children}
		</section>
	);
}

function CertificatesPage() {
	const [params, setParams] = useSearchParams();
	const queryClient = useQueryClient();
	const { data: me } = useUser("me");
	const can = useCan();
	const canManageTls = hasPermission(CERTIFICATES, MANAGE, me?.permissions, me?.roles);
	const canTls = hasPermission(CERTIFICATES, VIEW, me?.permissions, me?.roles);
	const canPki = can("pki", "view");
	const pki = usePki({ enabled: canPki, refetchInterval: 30000 });
	const pkiData: PkiOverview | undefined = canPki ? pki.data : undefined;
	const acme = useAcmeServers();
	const [selected, setSelected] = useState<number[]>([]);
	const refresh = () => {
		queryClient.invalidateQueries({ queryKey: ["nginxions-pki"] });
		queryClient.invalidateQueries({ queryKey: ["nginxions-mtls-hosts"] });
		queryClient.invalidateQueries({ queryKey: ["certificates"] });
		queryClient.invalidateQueries({ queryKey: ["nginxions-acme-servers"] });
	};
	const source = (SOURCES as string[]).includes(params.get("source") || "")
		? (params.get("source") as CertSource)
		: "";
	const status = (STATUSES as string[]).includes(params.get("status") || "")
		? (params.get("status") as CertStatus)
		: "";
	const kinds = (params.get("kind") || "").split(",").filter(Boolean);
	const used = params.get("used") === "yes" || params.get("used") === "no" ? params.get("used") || "" : "";
	const sort = (SORTS as readonly string[]).includes(params.get("sort") || "") ? params.get("sort") || "" : "expires";
	const q = params.get("q") || "";
	const page = Math.max(Number.parseInt(params.get("page") || "0", 10) || 0, 0);
	const [search, setSearch] = useState(q);

	const update = (changes: Record<string, string>) => {
		const next = new URLSearchParams(params);
		for (const [key, value] of Object.entries(changes)) {
			if (value) next.set(key, value);
			else next.delete(key);
		}
		if (!("page" in changes)) next.delete("page");
		// the types belong to a source
		if ("source" in changes) next.delete("kind");
		setParams(next, { replace: true });
	};

	useEffect(() => setSearch(q), [q]);
	// ?cert=12: a certificate of the PKI opens (links of notifications, of the hosts, of the old mTLS page)
	const certParam = Number(params.get("cert")) || 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per ?cert
	useEffect(() => {
		if (!certParam) return;
		showCertModal({ certId: certParam, openHost: (h) => update({ q: h.name, source: "pki" }) });
		const next = new URLSearchParams(params);
		next.delete("cert");
		setParams(next, { replace: true });
	}, [certParam]);
	// ?section=cas|acme|mtls: the block of the old page that was asked for
	const sectionParam = params.get("section") || "";
	// biome-ignore lint/correctness/useExhaustiveDependencies: once the blocks are drawn
	useEffect(() => {
		if (!sectionParam || (canPki && !pkiData)) return;
		if (sectionParam === "settings") showCertSettingsModal({ refresh });
		else document.getElementById(`certs-${sectionParam}`)?.scrollIntoView({ block: "start" });
	}, [sectionParam, pkiData]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the typed text changes
	useEffect(() => {
		if (search === q) return;
		const timer = setTimeout(() => update({ q: search }), 300);
		return () => clearTimeout(timer);
	}, [search]);

	const query: EventQuery = {
		source: source || SOURCES.join(","),
		status: status || undefined,
		kind: kinds.join(",") || undefined,
		used: used || undefined,
		q: q || undefined,
		sort,
		limit: PAGE_SIZE,
		offset: page * PAGE_SIZE,
	};
	const { data, isLoading, isError, error, isFetching } = useCertificateRegistry(query);
	const pages = data ? Math.max(Math.ceil(data.total / PAGE_SIZE), 1) : 1;
	const filterCount = kinds.length + (used ? 1 : 0);
	const allCount = data ? SOURCES.reduce((a, s) => a + (data.counts.source[s] || 0), 0) : 0;
	const anyStatusCount = data ? Object.values(data.counts.status).reduce((a, b) => a + (b || 0), 0) : 0;

	const remove = (id: number) =>
		showDeleteConfirmModal({
			title: <T id="object.delete" tData={{ object: "certificate" }} />,
			onConfirm: async () => {
				await deleteCertificate(id);
				showObjectSuccess("certificate", "deleted");
			},
			invalidations: [["certificates"], ["certificate", id]],
			children: <T id="object.delete.content" tData={{ object: "certificate" }} />,
		});

	const edit = async (id: number) => {
		try {
			showCustomCertificateModal(await getCertificate(id));
		} catch (err: any) {
			showError(err.message);
		}
	};

	const actions = (c: RegistryCert): DropdownItem[] => {
		const items: DropdownItem[] = [];
		if (c.source === "tls" && typeof c.id === "number") {
			const id = c.id;
			if (c.pkiId) {
				const pkiId = c.pkiId;
				items.push({
					key: "pki",
					label: <T id="nginxions.certs.open-pki" />,
					onSelect: () => showCertModal({ certId: pkiId }),
				});
			}
			if (c.kind === "letsencrypt" && !c.dnsProvider) {
				items.push({ key: "test", label: <T id="test" />, onSelect: () => showReachabilityModal(c.subjects) });
			}
			if (canManageTls) {
				if (c.kind === "letsencrypt") {
					items.push(
						{ key: "renew", label: <T id="action.renew" />, onSelect: () => showRenewCertificateModal(id) },
						{
							key: "download",
							label: <T id="action.download" />,
							onSelect: () => downloadCertificate(id).catch((err) => showError(err.message)),
						},
					);
				}
				if (c.kind === "other") {
					items.push({ key: "edit", label: <T id="action.edit" />, onSelect: () => edit(id) });
				}
				if (!c.usedBy.length) {
					items.push({
						key: "delete",
						divider: true,
						label: <T id="action.delete" />,
						onSelect: () => remove(id),
					});
				}
			}
		}
		if (c.source === "pki" && typeof c.id === "number") {
			const id = c.id;
			items.push({
				key: "open",
				label: <T id="nginxions.certs.details" />,
				onSelect: () => showCertModal({ certId: id }),
			});
			const cert = pkiData?.certificates.find((x) => x.id === id);
			if (cert && !cert.revokedOn && can("pki", "revoke")) {
				items.push({
					key: "revoke",
					divider: true,
					label: <T id="nginxions.pki.revoke" />,
					onSelect: () => showRevokeModal({ certs: [cert], onDone: refresh }),
				});
			}
		}
		if (c.source === "file" && c.path) {
			const path = c.path;
			items.push({
				key: "copy",
				label: <T id="nginxions.certs.copy-path" />,
				onSelect: () => navigator.clipboard?.writeText(path),
			});
		}
		return items;
	};

	const addItems: DropdownItem[] = [
		...(canManageTls
			? [
					{
						// one form for every ACME server; your own CSR is reached from it
						key: "acme",
						label: <T id="nginxions.acme.menu" />,
						onSelect: showAcmeCertificateModal,
					},
					{
						key: "custom",
						label: <T id="certificates.custom" />,
						onSelect: () => showCustomCertificateModal(),
					},
					{
						key: "mtls-file",
						label: <T id="nginxions.certificates.mtls" />,
						onSelect: () => showCustomCertificateModal(undefined, "mtls"),
					},
				]
			: []),
		...(pkiData &&
		can("pki", "issue") &&
		pkiData.cas.some((ca) => ca.kind === "intermediate" && ca.hasKey && !ca.revokedOn)
			? [
					{
						key: "issue",
						divider: canManageTls,
						label: <T id="nginxions.pki.issue" />,
						onSelect: () => showIssueModal({ data: pkiData, onDone: refresh }),
					},
				]
			: []),
		...(pkiData && can("pki", "issue") && pkiData.protected.length
			? [
					{
						key: "access",
						label: <T id="nginxions.mtls.access.issue" />,
						onSelect: () => showAccessModal({ data: pkiData, onDone: refresh }),
					},
				]
			: []),
		...(pkiData && can("pki", "manage")
			? [
					{
						key: "ca",
						divider: true,
						label: <T id="nginxions.pki.ca.add" />,
						onSelect: () => showCaModal({ data: pkiData, onDone: refresh }),
					},
				]
			: []),
		...(can("settings", "manage") && acme.data
			? [
					{
						key: "acme-server",
						divider: !(pkiData && can("pki", "manage")),
						label: <T id="nginxions.acme.servers.add" />,
						onSelect: () => showAcmeServerModal(acme.data?.presets ?? [], refresh),
					},
				]
			: []),
		...(canManageTls
			? [
					{
						key: "acme-log",
						divider: true,
						label: <T id="nginxions.acme.log.open" />,
						onSelect: showAcmeLogModal,
					},
				]
			: []),
	];

	// bulk actions on the selected certificates of the PKI (revoke, delete)
	const selectedCerts = (pkiData?.certificates ?? []).filter((c) => selected.includes(c.id));
	const toggle = (id: number) =>
		setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
	const removeSelected = () =>
		showConfirmModal({
			tTitle: "nginxions.mtls.delete",
			tConfirm: "nginxions.mtls.delete",
			danger: true,
			onConfirm: async () => {
				const r = await deleteCerts(selectedCerts.map((c) => c.id));
				showSuccess(t("nginxions.mtls.deleted", { count: r.deleted }));
				setSelected([]);
				refresh();
			},
			children: (
				<>
					<T id="nginxions.mtls.delete.text" data={{ count: selectedCerts.length }} />
					<div className="small font-monospace text-secondary mt-2">
						{selectedCerts
							.slice(0, 20)
							.map((c) => c.commonName)
							.join(", ")}
					</div>
				</>
			),
		});

	const segment = (active: boolean, onClick: () => void, label: React.ReactNode, n?: number, key?: string) => (
		<button
			key={key}
			type="button"
			className={cn(styles.period, active && styles.periodOn)}
			aria-pressed={active}
			onClick={onClick}
		>
			{label}
			{n !== undefined && <span className={own.n}>{n}</span>}
		</button>
	);

	return (
		<div className={hostStyles.page}>
			<div className={hostStyles.head}>
				<div>
					<h1 className={hostStyles.title}>
						<T id="certificates" />
					</h1>
					<p className={hostStyles.subtitle}>
						<T id="nginxions.certs.description" />
					</p>
				</div>
				<div className={hostStyles.toolbar}>
					{(canPki || can("settings", "view")) && (
						<button
							type="button"
							className={hostStyles.tool}
							onClick={() => showCertSettingsModal({ refresh })}
						>
							<IconSettings size={16} />
							<span className={hostStyles.toolText}>
								<T id="nginxions.certs.settings" />
							</span>
						</button>
					)}
					{addItems.length > 0 && (
						<Dropdown
							floating
							inline
							ariaLabel={t("nginxions.certs.add")}
							triggerClassName={cn("btn btn-primary btn-sm", hostStyles.add)}
							trigger={
								<>
									<IconPlus size={16} />
									<T id="nginxions.certs.add" />
								</>
							}
							items={addItems}
						/>
					)}
				</div>
			</div>

			<div className={pkiStyles.summary}>
				<Stat
					value={allCount - (data?.counts.status.expired ?? 0) - (data?.counts.status.revoked ?? 0)}
					label={<T id="nginxions.certs.stat.valid" />}
				/>
				<Stat
					value={data?.counts.status.expiring ?? 0}
					label={<T id="nginxions.certs.stat.expiring" />}
					tone={data?.counts.status.expiring ? "text-warning" : undefined}
				/>
				<Stat
					value={(data?.counts.status.expired ?? 0) + (data?.counts.status.revoked ?? 0)}
					label={<T id="nginxions.certs.stat.ended" />}
				/>
				{pkiData && <Stat value={pkiData.protected.length} label={<T id="nginxions.certs.stat.mtls" />} />}
				{pkiData && <Stat value={pkiData.cas.length} label={<T id="nginxions.certs.stat.cas" />} />}
				{canTls && <Stat value={acme.data?.items.length ?? 0} label={<T id="nginxions.certs.stat.acme" />} />}
			</div>

			{pkiData && (
				<div id="certs-mtls">
					<HostsCard
						data={pkiData}
						certs={pkiData.certificates.filter((c) => c.profile === "client")}
						refresh={refresh}
						filter={(h) => update({ q: h.name, source: "pki" })}
						extra={<ProtectHost data={pkiData} refresh={refresh} />}
					/>
				</div>
			)}

			<div className={hostStyles.toolbar}>
				<SearchField value={search} onChange={setSearch} placeholder={t("nginxions.certs.search")} />
				<div className={styles.periods} role="group" aria-label={t("nginxions.certs.status")}>
					{segment(
						!status,
						() => update({ status: "" }),
						<T id="nginxions.certs.status.any" />,
						anyStatusCount,
					)}
					{STATUSES.map((s) =>
						segment(
							status === s,
							() => update({ status: status === s ? "" : s }),
							<T id={`nginxions.certs.status.${s}`} />,
							data?.counts.status[s] ?? 0,
							s,
						),
					)}
				</div>
				<Popover
					ariaLabel={t("nginxions.events.filters")}
					title={<T id="nginxions.events.filters" />}
					titleAction={
						filterCount > 0 ? (
							<button
								type="button"
								className={hostStyles.reset}
								onClick={() => update({ kind: "", used: "" })}
							>
								<T id="nginxions.events.filters.reset" />
							</button>
						) : undefined
					}
					width="22rem"
					triggerClassName={hostStyles.tool}
					activeClassName={hostStyles.toolOn}
					trigger={
						<>
							<IconFilter size={16} />
							<span className={hostStyles.toolText}>
								<T id="nginxions.events.filters" />
							</span>
							{filterCount > 0 && <span className={hostStyles.count}>{filterCount}</span>}
						</>
					}
				>
					{() => (
						<div>
							<div className={styles.section}>
								<div className={styles.sectionTitle}>
									<T id="nginxions.certs.kind" />
								</div>
								<div className={styles.options}>
									{(data?.kinds ?? []).map((k) => (
										<label key={k}>
											<input
												type="checkbox"
												className="form-check-input m-0"
												checked={kinds.includes(k)}
												onChange={() =>
													update({
														kind: (kinds.includes(k)
															? kinds.filter((x) => x !== k)
															: [...kinds, k]
														).join(","),
													})
												}
											/>
											{kindName(k)}
										</label>
									))}
								</div>
							</div>
							<div className={styles.section}>
								<div className={styles.sectionTitle}>
									<T id="nginxions.certs.used" />
								</div>
								<div className={styles.options}>
									{(["", "yes", "no"] as const).map((u) => (
										<label key={u || "any"}>
											<input
												type="radio"
												name="nginxions-certs-used"
												className="form-check-input m-0"
												checked={used === u}
												onChange={() => update({ used: u })}
											/>
											<T id={`nginxions.certs.used.${u || "any"}`} />
										</label>
									))}
								</div>
							</div>
						</div>
					)}
				</Popover>
			</div>

			<div className={cn("card", hostStyles.tableCard)}>
				<div className={hostStyles.summary}>
					<div className={styles.kinds}>
						{segment(
							!source,
							() => update({ source: "" }),
							<T id="nginxions.certs.source.all" />,
							allCount,
						)}
						{SOURCES.filter((s) => s !== "file" || data?.counts.source.file).map((s) =>
							segment(
								source === s,
								() => update({ source: source === s ? "" : s }),
								<T id={`nginxions.certs.source.${s}`} />,
								data?.counts.source[s] ?? 0,
								s,
							),
						)}
					</div>
					{isFetching && <span className="spinner-border spinner-border-sm text-secondary" />}
					{selectedCerts.length > 0 && (
						<div className={own.bulk}>
							<span className={own.bulkCount}>
								<T id="nginxions.certs.selected" data={{ count: selectedCerts.length }} />
							</span>
							{can("pki", "revoke") && selectedCerts.some((c) => !c.revokedOn) && (
								<button
									type="button"
									className={hostStyles.tool}
									onClick={() =>
										showRevokeModal({
											certs: selectedCerts.filter((c) => !c.revokedOn),
											onDone: () => {
												setSelected([]);
												refresh();
											},
										})
									}
								>
									<T id="nginxions.pki.revoke" />
								</button>
							)}
							{can("pki", "issue") && (
								<button type="button" className={hostStyles.tool} onClick={removeSelected}>
									<T id="action.delete" />
								</button>
							)}
							<button type="button" className={hostStyles.tool} onClick={() => setSelected([])}>
								<T id="cancel" />
							</button>
						</div>
					)}
					<Dropdown
						floating
						inline
						ariaLabel={t("nginxions.certs.sort")}
						title={t("nginxions.certs.sort")}
						triggerClassName={hostStyles.tool}
						trigger={
							<>
								<IconSortDescending size={16} />
								<span className={hostStyles.toolText}>
									<T id={`nginxions.certs.sort.${sort}`} />
								</span>
							</>
						}
						items={SORTS.map((s) => ({
							key: s,
							active: sort === s,
							label: <T id={`nginxions.certs.sort.${s}`} />,
							onSelect: () => update({ sort: s === "expires" ? "" : s }),
						}))}
					/>
				</div>
				{isLoading ? (
					<LoadingPage noLogo />
				) : isError || !data ? (
					<div className="card-body">
						<Alert variant="danger" className="mb-0">
							{error?.message || <T id="nginxions.common.unknown-error" />}
						</Alert>
					</div>
				) : (
					<>
						{source === "file" && (
							<div className={own.note}>
								<T id="nginxions.certs.files-hint" />
							</div>
						)}
						<div className={hostStyles.scroller}>
							<table className={cn("table table-vcenter card-table nx-stack", hostStyles.table)}>
								<thead>
									<tr>
										{canPki && <th className="w-1" />}
										<th>
											<T id="nginxions.certs.name" />
										</th>
										<th>
											<T id="nginxions.certs.kind" />
										</th>
										<th className="nx-optional">
											<T id="nginxions.certs.issuer" />
										</th>
										<th>
											<T id="nginxions.certs.expires" />
										</th>
										<th className="nx-optional">
											<T id="nginxions.certs.used-by" />
										</th>
										<th />
									</tr>
								</thead>
								<tbody>
									{data.items.length === 0 ? (
										<tr>
											<td colSpan={canPki ? 7 : 6} className={hostStyles.empty}>
												<T id="nginxions.certs.empty" />
											</td>
										</tr>
									) : (
										data.items.map((c) => {
											const items = actions(c);
											return (
												<tr key={c.key}>
													{canPki && (
														<td className="nx-check">
															{c.source === "pki" && typeof c.id === "number" && (
																<input
																	type="checkbox"
																	className="form-check-input"
																	aria-label={c.name}
																	checked={selected.includes(c.id)}
																	onChange={() => toggle(c.id as number)}
																/>
															)}
														</td>
													)}
													<td className={cn(own.name, "nx-title")}>
														<div className={own.title}>
															<span>{c.name || "—"}</span>
															{c.status !== "valid" && (
																<span className={cn("badge", STATUS_TONE[c.status])}>
																	<T id={`nginxions.certs.badge.${c.status}`} />
																</span>
															)}
														</div>
														{c.path ? (
															<div className={own.sub}>{c.path}</div>
														) : c.subjects.filter((s) => s !== c.name).length > 0 ? (
															<div className={own.sub}>
																{c.subjects.slice(0, 3).join(", ")}
																{c.subjects.length > 3 && ` +${c.subjects.length - 3}`}
															</div>
														) : null}
													</td>
													<td data-label={t("nginxions.certs.kind")}>
														<div>{kindLabel(c)}</div>
														<div className={own.sub}>
															<T id={`nginxions.certs.source.${c.source}`} />
														</div>
													</td>
													<td
														className="nx-optional"
														data-label={t("nginxions.certs.issuer")}
													>
														{c.issuer || <span className="text-secondary">—</span>}
													</td>
													<td data-label={t("nginxions.certs.expires")}>
														<Expiry value={c.notAfter} status={c.status} />
													</td>
													<td
														className={cn(own.used, "nx-optional")}
														data-label={t("nginxions.certs.used-by")}
													>
														<UsedBy cert={c} />
													</td>
													<td className="text-end nx-actions">
														{items.length > 0 && (
															<Dropdown
																floating
																inline
																ariaLabel={t("nginxions.pki.actions")}
																triggerClassName="btn btn-sm btn-ghost-secondary"
																trigger={<IconDots size={16} />}
																items={items}
															/>
														)}
													</td>
												</tr>
											);
										})
									)}
								</tbody>
							</table>
						</div>
						<div className={styles.pager}>
							<span>
								<T id="nginxions.certs.total" data={{ total: data.total }} />
							</span>
							<div className={styles.pagerButtons}>
								<span>
									<T id="nginxions.audit.page" data={{ page: page + 1, pages }} />
								</span>
								<button
									type="button"
									className={hostStyles.tool}
									disabled={page === 0}
									aria-label={t("nginxions.certs.prev")}
									onClick={() => update({ page: page > 1 ? String(page - 1) : "" })}
								>
									<IconChevronLeft size={16} />
								</button>
								<button
									type="button"
									className={hostStyles.tool}
									disabled={page + 1 >= pages}
									aria-label={t("nginxions.certs.next")}
									onClick={() => update({ page: String(page + 1) })}
								>
									<IconChevronRight size={16} />
								</button>
							</div>
						</div>
					</>
				)}
			</div>

			{pkiData && (
				<Block
					id="certs-cas"
					title={<T id="nginxions.certs.block.cas" />}
					extra={
						can("pki", "manage") && (
							<button
								type="button"
								className={hostStyles.tool}
								onClick={() => showCaModal({ data: pkiData, onDone: refresh })}
							>
								<IconPlus size={16} />
								<span className={hostStyles.toolText}>
									<T id="nginxions.pki.ca.add" />
								</span>
							</button>
						)
					}
				>
					<CasTab data={pkiData} refresh={refresh} />
				</Block>
			)}

			{canTls && (
				<Block
					id="certs-acme"
					title={<T id="nginxions.acme.servers.title" />}
					hint={<T id="nginxions.acme.servers.description" />}
					extra={
						can("settings", "manage") &&
						acme.data && (
							<button
								type="button"
								className={hostStyles.tool}
								onClick={() => showAcmeServerModal(acme.data?.presets ?? [], refresh)}
							>
								<IconPlus size={16} />
								<span className={hostStyles.toolText}>
									<T id="nginxions.acme.servers.add" />
								</span>
							</button>
						)
					}
				>
					<AcmeServers canManage={can("settings", "manage")} />
				</Block>
			)}
		</div>
	);
}

/** the registry lists TLS certificates (certificates) and those of the PKI (pki): either opens the page */
const Certificates = () => (
	<HasPermission rbac="certificates|pki" permission={VIEW} pageLoading loadingNoLogo>
		<CertificatesPage />
	</HasPermission>
);

export default Certificates;
