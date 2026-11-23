// The nodes in the pages of the agents (docs/ROADMAP.md, phase 15, step 15.6): "open-appsec" and "CrowdSec" choose
// "This server" or a node of this manager; a node shows what its heartbeat tells (its services, the package, the
// model, the learning profile), its events and its logs. The logs are collected by the node on demand: the command
// goes with its next heartbeat, the logs come with the one after.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { useState } from "react";
import Alert from "react-bootstrap/Alert";
import Modal from "react-bootstrap/Modal";
import { Button, LoadingPage } from "src/components";
import { useLocaleState } from "src/context";
import { formatDateTime, intl, T } from "src/locale";
import { showError, showSuccess } from "src/notifications";
import { type ClusterNode, getNodeLogs, getNodes, nodeCommand } from "../api";
import { useCan } from "../rbac/hooks";

const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);

interface LogsProps extends InnerModalProps {
	node: ClusterNode;
	/** the service shown first */
	service?: string;
}

const NodeLogsModal = EasyModal.create(({ node, service, visible, remove }: LogsProps) => {
	const { locale } = useLocaleState();
	const queryClient = useQueryClient();
	const [asked, setAsked] = useState<string | null>(null);
	const { data, isLoading, error } = useQuery({
		queryKey: ["nginxions-node-logs", node.id],
		queryFn: () => getNodeLogs(node.id),
		// while new logs are asked for: every 5 s, until they come
		refetchInterval: (query) => (asked && query.state.data?.collectedOn === asked ? 5000 : false),
	});
	const services = Object.keys(data?.logs ?? {}).sort();
	const [chosen, setChosen] = useState<string | null>(null);
	const shown = chosen ?? (service && services.includes(service) ? service : services[0]);
	const waiting = asked !== null && data?.collectedOn === asked;

	const collect = async () => {
		try {
			await nodeCommand(node.id, "collect_logs");
			setAsked(data?.collectedOn ?? "");
			showSuccess(t("nginxions.nodes.command.sent"));
			queryClient.invalidateQueries({ queryKey: ["nginxions-node-logs", node.id] });
		} catch (err: any) {
			showError(err.message);
		}
	};

	return (
		<Modal show={visible} onHide={remove} size="xl">
			<Modal.Header closeButton>
				<Modal.Title>
					<T id="nginxions.nodes.logs.title" data={{ name: node.name }} />
				</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				{error && <Alert variant="danger">{(error as Error).message}</Alert>}
				{isLoading ? (
					<LoadingPage noLogo />
				) : !data ? (
					<p className="text-secondary">
						<T id="nginxions.nodes.logs.none" />
					</p>
				) : (
					<>
						<p className="text-secondary">
							<T
								id="nginxions.nodes.logs.collected"
								data={{ time: formatDateTime(data.collectedOn, locale) }}
							/>
						</p>
						<ul className="nav nav-tabs">
							{services.map((s) => (
								<li className="nav-item" key={s}>
									<button
										type="button"
										className={`nav-link ${s === shown ? "active" : ""}`}
										onClick={() => setChosen(s)}
									>
										{s}
									</button>
								</li>
							))}
						</ul>
						<pre className="mt-2 small" style={{ maxHeight: "60vh", overflow: "auto" }}>
							{(shown ? data.logs[shown] : []).map((l, i) => (
								<div
									key={`${i}-${l.line.slice(0, 16)}`}
									className={l.stream === "stderr" ? "text-danger" : ""}
								>
									{l.line}
								</div>
							))}
						</pre>
					</>
				)}
			</Modal.Body>
			<Modal.Footer>
				<Button onClick={remove}>
					<T id="nginxions.common.close" />
				</Button>
				<Button actionType="primary" className="ms-auto" isLoading={waiting} onClick={collect}>
					<T id="nginxions.nodes.logs.collect" />
				</Button>
			</Modal.Footer>
		</Modal>
	);
});

export const showNodeLogs = (node: ClusterNode, service?: string) => EasyModal.show(NodeLogsModal, { node, service });

