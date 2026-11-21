// How the configuration reaches the nodes (docs/ROADMAP.md, phase 15, step 15.2; docs/adr/0012-nodes.md 5a):
//   - hosts given to a label: every node with the label serves them;
//   - a staged rollout: a change reaches the canary nodes first, the others with "Roll out to all nodes";
//   - the packages of a node: the last ones it was given, and "back to this package" (a rollback).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { useState } from "react";
import Alert from "react-bootstrap/Alert";
import Modal from "react-bootstrap/Modal";
import { getProxyHosts, type ProxyHost } from "src/api/backend";
import { Button, LoadingPage } from "src/components";
import { useLocaleState } from "src/context";
import { formatDateTime, intl, T } from "src/locale";
import { showError, showSuccess } from "src/notifications";
import {
	type ClusterNode,
	getLabelHosts,
	getNodePackages,
	getNodes,
	getStaged,
	holdNodePackage,
	promoteRollout,
	setLabelHosts,
	setNodeCanary,
	setStaged,
} from "../api";
import { showConfirmModal } from "../modals/ConfirmModal";
import { useCan } from "../rbac/hooks";

const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const NODES_KEY = ["nginxions-nodes"];

/** proxy hosts to tick: the ticked ones go to the nodes */
export function HostsPicker({ hosts, picked, hint }: { hosts: ProxyHost[]; picked: Set<number>; hint?: string }) {
	const [, redraw] = useState(0);
	if (!hosts.length) {
		return (
			<p className="text-secondary mb-0">
				<T id="nginxions.nodes.hosts.none" />
			</p>
		);
	}
	return (
		<>
			<p className="text-secondary small">{hint ?? t("nginxions.nodes.hosts.hint")}</p>
			<div className="nx-scroll" style={{ maxHeight: "50vh", overflowY: "auto" }}>
				{hosts.map((h) => (
					<label key={h.id} className="form-check">
						<input
							type="checkbox"
							className="form-check-input"
							checked={picked.has(h.id)}
							onChange={(e) => {
								if (e.target.checked) picked.add(h.id);
								else picked.delete(h.id);
								redraw((n) => n + 1);
							}}
						/>
						<span className="form-check-label">{h.domainNames.join(", ")}</span>
					</label>
				))}
			</div>
		</>
	);
}

