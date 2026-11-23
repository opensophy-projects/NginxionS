// Certificates (one page, pages/Certificates): the blocks of the PKI. The CAs (roots, trust domains, external ones)
// as a table of their own, and in the settings window of the page the templates of certificates and the settings
// (public address for CRLs and links, lifetimes, key type). ADR-0009.
import { IconDots, IconPlus } from "@tabler/icons-react";
import cn from "classnames";
import { useState } from "react";
import { useLocaleState } from "src/context";
import { intl, T } from "src/locale";
import { showError, showSuccess } from "src/notifications";
import { showConfirmModal } from "../modals/ConfirmModal";
import { useCan } from "../rbac/hooks";
import { Dropdown, type DropdownItem } from "../ui/Dropdown";
import {
	deleteCa,
	exportCa,
	formatShort,
	KEY_TYPES,
	linkBase,
	type PkiCa,
	type PkiOverview,
	type PkiSettings,
	saveFile,
	setPkiSettings,
} from "./api";
import { showCaModal } from "./CaModal";
import { showIssueModal } from "./IssueModal";
import styles from "./Pki.module.css";
import { showRevokeModal } from "./RevokeModal";
import { showSecretModal } from "./SecretModal";
import { showTemplateModal } from "./TemplateModal";

const t = (id: string, values?: Record<string, any>) => intl.formatMessage({ id }, values);

const run = async (action: () => Promise<unknown>, refresh: () => void, message?: string) => {
	try {
		await action();
		if (message) showSuccess(message);
	} catch (err: any) {
		showError(err.message);
	}
	refresh();
};

