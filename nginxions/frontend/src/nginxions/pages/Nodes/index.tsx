// Agents → Nodes (docs/ROADMAP.md, phase 15; docs/adr/0012-nodes.md): the servers of NginxionS connected to this
// one, and this server as a node of a manager. A node is added here and gets a one-time join code; on the new server
// the code and the address of this one are entered in "This server".
import { IconCopy, IconKey, IconPlugConnected, IconPlus, IconServer, IconTrash, IconUnlink } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import Alert from "react-bootstrap/Alert";
import { getProxyHosts, type ProxyHost } from "src/api/backend";
import { Button, HasPermission, LoadingPage } from "src/components";
import { useLocaleState } from "src/context";
import { formatDateTime, intl, T } from "src/locale";
import { VIEW } from "src/modules/Permissions";
import { showError, showSuccess } from "src/notifications";
import {
	addNode,
	type ClusterNode,
	deleteNode,
	getClusterMember,
	getNodes,
	joinCluster,
	leaveCluster,
	type NodeCode,
	type NodeState,
	newNodeCode,
	revokeNode,
	setNodeHosts,
} from "../../api";
import { showConfirmModal } from "../../modals/ConfirmModal";
import { useCan } from "../../rbac/hooks";

const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);

const STATE_COLORS: Record<NodeState, string> = {
	online: "green",
	offline: "red",
	pending: "yellow",
	expired: "secondary",
	revoked: "secondary",
};

const copy = (text: string) =>
	navigator.clipboard?.writeText(text).then(() => showSuccess(t("nginxions.nodes.copied")));

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** the join code of a node: shown once, with what to do with it */
function CodeBox({ result, onClose }: { result: NodeCode; onClose: () => void }) {
	const { locale } = useLocaleState();
	return (
		<Alert variant="success" className="m-3" onClose={onClose} dismissible>
			<div className="fw-bold mb-2">
				<T id="nginxions.nodes.code.title" data={{ name: result.node.name }} />
			</div>
			<div className="d-flex align-items-center gap-2 mb-2">
				<code className="text-break user-select-all" data-testid="node-code">
					{result.code}
				</code>
				<Button size="sm" onClick={() => copy(result.code)}>
					<IconCopy size={16} className="me-1" />
					<T id="nginxions.nodes.copy" />
				</Button>
			</div>
			<div className="small">
				<T
					id="nginxions.nodes.code.how"
					data={{ address: window.location.origin, time: formatDateTime(result.code_expires_on, locale) }}
				/>
			</div>
		</Alert>
	);
}

