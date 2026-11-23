// Certificates (one page, pages/Certificates): the hosts protected by client certificates (mTLS) and the switch that
// protects another one in one step (its own trust domain is created when needed). Their access certificates are rows
// of the table of all certificates.
import { IconDots, IconLock } from "@tabler/icons-react";
import cn from "classnames";
import { type ReactNode, useMemo } from "react";
import { useProxyHosts, useStreams } from "src/hooks";
import { intl, T } from "src/locale";
import { showError, showSuccess } from "src/notifications";
import { showConfirmModal } from "../modals/ConfirmModal";
import hostStyles from "../pages/Hosts/Hosts.module.css";
import { useCan } from "../rbac/hooks";
import { Dropdown, type DropdownItem } from "../ui/Dropdown";
import { showAccessModal } from "./AccessModal";
import {
	enableMtlsHost,
	getMtlsHost,
	type HostRef,
	hostKey,
	issuersFor,
	type MtlsHostType,
	type PkiCert,
	type PkiOverview,
	type ProtectedHost,
	setMtlsHost,
} from "./api";
import { certStatus } from "./CertModal";
import { showHostCertsModal } from "./HostCertsModal";
import { showMtlsModal } from "./MtlsModal";
import styles from "./Pki.module.css";

const t = (id: string, values?: Record<string, any>) => intl.formatMessage({ id }, values);

const attempt = async (action: () => Promise<unknown>, refresh: () => void, message?: string) => {
	try {
		await action();
		if (message) showSuccess(message);
	} catch (err: any) {
		showError(err.message);
	}
	refresh();
};

/** mTLS of a host off (its settings are kept for the next switch on) */
const disableMtls = async (type: MtlsHostType, id: number) => {
	const {
		name: _n,
		hasCertificate: _c,
		paths: _p,
		issuerCheck: _i,
		upstreamCaCertificateId: _u,
		nginx: _x,
		...binding
	} = await getMtlsHost(type, id);
	return setMtlsHost(type, id, { ...binding, enabled: false });
};