export function CasTab({ data, refresh }: { data: PkiOverview; refresh: () => void }) {
	const can = useCan();
	const { locale } = useLocaleState();
	const manage = can("pki", "manage");
	const ordered = [
		...data.cas
			.filter((ca) => ca.kind === "root")
			.flatMap((root) => [root, ...data.cas.filter((ca) => ca.parentId === root.id)]),
		...data.cas.filter((ca) => ca.kind === "external"),
	];
	const exportItem = (ca: PkiCa, format: "cert" | "chain" | "crl"): DropdownItem => ({
		key: format,
		label: <T id={`nginxions.pki.ca.export.${format}`} />,
		onSelect: () => run(async () => saveFile(await exportCa(ca.id, format)), refresh),
	});
	const actions = (ca: PkiCa): DropdownItem[] => [
		exportItem(ca, "cert"),
		...(ca.kind !== "external" ? [exportItem(ca, "chain")] : []),
		...(ca.hasCrl ? [exportItem(ca, "crl")] : []),
		...(ca.hasKey && can("pki", "export_key")
			? [
					{
						key: "key",
						label: <T id="nginxions.pki.ca.export.key" />,
						onSelect: () =>
							showSecretModal({
								action: "ca-key",
								objectId: ca.id,
								name: ca.name,
								publicUrl: linkBase(data),
								compatible: true,
							}),
					},
				]
			: []),
		...(manage && ca.kind === "root" && ca.hasKey
			? [
					{
						key: "domain",
						divider: true,
						label: <T id="nginxions.pki.ca.new-domain" />,
						onSelect: () => showCaModal({ data, mode: "intermediate", parentId: ca.id, onDone: refresh }),
					},
				]
			: []),
		...(can("pki", "issue") && ca.kind === "intermediate" && ca.hasKey && !ca.revokedOn
			? [
					{
						key: "issue",
						divider: true,
						label: <T id="nginxions.pki.issue" />,
						onSelect: () => showIssueModal({ data, preset: { caId: ca.id }, onDone: refresh }),
					},
				]
			: []),
		...(manage && !ca.upstreamCertificateId
			? [
					{
						key: "edit",
						divider: true,
						label: <T id="nginxions.pki.ca.edit" />,
						onSelect: () => showCaModal({ data, edit: ca, onDone: refresh }),
					},
					...(can("pki", "revoke") && ca.kind === "intermediate" && !ca.revokedOn
						? [
								{
									key: "revoke",
									label: <span className="text-danger">{t("nginxions.pki.ca.revoke")}</span>,
									onSelect: () =>
										showRevokeModal({
											ca,
											certs: data.certificates.filter(
												(c) => c.caId === ca.id && c.status !== "revoked",
											),
											onDone: refresh,
										}),
								},
							]
						: []),
					{
						key: "delete",
						label: <span className="text-danger">{t("nginxions.pki.ca.delete")}</span>,
						onSelect: () => {
							// a root with trust domains or a CA with certificates goes together with them
							const domains = data.cas.filter((c) => c.parentId === ca.id);
							const certs = [ca, ...domains].reduce((sum, c) => sum + c.issued, 0);
							// hosts with mTLS that trust it or its domains: shown, and their mTLS goes with it
							const hosts = [...new Set([ca, ...domains].flatMap((c) => c.hosts))];
							const cascade = domains.length > 0 || certs > 0 || hosts.length > 0;
							showConfirmModal({
								tTitle: "nginxions.pki.ca.delete",
								tConfirm: hosts.length
									? "nginxions.pki.ca.delete.hosts-confirm"
									: "nginxions.pki.ca.delete",
								danger: true,
								children: (
									<>
										<p>
											{cascade ? (
												<T
													id="nginxions.pki.ca.delete.cascade"
													data={{
														name: ca.name,
														domains: domains.map((c) => c.name).join(", ") || "—",
														certs,
													}}
												/>
											) : (
												<T id="nginxions.pki.ca.delete.text" data={{ name: ca.name }} />
											)}
										</p>
										{hosts.length > 0 && (
											<>
												<p className="mb-1">
													<T id="nginxions.pki.ca.delete.hosts" />
												</p>
												<ul className="mb-0">
													{hosts.map((h) => (
														<li key={h}>{h}</li>
													))}
												</ul>
											</>
										)}
									</>
								),
								onConfirm: async () => {
									await deleteCa(ca.id, cascade, hosts.length > 0);
									refresh();
								},
							});
						},
					},
				]
			: []),
	];
	return (
		<section className={cn("card", styles.card)}>
			{ordered.length === 0 ? (
				<div className={styles.empty}>
					<p className="mb-2">
						<T id="nginxions.pki.ca.none" />
					</p>
					{manage && (
						<button
							type="button"
							className="btn btn-primary btn-sm"
							onClick={() => showCaModal({ data, mode: "root", onDone: refresh })}
						>
							<T id="nginxions.pki.ca.create-root" />
						</button>
					)}
				</div>
			) : (
				<div className="table-responsive">
					<table className="table table-vcenter card-table nx-stack">
						<thead>
							<tr>
								<th>
									<T id="nginxions.pki.ca.name" />
								</th>
								<th>
									<T id="nginxions.pki.expires" />
								</th>
								<th>
									<T id="nginxions.pki.ca.certificates" />
								</th>
								<th className="nx-optional">
									<T id="nginxions.pki.ca.crl" />
								</th>
								<th className="nx-optional">
									<T id="nginxions.pki.used" />
								</th>
								<th className="w-1" />
							</tr>
						</thead>
						<tbody>
							{ordered.map((ca) => (
								<tr key={ca.id}>
									<td className={ca.kind === "intermediate" ? styles.child : undefined}>
										<div className="fw-medium">
											{ca.name}
											<span className="badge bg-secondary-lt ms-2">
												<T id={`nginxions.pki.ca.kind.${ca.kind}`} />
											</span>
											{ca.revokedOn && (
												<span
													className="badge bg-red-lt ms-1"
													title={t(
														`nginxions.pki.reason.${ca.revokeReason || "unspecified"}`,
													)}
												>
													<T id="nginxions.pki.ca.revoked-badge" />
												</span>
											)}
											{ca.upstreamCertificateId && (
												<span className="badge bg-azure-lt ms-1">
													<T id="nginxions.pki.ca.from-npmplus" />
												</span>
											)}
										</div>
										<div className={cn(styles.sub, "font-monospace")} title={ca.subjectDn}>
											{ca.subjectDn}
										</div>
									</td>
									<td className="text-nowrap" data-label={t("nginxions.pki.expires")}>
										{formatShort(ca.notAfter, locale)}
									</td>
									<td className={styles.wrap} data-label={t("nginxions.pki.ca.certificates")}>
										{ca.kind === "intermediate"
											? t("nginxions.pki.ca.counts", { active: ca.active, revoked: ca.revoked })
											: "—"}
									</td>
									<td
										className={cn(styles.wrap, "nx-optional")}
										data-label={t("nginxions.pki.ca.crl")}
									>
										{ca.crlNextUpdate ? (
											<span title={t("nginxions.pki.ca.crl.number", { number: ca.crlNumber })}>
												<T
													id="nginxions.pki.ca.crl.until"
													data={{ time: formatShort(ca.crlNextUpdate, locale) }}
												/>
											</span>
										) : (
											<span className="text-secondary">
												<T id="nginxions.pki.ca.crl.none" />
											</span>
										)}
									</td>
									<td className={cn(styles.used, "nx-optional")} data-label={t("nginxions.pki.used")}>
										{ca.hosts.length ? (
											<span title={ca.hosts.join(", ")}>
												{ca.hosts.slice(0, 2).join(", ")}
												{ca.hosts.length > 2 && ` +${ca.hosts.length - 2}`}
											</span>
										) : (
											<span className="text-secondary">—</span>
										)}
									</td>
									<td className="nx-actions">
										<Dropdown
											floating
											inline
											ariaLabel={t("nginxions.pki.actions")}
											triggerClassName="btn btn-sm btn-ghost-secondary"
											trigger={<IconDots size={16} />}
											items={actions(ca)}
										/>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}

export function TemplatesTab({ data, refresh }: { data: PkiOverview; refresh: () => void }) {
	const can = useCan();
	const manage = can("pki", "manage");
	const caName = (id: number | null) =>
		id ? (data.cas.find((ca) => ca.id === id)?.name ?? `#${id}`) : t("nginxions.pki.template.any-ca");
	return (
		<section className={cn("card", styles.card)}>
			<div className={styles.cardHead}>
				<p className="text-secondary small mb-0">
					<T id="nginxions.pki.templates.hint" />
				</p>
				{manage && (
					<button
						type="button"
						className="btn btn-sm"
						onClick={() => showTemplateModal({ data, onDone: refresh })}
					>
						<IconPlus size={14} className="me-1" />
						<T id="nginxions.pki.template.add" />
					</button>
				)}
			</div>
			{data.settings.templates.length === 0 ? (
				<p className={styles.empty}>
					<T id="nginxions.pki.templates.none" />
				</p>
			) : (
				<ul className={styles.list}>
					{data.settings.templates.map((x) => (
						<li className={styles.item} key={x.id}>
							<div className="flex-fill">
								<div className="fw-medium">{x.name}</div>
								<div className={styles.sub}>
									{[
										t(`nginxions.pki.profile.${x.profile}`),
										caName(x.caId),
										t("nginxions.pki.days-value", { days: x.days }),
										t(`nginxions.pki.key-type.${x.keyType}`),
										x.subject.organization,
										x.subject.organizationalUnit,
									]
										.filter(Boolean)
										.join(" · ")}
								</div>
							</div>
							{can("pki", "issue") && (
								<button
									type="button"
									className="btn btn-sm"
									onClick={() =>
										showIssueModal({ data, preset: { templateId: x.id }, onDone: refresh })
									}
								>
									<T id="nginxions.pki.issue" />
								</button>
							)}
							{manage && (
								<Dropdown
									floating
									inline
									ariaLabel={t("nginxions.pki.actions")}
									triggerClassName="btn btn-sm btn-ghost-secondary"
									trigger={<IconDots size={16} />}
									items={[
										{
											key: "edit",
											label: <T id="nginxions.pki.template.edit" />,
											onSelect: () => showTemplateModal({ data, template: x, onDone: refresh }),
										},
										{
											key: "delete",
											label: (
												<span className="text-danger">
													{t("nginxions.pki.template.delete")}
												</span>
											),
											onSelect: () =>
												run(
													() =>
														setPkiSettings({
															...data.settings,
															templates: data.settings.templates.filter(
																(y) => y.id !== x.id,
															),
														}),
													refresh,
												),
										},
									]}
								/>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

export function SettingsTab({ data, refresh }: { data: PkiOverview; refresh: () => void }) {
	const can = useCan();
	const manage = can("pki", "manage");
	const [value, setValue] = useState<PkiSettings>(data.settings);
	const [busy, setBusy] = useState(false);
	const number = (key: "crlDays" | "clientDays" | "serverDays") => (
		<div className="col-md-4 mb-3">
			<label className="form-label" htmlFor={`pki-set-${key}`}>
				<T id={`nginxions.pki.settings.${key}`} />
			</label>
			<input
				id={`pki-set-${key}`}
				type="number"
				min={1}
				className="form-control"
				disabled={!manage}
				value={value[key]}
				onChange={(e) => setValue({ ...value, [key]: Number(e.target.value) })}
			/>
		</div>
	);
	return (
		<section className={cn("card", styles.card)}>
			<div className="mb-3">
				<label className="form-label" htmlFor="pki-set-url">
					<T id="nginxions.pki.settings.public-url" />
				</label>
				<input
					id="pki-set-url"
					className="form-control"
					placeholder={t("nginxions.pki.settings.public-url.placeholder")}
					disabled={!manage}
					value={value.publicUrl}
					onChange={(e) => setValue({ ...value, publicUrl: e.target.value.trim() })}
				/>
				<div className="form-hint">
					<T id="nginxions.pki.settings.public-url.hint" />
				</div>
			</div>
			<div className="row">
				{number("clientDays")}
				{number("serverDays")}
				{number("crlDays")}
			</div>
			<div className="row">
				<div className="col-md-4 mb-3">
					<label className="form-label" htmlFor="pki-set-key">
						<T id="nginxions.pki.key-type" />
					</label>
					<select
						id="pki-set-key"
						className="form-select"
						disabled={!manage}
						value={value.keyType}
						onChange={(e) => setValue({ ...value, keyType: e.target.value })}
					>
						{KEY_TYPES.map((k) => (
							<option key={k} value={k}>
								{t(`nginxions.pki.key-type.${k}`)}
							</option>
						))}
					</select>
				</div>
				<div className="col-md-8 mb-3 d-flex align-items-end">
					<label className="form-check mb-2">
						<input
							type="checkbox"
							className="form-check-input"
							disabled={!manage}
							checked={value.p12Compatible}
							onChange={(e) => setValue({ ...value, p12Compatible: e.target.checked })}
						/>
						<span className="form-check-label">
							<T id="nginxions.pki.p12.compatible" />
						</span>
						<span className="form-check-description">
							<T id="nginxions.pki.p12.compatible.hint" />
						</span>
					</label>
				</div>
			</div>
			{manage && (
				<div>
					<button
						type="button"
						className="btn btn-primary"
						disabled={busy}
						onClick={async () => {
							setBusy(true);
							await run(() => setPkiSettings(value), refresh, t("nginxions.pki.settings.saved"));
							setBusy(false);
						}}
					>
						<T id="save" />
					</button>
				</div>
			)}
		</section>
	);
}
