import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Modal } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { intl, T } from "src/locale";
import { showConfirmModal } from "../../modals/ConfirmModal";
import {
	createServiceToken,
	getServiceTokens,
	revokeServiceToken,
	type Role,
	type ServiceToken,
	updateServiceTokenRoles,
} from "../../rbac/api";
import { roleName } from "../../rbac/labels";
import styles from "./Roles.module.css";

const KEY = ["nginxions-service-tokens"];
const label = (name: string) => intl.formatMessage({ id: `nginxions.rbac.tokens.${name}` });
const message = (error: unknown) => (error instanceof Error ? error.message : label("error"));

function TokenEditor({
	token,
	roles,
	close,
	refresh,
}: {
	token: ServiceToken | null;
	roles: Role[];
	close: () => void;
	refresh: () => void;
}) {
	const [name, setName] = useState("");
	const [days, setDays] = useState(30);
	const [selected, setSelected] = useState(() => new Set(token?.roles));
	const [secret, setSecret] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const available = roles.filter((role) => role.builtin !== "administrator");
	const grants = available.filter(({ id }) => selected.has(id)).map(({ id }) => id);

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			if (token) {
				await updateServiceTokenRoles(token.id, grants);
				close();
			} else {
				setSecret((await createServiceToken({ name: name.trim(), roles: grants, expiresInDays: days })).secret);
			}
			refresh();
		} catch (err) {
			setError(message(err));
		} finally {
			setSaving(false);
		}
	};

	const copy = async (value: string) => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			setError(null);
		} catch {
			setCopied(false);
			setError(label("copy-error"));
		}
	};

	return (
		<Modal show onHide={saving ? undefined : close} backdrop={saving ? "static" : true}>
			<Modal.Header closeButton={!saving}>
				<Modal.Title>
					<T
						id={
							secret
								? "nginxions.rbac.tokens.created"
								: token
									? "nginxions.rbac.tokens.edit"
									: "nginxions.rbac.tokens.new"
						}
					/>
				</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				{error && <Alert variant="danger">{error}</Alert>}
				{secret ? (
					<>
						<p>
							<T id="nginxions.rbac.tokens.once" />
						</p>
						<input
							className="form-control font-monospace"
							aria-label={label("secret")}
							readOnly
							value={secret}
							onFocus={(event) => event.target.select()}
						/>
					</>
				) : (
					<fieldset disabled={saving}>
						{token ? (
							<p className="fw-semibold">{token.name}</p>
						) : (
							<>
								<label className="form-label w-100">
									<T id="nginxions.rbac.name" />
									<input
										className="form-control"
										value={name}
										maxLength={100}
										onChange={(event) => setName(event.target.value)}
									/>
								</label>
								<label className="form-label w-100">
									<T id="nginxions.rbac.tokens.days" />
									<input
										className="form-control"
										type="number"
										min={1}
										max={365}
										value={Number.isNaN(days) ? "" : days}
										onChange={(event) => setDays(event.target.valueAsNumber)}
									/>
								</label>
							</>
						)}
						<div className="mt-3">
							<p className="form-label">
								<T id="nginxions.rbac.roles" />
							</p>
							{available.map((role) => (
								<label className="form-check" key={role.id}>
									<input
										className="form-check-input"
										type="checkbox"
										checked={selected.has(role.id)}
										onChange={(event) => {
											const next = new Set(selected);
											if (event.target.checked) next.add(role.id);
											else next.delete(role.id);
											setSelected(next);
										}}
									/>
									<span className="form-check-label">{roleName(role)}</span>
								</label>
							))}
						</div>
					</fieldset>
				)}
			</Modal.Body>
			<Modal.Footer>
				<Button disabled={saving} onClick={close}>
					<T id={secret ? "action.close" : "cancel"} />
				</Button>
				{secret ? (
					navigator.clipboard && (
						<Button actionType="primary" onClick={() => copy(secret)}>
							<T id={copied ? "nginxions.rbac.tokens.copied" : "nginxions.rbac.tokens.copy"} />
						</Button>
					)
				) : (
					<Button
						actionType="primary"
						disabled={
							saving ||
							!grants.length ||
							(!token && (!name.trim() || !Number.isInteger(days) || days < 1 || days > 365))
						}
						onClick={save}
					>
						<T id={token ? "save" : "nginxions.rbac.create"} />
					</Button>
				)}
			</Modal.Footer>
		</Modal>
	);
}

export function ServiceTokens({ roles }: { roles: Role[] }) {
	const queryClient = useQueryClient();
	const { data, error, isLoading } = useQuery({ queryKey: KEY, queryFn: getServiceTokens });
	const [editor, setEditor] = useState<{ token: ServiceToken | null } | null>(null);
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: KEY });
	};
	const revoke = (token: ServiceToken) =>
		showConfirmModal({
			tTitle: "nginxions.rbac.tokens.revoke",
			tConfirm: "nginxions.rbac.tokens.revoke",
			danger: true,
			children: <T id="nginxions.rbac.tokens.revoke-hint" data={{ name: token.name }} />,
			onConfirm: async () => {
				await revokeServiceToken(token.id);
				refresh();
			},
		});

	return (
		<section className={`card ${styles.oidc}`}>
			<div className="d-flex justify-content-between align-items-center gap-3 flex-wrap">
				<h2 className={styles.cardTitle}>
					<T id="nginxions.rbac.tokens.title" />
				</h2>
				<Button
					actionType="primary"
					onClick={() => setEditor({ token: null })}
					disabled={!roles.some((role) => role.builtin !== "administrator")}
				>
					<T id="nginxions.rbac.tokens.new" />
				</Button>
			</div>
			<p className={styles.muted}>
				<T id="nginxions.rbac.tokens.hint" />
			</p>
			{error && <Alert variant="danger">{message(error)}</Alert>}
			{isLoading && <Loading noLogo />}
			{data?.length === 0 && (
				<p className={styles.muted}>
					<T id="nginxions.rbac.tokens.empty" />
				</p>
			)}
			{!!data?.length && (
				<div className={styles.scroller}>
					<table className="table table-vcenter">
						<thead>
							<tr>
								<th>
									<T id="nginxions.rbac.name" />
								</th>
								<th>
									<T id="nginxions.rbac.roles" />
								</th>
								<th>
									<T id="nginxions.rbac.tokens.expires" />
								</th>
								<th>
									<T id="column.status" />
								</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{data.map((token) => (
								<tr key={token.id}>
									<td>{token.name}</td>
									<td>
										{roles
											.filter(({ id }) => token.roles.includes(id))
											.map(roleName)
											.join(", ") || "—"}
									</td>
									<td>
										{intl.formatDate(token.expiresOn, { dateStyle: "medium", timeStyle: "short" })}
									</td>
									<td>
										<T id={`nginxions.rbac.tokens.status.${token.status}`} />
									</td>
									<td className="text-end">
										<div className="d-flex justify-content-end gap-2">
											{token.status === "active" && (
												<Button size="sm" onClick={() => setEditor({ token })}>
													<T id="action.permissions" />
												</Button>
											)}
											{!token.revokedOn && (
												<Button size="sm" onClick={() => revoke(token)}>
													<T id="nginxions.rbac.tokens.revoke" />
												</Button>
											)}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{editor && (
				<TokenEditor token={editor.token} roles={roles} close={() => setEditor(null)} refresh={refresh} />
			)}
		</section>
	);
}