/** the server a page of the agents shows: "" (this server) or the id of a node */
export function NodePicker({ value, onChange }: { value: number; onChange: (id: number) => void }) {
	const can = useCan();
	const { data } = useQuery({ queryKey: ["nginxions-nodes"], queryFn: getNodes, enabled: can("nodes", "view") });
	const active = (data ?? []).filter((n) => n.status === "active");
	if (!active.length) return null;
	return (
		<select
			className="form-select form-select-sm w-auto"
			aria-label={t("nginxions.nodes.picker")}
			value={value}
			onChange={(e) => onChange(Number(e.target.value))}
		>
			<option value={0}>{t("nginxions.nodes.picker.this-server")}</option>
			{active.map((n) => (
				<option key={n.id} value={n.id}>
					{n.name}
				</option>
			))}
		</select>
	);
}

/** what a node tells of one of its services (openappsec, crowdsec), with its events, its logs and its agent */
export function NodeServiceView({ nodeId, service }: { nodeId: number; service: "openappsec" | "crowdsec" }) {
	const { locale } = useLocaleState();
	const can = useCan();
	const { data, isLoading } = useQuery({ queryKey: ["nginxions-nodes"], queryFn: getNodes, refetchInterval: 30000 });
	const node = data?.find((n) => n.id === nodeId);
	if (isLoading) return <LoadingPage noLogo />;
	if (!node) return null;
	const state = node.info.services?.[service];
	const restart = async () => {
		try {
			await nodeCommand(node.id, "restart_agent");
			showSuccess(t("nginxions.nodes.command.sent"));
		} catch (err: any) {
			showError(err.message);
		}
	};
	return (
		<div className="card mt-3">
			<div className="card-header">
				<h3 className="card-title">{node.name}</h3>
				<div className="card-actions">
					<a className="btn btn-sm me-2" href={`/waf/events?node=${node.uid}`}>
						<T id="nginxions.nodes.events" />
					</a>
					{can("services", "view") && (
						<Button size="sm" className="me-2" onClick={() => showNodeLogs(node, service)}>
							<T id="nginxions.nodes.logs" />
						</Button>
					)}
					{service === "openappsec" && can("nodes", "manage") && (
						<Button size="sm" disabled={!!node.command} onClick={restart}>
							<T
								id={node.command ? "nginxions.nodes.command.waiting" : "nginxions.nodes.restart-agent"}
							/>
						</Button>
					)}
				</div>
			</div>
			<div className="card-body">
				<dl className="row mb-0">
					<dt className="col-md-3">
						<T id={`nginxions.nodes.service.${service}`} />
					</dt>
					<dd className="col-md-9">
						{state ? (
							<span className={`badge ${state === "running" ? "bg-green-lt" : "bg-red-lt"}`}>
								{state}
							</span>
						) : (
							<span className="text-secondary">
								<T id="nginxions.nodes.service.unknown" />
							</span>
						)}
					</dd>
					<dt className="col-md-3">
						<T id="nginxions.nodes.last-seen" />
					</dt>
					<dd className="col-md-9">{node.lastSeenOn ? formatDateTime(node.lastSeenOn, locale) : "—"}</dd>
					{service === "openappsec" && (
						<>
							<dt className="col-md-3">
								<T id="nginxions.cluster.model" />
							</dt>
							<dd className="col-md-9 font-monospace">
								{node.info.modelSha256
									? `${node.info.modelSha256.slice(0, 12)}…`
									: t("nginxions.waf.model.basic")}
							</dd>
							<dt className="col-md-3">
								<T id="nginxions.cluster.profile" />
							</dt>
							<dd className="col-md-9 font-monospace">
								{node.info.profileVersion ? `${node.info.profileVersion.slice(0, 12)}…` : "—"}
							</dd>
						</>
					)}
				</dl>
				<p className="form-hint mb-0 mt-2">
					<T id="nginxions.nodes.view.hint" />
				</p>
			</div>
		</div>
	);
}