/** the proxy hosts of this server a node serves: ticked ones go to the node with its next package */
function HostsPicker({ hosts, picked }: { hosts: ProxyHost[]; picked: Set<number> }) {
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
			<p className="text-secondary small">
				<T id="nginxions.nodes.hosts.hint" />
			</p>
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

/** the package of a node: applied, refused, or not there yet */
function PackageState({ node }: { node: ClusterNode }) {
	if (node.status !== "active") return <>—</>;
	if (node.info.package_error) {
		return (
			<span className="text-danger small" title={node.info.package_error}>
				<T id="nginxions.nodes.package.error" data={{ error: node.info.package_error.slice(0, 80) }} />
			</span>
		);
	}
	if (!node.info.package_version) {
		return (
			<span className="text-secondary small">
				<T id="nginxions.nodes.package.waiting" />
			</span>
		);
	}
	return (
		<span className="small">
			<span className="badge bg-green-lt me-1">
				<T id="nginxions.nodes.package.applied" />
			</span>
			<span className="text-secondary font-monospace">{node.info.package_version.slice(0, 12)}</span>
			{!!node.info.package_skipped && (
				<div className="text-warning">
					<T id="nginxions.nodes.package.skipped" data={{ count: node.info.package_skipped }} />
				</div>
			)}
		</span>
	);
}

function NodesCard() {
	const can = useCan();
	const { locale } = useLocaleState();
	const queryClient = useQueryClient();
	const manage = can("nodes", "manage");
	const { data, isLoading, isError, error } = useQuery({
		queryKey: ["nginxions-nodes"],
		queryFn: getNodes,
		refetchInterval: 10000,
	});
	const [name, setName] = useState("");
	const [labels, setLabels] = useState("");
	const [saving, setSaving] = useState(false);
	const [code, setCode] = useState<NodeCode | null>(null);
	const refresh = () => queryClient.invalidateQueries({ queryKey: ["nginxions-nodes"] });
	const { data: proxyHosts } = useQuery({
		queryKey: ["nginxions-nodes-proxy-hosts"],
		queryFn: () => getProxyHosts(),
		enabled: manage,
	});

	const onHosts = (node: ClusterNode) => {
		const picked = new Set(node.host_ids);
		showConfirmModal({
			tTitle: "nginxions.nodes.hosts.title",
			tConfirm: "save",
			children: <HostsPicker hosts={proxyHosts ?? []} picked={picked} />,
			onConfirm: async () => {
				await setNodeHosts(node.id, [...picked]);
				showSuccess(t("nginxions.nodes.hosts.saved", { name: node.name }));
				refresh();
			},
		});
	};

	const onAdd = async (e: FormEvent) => {
		e.preventDefault();
		setSaving(true);
		try {
			const result = await addNode({
				name: name.trim(),
				labels: labels
					.split(/[\s,]+/)
					.map((l) => l.trim())
					.filter(Boolean),
			});
			setCode(result);
			setName("");
			setLabels("");
			refresh();
		} catch (err) {
			showError(errorText(err));
		} finally {
			setSaving(false);
		}
	};

	const onNewCode = async (node: ClusterNode) => {
		try {
			setCode(await newNodeCode(node.id));
			refresh();
		} catch (err) {
			showError(errorText(err));
		}
	};

	const onRevoke = (node: ClusterNode) =>
		showConfirmModal({
			tTitle: "nginxions.nodes.revoke",
			tConfirm: "nginxions.nodes.revoke",
			danger: true,
			children: (
				<p>
					<T id="nginxions.nodes.revoke.confirm" data={{ name: node.name }} />
				</p>
			),
			onConfirm: async () => {
				await revokeNode(node.id);
				refresh();
			},
		});

	const onDelete = (node: ClusterNode) =>
		showConfirmModal({
			tTitle: "nginxions.nodes.delete",
			tConfirm: "nginxions.nodes.delete",
			danger: true,
			children: (
				<p>
					<T id="nginxions.nodes.delete.confirm" data={{ name: node.name }} />
				</p>
			),
			onConfirm: async () => {
				await deleteNode(node.id);
				refresh();
			},
		});

	return (
		<div className="card mt-4">
			<div className="card-header">
				<div>
					<h2 className="mt-1 mb-1">
						<T id="nginxions.nodes" />
					</h2>
					<div className="text-secondary small">
						<T id="nginxions.nodes.hint" />
					</div>
				</div>
			</div>
			{manage && (
				<form className="card-body border-bottom row g-2 align-items-end" onSubmit={onAdd}>
					<div className="col-md-4">
						<label className="form-label" htmlFor="node-name">
							<T id="nginxions.nodes.name" />
						</label>
						<input
							id="node-name"
							className="form-control"
							value={name}
							maxLength={100}
							required
							onChange={(e) => setName(e.target.value)}
							placeholder={t("nginxions.nodes.name.placeholder")}
						/>
					</div>
					<div className="col-md-5">
						<label className="form-label" htmlFor="node-labels">
							<T id="nginxions.nodes.labels" />
						</label>
						<input
							id="node-labels"
							className="form-control"
							value={labels}
							onChange={(e) => setLabels(e.target.value)}
							placeholder={t("nginxions.nodes.labels.placeholder")}
						/>
					</div>
					<div className="col-md-3">
						<Button type="submit" actionType="primary" isLoading={saving} disabled={!name.trim()}>
							<IconPlus size={16} className="me-1" />
							<T id="nginxions.nodes.add" />
						</Button>
					</div>
				</form>
			)}
			{code && <CodeBox result={code} onClose={() => setCode(null)} />}
			{isLoading && <LoadingPage />}
			{isError && (
				<Alert variant="danger" className="m-3">
					{error?.message || <T id="nginxions.common.unknown-error" />}
				</Alert>
			)}
			{data && !data.length && (
				<p className="text-secondary m-3">
					<T id="nginxions.nodes.none" />
				</p>
			)}
			{data && data.length > 0 && (
				<div className="table-responsive">
					<table className="table table-vcenter card-table nx-stack">
						<thead>
							<tr>
								<th>
									<T id="nginxions.nodes.name" />
								</th>
								<th>
									<T id="nginxions.nodes.state" />
								</th>
								<th>
									<T id="nginxions.nodes.server" />
								</th>
								<th>
									<T id="nginxions.nodes.package" />
								</th>
								<th>
									<T id="nginxions.nodes.last-seen" />
								</th>
								<th className="w-1" />
							</tr>
						</thead>
						<tbody>
							{data.map((node) => (
								<tr key={node.id} data-node={node.uid}>
									<td>
										<div className="font-weight-medium">{node.name}</div>
										<div className="text-secondary small font-monospace">{node.uid}</div>
										{node.labels.length > 0 && (
											<div className="mt-1">
												{node.labels.map((l) => (
													<span key={l} className="badge bg-blue-lt me-1">
														{l}
													</span>
												))}
											</div>
										)}
									</td>
									<td data-label={t("nginxions.nodes.state")}>
										<span className={`badge bg-${STATE_COLORS[node.state]}-lt`}>
											<T id={`nginxions.nodes.state.${node.state}`} />
										</span>
										{node.state === "pending" && node.code_expires_on && (
											<div className="text-secondary small mt-1">
												<T
													id="nginxions.nodes.code.until"
													data={{ time: formatDateTime(node.code_expires_on, locale) }}
												/>
											</div>
										)}
									</td>
									<td data-label={t("nginxions.nodes.server")}>
										<div>{node.info.hostname || "—"}</div>
										<div className="text-secondary small">
											{node.address}
											{node.info.version && (
												<span className="ms-2">
													<T
														id="nginxions.nodes.version"
														data={{ version: node.info.version }}
													/>
												</span>
											)}
											{typeof node.info.hosts === "number" && (
												<span className="ms-2">
													<T id="nginxions.nodes.hosts" data={{ count: node.info.hosts }} />
												</span>
											)}
										</div>
									</td>
									<td data-label={t("nginxions.nodes.package")}>
										<PackageState node={node} />
									</td>
									<td data-label={t("nginxions.nodes.last-seen")}>
										{node.last_seen_on ? formatDateTime(node.last_seen_on, locale) : "—"}
									</td>
									<td className="text-nowrap nx-actions-row">
										{node.status === "active" && (
											<a className="btn btn-sm me-2" href={`/waf/events?node=${node.uid}`}>
												<T id="nginxions.nodes.events" />
											</a>
										)}
										{manage && node.status !== "revoked" && (
											<Button size="sm" className="me-2" onClick={() => onHosts(node)}>
												<IconServer size={16} className="me-1" />
												<T
													id="nginxions.nodes.hosts.button"
													data={{ count: node.host_ids.length }}
												/>
											</Button>
										)}
										{manage && node.status === "pending" && (
											<Button size="sm" className="me-2" onClick={() => onNewCode(node)}>
												<IconKey size={16} className="me-1" />
												<T id="nginxions.nodes.new-code" />
											</Button>
										)}
										{manage && node.status === "active" && (
											<Button size="sm" actionType="warning" onClick={() => onRevoke(node)}>
												<IconUnlink size={16} className="me-1" />
												<T id="nginxions.nodes.revoke" />
											</Button>
										)}
										{manage && node.status !== "active" && (
											<Button size="sm" actionType="danger" onClick={() => onDelete(node)}>
												<IconTrash size={16} className="me-1" />
												<T id="nginxions.nodes.delete" />
											</Button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

/** this server as a node of a manager */
function MemberCard() {
	const can = useCan();
	const { locale } = useLocaleState();
	const queryClient = useQueryClient();
	const manage = can("settings", "manage");
	const { data } = useQuery({
		queryKey: ["nginxions-cluster-member"],
		queryFn: getClusterMember,
		refetchInterval: 15000,
	});
	const [managerUrl, setManagerUrl] = useState("");
	const [code, setCode] = useState("");
	const [joining, setJoining] = useState(false);
	const refresh = () => queryClient.invalidateQueries({ queryKey: ["nginxions-cluster-member"] });

	const onJoin = async (e: FormEvent) => {
		e.preventDefault();
		setJoining(true);
		try {
			await joinCluster({ manager_url: managerUrl.trim(), code: code.trim() });
			setCode("");
			showSuccess(t("nginxions.cluster.joined"));
			refresh();
		} catch (err) {
			showError(errorText(err));
		} finally {
			setJoining(false);
		}
	};

	const onLeave = () =>
		showConfirmModal({
			tTitle: "nginxions.cluster.leave",
			tConfirm: "nginxions.cluster.leave",
			danger: true,
			children: (
				<p>
					<T id="nginxions.cluster.leave.confirm" />
				</p>
			),
			onConfirm: async () => {
				await leaveCluster();
				refresh();
			},
		});

	if (!data) return null;
	return (
		<div className="card mt-4">
			<div className="card-header">
				<div>
					<h2 className="mt-1 mb-1">
						<T id="nginxions.cluster.this-server" />
					</h2>
					<div className="text-secondary small">
						<T id="nginxions.cluster.hint" />
					</div>
				</div>
			</div>
			{data.joined ? (
				<div className="card-body">
					{data.disabled && (
						<Alert variant="warning">
							<T id="nginxions.cluster.disabled" />
						</Alert>
					)}
					<dl className="row mb-0">
						<dt className="col-md-3">
							<T id="nginxions.cluster.manager" />
						</dt>
						<dd className="col-md-9 font-monospace">{data.manager_url}</dd>
						<dt className="col-md-3">
							<T id="nginxions.cluster.node" />
						</dt>
						<dd className="col-md-9">
							{data.name} <span className="text-secondary font-monospace small">{data.uid}</span>
						</dd>
						<dt className="col-md-3">
							<T id="nginxions.cluster.fingerprint" />
						</dt>
						<dd className="col-md-9 font-monospace small text-break">{data.fingerprint}</dd>
						<dt className="col-md-3">
							<T id="nginxions.cluster.last-ok" />
						</dt>
						<dd className="col-md-9">
							{data.last_ok_on ? formatDateTime(data.last_ok_on, locale) : "—"}
							{data.last_error && <div className="text-danger small">{data.last_error}</div>}
						</dd>
						{data.learning && (
							<>
								<dt className="col-md-3">
									<T id="nginxions.cluster.learning" />
								</dt>
								<dd className="col-md-9">
									{data.learning.last_ok_on ? (
										<T
											id="nginxions.cluster.learning-ok"
											data={{ time: formatDateTime(data.learning.last_ok_on, locale) }}
										/>
									) : (
										<span className="text-secondary">
											<T id="nginxions.cluster.learning-waiting" />
										</span>
									)}
									{data.learning.last_error && (
										<div className="text-danger small">{data.learning.last_error}</div>
									)}
									<div className="form-hint">
										<T id="nginxions.cluster.learning-hint" />
									</div>
								</dd>
							</>
						)}
					</dl>
					{manage && (
						<Button size="sm" actionType="danger" className="mt-3" onClick={onLeave}>
							<IconUnlink size={16} className="me-1" />
							<T id="nginxions.cluster.leave" />
						</Button>
					)}
				</div>
			) : manage ? (
				<form className="card-body row g-2 align-items-end" onSubmit={onJoin}>
					<div className="col-md-4">
						<label className="form-label" htmlFor="cluster-manager">
							<T id="nginxions.cluster.manager" />
						</label>
						<input
							id="cluster-manager"
							className="form-control"
							value={managerUrl}
							required
							placeholder={t("nginxions.cluster.manager.placeholder")}
							onChange={(e) => setManagerUrl(e.target.value)}
						/>
					</div>
					<div className="col-md-5">
						<label className="form-label" htmlFor="cluster-code">
							<T id="nginxions.cluster.code" />
						</label>
						<input
							id="cluster-code"
							className="form-control font-monospace"
							value={code}
							required
							autoComplete="off"
							onChange={(e) => setCode(e.target.value)}
						/>
					</div>
					<div className="col-md-3">
						<Button type="submit" actionType="primary" isLoading={joining}>
							<IconPlugConnected size={16} className="me-1" />
							<T id="nginxions.cluster.join" />
						</Button>
					</div>
				</form>
			) : (
				<p className="text-secondary m-3">
					<T id="nginxions.cluster.standalone" />
				</p>
			)}
		</div>
	);
}

const Nodes = () => (
	<HasPermission rbac="nodes" permission={VIEW} pageLoading loadingNoLogo>
		<NodesCard />
		<MemberCard />
	</HasPermission>
);

export default Nodes;