/** the packages a node was given; one of them can be the one it is held on */
const PackagesModal = EasyModal.create(({ node, visible, remove }: { node: ClusterNode } & InnerModalProps) => {
	const { locale } = useLocaleState();
	const queryClient = useQueryClient();
	const manage = useCan()("nodes", "manage");
	const key = ["nginxions-node-packages", node.id];
	const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => getNodePackages(node.id) });
	const [busy, setBusy] = useState(false);
	const [pinned, setPinned] = useState(node.pinned);
	const hold = async (version: string | null) => {
		setBusy(true);
		try {
			const next = await holdNodePackage(node.id, version);
			setPinned(next.pinned);
			showSuccess(t(version ? "nginxions.nodes.packages.held" : "nginxions.nodes.packages.follows"));
			queryClient.invalidateQueries({ queryKey: key });
			queryClient.invalidateQueries({ queryKey: NODES_KEY });
		} catch (err) {
			showError(errorText(err));
		}
		setBusy(false);
	};
	return (
		<Modal show={visible} onHide={remove} size="lg">
			<Modal.Header closeButton>
				<Modal.Title>
					<T id="nginxions.nodes.packages.title" data={{ name: node.name }} />
				</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				<p className="text-secondary">
					<T id="nginxions.nodes.packages.hint" />
				</p>
				{pinned && (
					<Alert variant="warning" className="d-flex align-items-center gap-2">
						<span className="flex-grow-1">
							<T
								id={`nginxions.nodes.pinned.${pinned.by}`}
								data={{ version: pinned.version.slice(0, 12) }}
							/>
						</span>
						{manage && (
							<Button size="sm" isLoading={busy} onClick={() => hold(null)}>
								<T id="nginxions.nodes.packages.follow" />
							</Button>
						)}
					</Alert>
				)}
				{error && <Alert variant="danger">{(error as Error).message}</Alert>}
				{isLoading ? (
					<LoadingPage noLogo />
				) : !data?.length ? (
					<p className="text-secondary mb-0">
						<T id="nginxions.nodes.packages.none" />
					</p>
				) : (
					<table className="table table-vcenter table-sm">
						<thead>
							<tr>
								<th>
									<T id="nginxions.nodes.packages.version" />
								</th>
								<th>
									<T id="nginxions.nodes.packages.given" />
								</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{data.map((p) => (
								<tr key={p.version}>
									<td>
										<span className="font-monospace">{p.version.slice(0, 12)}</span>
										{p.applied && (
											<span className="badge bg-green-lt ms-2">
												<T id="nginxions.nodes.packages.applied" />
											</span>
										)}
										{pinned?.version === p.version && (
											<span className="badge bg-yellow-lt ms-2">
												<T id="nginxions.nodes.packages.pinned" />
											</span>
										)}
									</td>
									<td className="text-nowrap">{formatDateTime(p.createdOn, locale)}</td>
									<td className="text-end">
										{manage && pinned?.version !== p.version && (
											<Button size="sm" disabled={busy} onClick={() => hold(p.version)}>
												<T id="nginxions.nodes.packages.hold" />
											</Button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</Modal.Body>
			<Modal.Footer>
				<Button onClick={remove}>
					<T id="nginxions.common.close" />
				</Button>
			</Modal.Footer>
		</Modal>
	);
});

export const showPackages = (node: ClusterNode) => {
	EasyModal.show(PackagesModal, { node });
};

/** Agents → Nodes → Rollout plan: hosts by label, canaries and the staged rollout */
export function RolloutPlanCard() {
	const can = useCan();
	const manage = can("nodes", "manage");
	const queryClient = useQueryClient();
	const nodes = useQuery({ queryKey: NODES_KEY, queryFn: getNodes });
	const labels = useQuery({ queryKey: ["nginxions-label-hosts"], queryFn: getLabelHosts });
	const staged = useQuery({ queryKey: ["nginxions-nodes-staged"], queryFn: getStaged });
	const { data: proxyHosts } = useQuery({
		queryKey: ["nginxions-nodes-proxy-hosts"],
		queryFn: () => getProxyHosts(),
		enabled: manage,
	});
	const [busy, setBusy] = useState(false);
	const active = (nodes.data ?? []).filter((n) => n.status === "active");
	if (!nodes.data?.length) return null;

	const refresh = () => {
		queryClient.invalidateQueries({ queryKey: NODES_KEY });
		queryClient.invalidateQueries({ queryKey: ["nginxions-label-hosts"] });
		queryClient.invalidateQueries({ queryKey: ["nginxions-nodes-staged"] });
	};
	const run = async (action: () => Promise<unknown>, done?: string) => {
		setBusy(true);
		try {
			await action();
			if (done) showSuccess(t(done));
			refresh();
		} catch (err) {
			showError(errorText(err));
		}
		setBusy(false);
	};
	const onLabelHosts = (label: string, hostIds: number[]) => {
		const picked = new Set(hostIds);
		showConfirmModal({
			tTitle: "nginxions.nodes.labels.hosts.title",
			tConfirm: "save",
			children: (
				<HostsPicker
					hosts={proxyHosts ?? []}
					picked={picked}
					hint={t("nginxions.nodes.labels.hosts.hint", { label })}
				/>
			),
			onConfirm: async () => {
				await setLabelHosts(label, [...picked]);
				showSuccess(t("nginxions.nodes.labels.hosts.saved", { label }));
				refresh();
			},
		});
	};
	const onPromote = () =>
		showConfirmModal({
			tTitle: "nginxions.nodes.staged.promote",
			tConfirm: "nginxions.nodes.staged.promote",
			children: (
				<p>
					<T id="nginxions.nodes.staged.promote.confirm" />
				</p>
			),
			onConfirm: () => run(promoteRollout, "nginxions.nodes.staged.promoted"),
		});
	const isStaged = staged.data?.staged ?? false;
	const waiting = active.filter((n) => n.pinned?.by === "staged").length;

	return (
		<div className="card mt-4" data-testid="rollout-plan">
			<div className="card-header">
				<h3 className="card-title">
					<T id="nginxions.nodes.plan.title" />
				</h3>
			</div>
			<div className="card-body">
				<p className="text-secondary">
					<T id="nginxions.nodes.plan.hint" />
				</p>
				<div className="mb-3">
					<label className="form-check form-switch">
						<input
							className="form-check-input"
							type="checkbox"
							checked={isStaged}
							disabled={!manage || busy || staged.isLoading}
							onChange={(e) =>
								run(
									() => setStaged(e.target.checked),
									e.target.checked ? "nginxions.nodes.staged.on" : "nginxions.nodes.staged.off",
								)
							}
						/>
						<span className="form-check-label">
							<T id="nginxions.nodes.staged" />
						</span>
					</label>
					<div className="text-secondary small">
						<T id="nginxions.nodes.staged.hint" />
					</div>
					{isStaged && (
						<div className="d-flex align-items-center gap-2 mt-2">
							<span className="small">
								<T id="nginxions.nodes.staged.waiting" data={{ count: waiting }} />
							</span>
							{manage && (
								<Button size="sm" actionType="primary" disabled={busy} onClick={onPromote}>
									<T id="nginxions.nodes.staged.promote" />
								</Button>
							)}
						</div>
					)}
				</div>
				{active.length > 0 && (
					<div className="mb-3">
						<div className="form-label">
							<T id="nginxions.nodes.canary" />
						</div>
						<div className="text-secondary small mb-1">
							<T id="nginxions.nodes.canary.hint" />
						</div>
						{active.map((n) => (
							<label key={n.id} className="form-check form-check-inline">
								<input
									type="checkbox"
									className="form-check-input"
									checked={n.canary}
									disabled={!manage || busy}
									onChange={(e) => run(() => setNodeCanary(n.id, e.target.checked))}
								/>
								<span className="form-check-label">{n.name}</span>
							</label>
						))}
					</div>
				)}
				<div className="form-label">
					<T id="nginxions.nodes.labels.hosts" />
				</div>
				{labels.isLoading ? (
					<LoadingPage noLogo />
				) : !labels.data?.length ? (
					<p className="text-secondary mb-0">
						<T id="nginxions.nodes.labels.none" />
					</p>
				) : (
					<table className="table table-vcenter table-sm mb-0">
						<tbody>
							{labels.data.map((l) => (
								<tr key={l.label} data-label-row={l.label}>
									<td>
										<span className="badge bg-blue-lt">{l.label}</span>
									</td>
									<td className="text-secondary small">
										<T
											id="nginxions.nodes.labels.count"
											data={{
												hosts: l.hostIds.length,
												nodes: active.filter((n) => n.labels.includes(l.label)).length,
											}}
										/>
									</td>
									<td className="text-end">
										{manage && (
											<Button size="sm" onClick={() => onLabelHosts(l.label, l.hostIds)}>
												<T id="nginxions.nodes.labels.hosts.button" />
											</Button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}