export function HostsCard({
	data,
	certs,
	refresh,
	filter,
	extra,
}: {
	data: PkiOverview;
	certs: PkiCert[];
	refresh: () => void;
	/** the access certificates of a host in the table of the page */
	filter: (host: HostRef) => void;
	/** buttons of the head of the card */
	extra?: ReactNode;
}) {
	const can = useCan();
	const caNames = (ids: number[]) =>
		ids.map((id) => data.cas.find((ca) => ca.id === id)?.name ?? `#${id}`).join(", ");
	const actions = (h: ProtectedHost): DropdownItem[] => [
		...(can("pki", "issue") && issuersFor(h, data.cas).length
			? [
					{
						key: "issue",
						label: <T id="nginxions.mtls.access.issue" />,
						onSelect: () => showAccessModal({ data, host: h, onDone: refresh }),
					},
				]
			: []),
		{
			key: "pick",
			label: <T id="nginxions.mtls.host.pick" />,
			onSelect: () => showHostCertsModal({ host: h, openHost: filter }),
		},
		{ key: "certs", label: <T id="nginxions.mtls.host.certs" />, onSelect: () => filter(h) },
		{
			key: "settings",
			label: <T id="nginxions.mtls.host.settings" />,
			onSelect: () => showMtlsModal({ type: h.hostType, hostId: h.hostId, onDone: refresh }),
		},
		{
			key: "off",
			divider: true,
			label: <span className="text-danger">{t("nginxions.mtls.host.disable")}</span>,
			onSelect: () =>
				showConfirmModal({
					tTitle: "nginxions.mtls.host.disable",
					tConfirm: "nginxions.mtls.host.disable",
					danger: true,
					onConfirm: async () => {
						await disableMtls(h.hostType, h.hostId);
						showSuccess(t("nginxions.mtls.host.disabled", { name: h.name }));
						refresh();
					},
					children: <T id="nginxions.mtls.host.disable.text" data={{ name: h.name }} />,
				}),
		},
	];

	return (
		<section className={cn("card", styles.card)}>
			<div className={styles.cardHead}>
				<h3 className="card-title m-0 text-nowrap">
					<T id="nginxions.mtls.hosts" />
					<span className="text-secondary ms-2">{data.protected.length}</span>
				</h3>
				{extra}
			</div>
			{data.protected.length === 0 ? (
				<p className={styles.empty}>
					<T id="nginxions.mtls.hosts.none" />
				</p>
			) : (
				<div className="table-responsive">
					<table className="table table-vcenter card-table">
						<thead>
							<tr>
								<th>
									<T id="nginxions.mtls.host" />
								</th>
								<th>
									<T id="nginxions.mtls.mode" />
								</th>
								<th>
									<T id="nginxions.mtls.trust" />
								</th>
								<th>
									<T id="nginxions.mtls.certs" />
								</th>
								<th className="w-1" />
							</tr>
						</thead>
						<tbody>
							{data.protected.map((h) => {
								const count = certs.filter(
									(c) =>
										certStatus(c) !== "revoked" &&
										c.status !== "expired" &&
										c.access.some((a) => hostKey(a) === hostKey(h)),
								).length;
								return (
									<tr key={hostKey(h)}>
										<td>
											<button
												type="button"
												className="btn btn-link p-0 fw-medium"
												onClick={() => filter(h)}
											>
												{h.name}
											</button>
											{!h.active && (
												<div className={styles.sub}>
													<T id="nginxions.mtls.host.inactive" />
												</div>
											)}
										</td>
										<td>
											<span className="badge bg-azure-lt">
												<T
													id={
														h.mode === "optional"
															? "nginxions.hosts.mtls.optional"
															: "nginxions.hosts.mtls.required"
													}
												/>
											</span>
											{h.rules > 0 && (
												<div className={styles.sub}>
													<T id="nginxions.mtls.rules.count" data={{ count: h.rules }} />
												</div>
											)}
										</td>
										<td className={styles.used}>{caNames(h.caIds)}</td>
										<td>{count}</td>
										<td>
											<Dropdown
												floating
												inline
												ariaLabel={t("nginxions.pki.actions")}
												triggerClassName="btn btn-sm btn-ghost-secondary"
												trigger={<IconDots size={16} />}
												items={actions(h)}
											/>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}

export function useUnprotected(data: PkiOverview | undefined) {
	const proxy = useProxyHosts(["certificate"]);
	const stream = useStreams(["certificate"]);
	return useMemo(() => {
		if (!data) return [];
		const on = new Set(data.protected.map(hostKey));
		const list: HostRef[] = [
			...(proxy.data ?? [])
				.filter((h) => h.certificateId)
				.map((h) => ({ hostType: "proxy_host" as const, hostId: h.id, name: h.domainNames.join(", ") })),
			...(stream.data ?? [])
				.filter((h) => h.certificateId)
				.map((h) => ({ hostType: "stream" as const, hostId: h.id, name: `:${h.incomingPort}` })),
		];
		return list.filter((h) => !on.has(hostKey(h)));
	}, [data, proxy.data, stream.data]);
}

/** "Protect a host": mTLS on for a host with TLS in one step (its own trust domain is created when needed) */
export function ProtectHost({ data, refresh }: { data: PkiOverview; refresh: () => void }) {
	const unprotected = useUnprotected(data);
	if (!unprotected.length) return null;
	const protect = (h: HostRef) =>
		attempt(
			() => enableMtlsHost(h.hostType, h.hostId),
			refresh,
			t("nginxions.mtls.host.enabled", { name: h.name }),
		);
	return (
		<Dropdown
			floating
			ariaLabel={t("nginxions.mtls.protect")}
			triggerClassName={hostStyles.tool}
			trigger={
				<>
					<IconLock size={16} />
					<span className={hostStyles.toolText}>
						<T id="nginxions.mtls.protect" />
					</span>
				</>
			}
			items={unprotected.map((h) => ({ key: hostKey(h), label: h.name, onSelect: () => protect(h) }))}
		/>
	);
}
