// Learning profiles (Agents → open-appsec → Learning, step 15.5): what the agent learned of chosen sites, signed by
// this server. A profile is applied here (the learned state of its sites is replaced), downloaded and uploaded on
// another NginxionS (the key that signed it is shown), and on a manager one profile is given to new nodes: they start
// with the norm of the cluster instead of learning from nothing.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { useRef, useState } from "react";
import Alert from "react-bootstrap/Alert";
import Modal from "react-bootstrap/Modal";
import { Button, LoadingPage } from "src/components";
import { intl, T } from "src/locale";
import { showSuccess } from "src/notifications";
import { showConfirmModal } from "../modals/ConfirmModal";
import { dateTime } from "../ui/time";
import {
	applyLearningProfile,
	createLearningProfile,
	deleteLearningProfile,
	downloadLearningProfile,
	getLearningHosts,
	getLearningProfiles,
	getLearningSnapshots,
	type LearningProfile,
	setProfileForNewNodes,
	uploadLearningProfile,
} from "./api";
import styles from "./Learning.module.css";
import { SNAPSHOTS_KEY } from "./SnapshotsModal";

const t = (id: string, values?: Record<string, any>) => intl.formatMessage({ id }, values);
const PROFILES_KEY = "nginxions-learning-profiles";

interface Props extends InnerModalProps {
	/** takes and downloads (waf_learning:label) */
	label: boolean;
	/** applies, uploads, deletes (also waf_policy:manage) */
	manage: boolean;
	/** chooses the profile for new nodes (nodes:manage) */
	nodes: boolean;
}

/** the form of a new profile: its name and its sites */
function NewProfile({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
	const hosts = useQuery({ queryKey: ["nginxions-learning-hosts"], queryFn: getLearningHosts });
	const snapshots = useQuery({ queryKey: [SNAPSHOTS_KEY], queryFn: getLearningSnapshots });
	const [name, setName] = useState("");
	const [snapshot, setSnapshot] = useState("");
	const [chosen, setChosen] = useState<number[]>([]);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const toggle = (id: number) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
	const save = async () => {
		setBusy(true);
		setFailure(null);
		try {
			await createLearningProfile({
				name: name.trim(),
				host_ids: chosen,
				...(snapshot ? { snapshot_id: snapshot } : {}),
			});
			showSuccess(t("nginxions.learning.profiles.created"));
			onDone();
		} catch (err: any) {
			setFailure(err.message);
		}
		setBusy(false);
	};
	return (
		<div className="card card-body mb-3">
			<Alert variant="danger" show={!!failure} onClose={() => setFailure(null)} dismissible>
				{failure}
			</Alert>
			<label className="form-label" htmlFor="profile-name">
				<T id="nginxions.learning.profiles.name" />
			</label>
			<input
				id="profile-name"
				className="form-control mb-3"
				maxLength={100}
				autoComplete="off"
				value={name}
				onChange={(e) => setName(e.target.value)}
			/>
			<label className="form-label" htmlFor="profile-snapshot">
				<T id="nginxions.learning.profiles.from" />
			</label>
			<select
				id="profile-snapshot"
				className="form-select mb-3"
				value={snapshot}
				onChange={(e) => setSnapshot(e.target.value)}
			>
				<option value="">{t("nginxions.learning.profiles.from.now")}</option>
				{(snapshots.data?.snapshots ?? []).map((s) => (
					<option key={s.id} value={s.id}>
						{t("nginxions.learning.profiles.from.snapshot", { time: dateTime(s.takenOn) })}
					</option>
				))}
			</select>
			<div className="form-label">
				<T id="nginxions.learning.profiles.sites" />
			</div>
			{hosts.isLoading ? (
				<LoadingPage noLogo />
			) : (
				<div className={styles.profileSites}>
					{(hosts.data?.hosts ?? []).map((h) => (
						<label key={h.id} className="form-check">
							<input
								type="checkbox"
								className="form-check-input"
								checked={chosen.includes(h.id)}
								onChange={() => toggle(h.id)}
							/>
							<span className="form-check-label">{h.name}</span>
						</label>
					))}
				</div>
			)}
			<div className="d-flex gap-2 mt-3">
				<Button onClick={onCancel} disabled={busy}>
					<T id="cancel" />
				</Button>
				<Button
					actionType="primary"
					className="ms-auto"
					isLoading={busy}
					disabled={!name.trim() || !chosen.length}
					onClick={save}
				>
					<T id="nginxions.learning.profiles.create" />
				</Button>
			</div>
		</div>
	);
}

const ProfilesModal = EasyModal.create(({ label, manage, nodes, visible, remove }: Props) => {
	const queryClient = useQueryClient();
	const { data, isLoading, error } = useQuery({ queryKey: [PROFILES_KEY], queryFn: getLearningProfiles });
	const [failure, setFailure] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);
	const refresh = () => queryClient.invalidateQueries({ queryKey: [PROFILES_KEY] });

	const run = async (key: string, action: () => Promise<unknown>, done?: string) => {
		setBusy(key);
		setFailure(null);
		try {
			await action();
			if (done) showSuccess(t(done));
			refresh();
		} catch (err: any) {
			setFailure(err.message);
		}
		setBusy(null);
	};

	const apply = (p: LearningProfile) =>
		showConfirmModal({
			tTitle: "nginxions.learning.profiles.apply.title",
			tConfirm: "nginxions.learning.profiles.apply",
			danger: true,
			onConfirm: () =>
				run(`apply-${p.id}`, () => applyLearningProfile(p.id), "nginxions.learning.profiles.applied"),
			children: (
				<p className="mb-0">
					<T id="nginxions.learning.profiles.apply.text" data={{ name: p.name, sites: p.sites.length }} />
				</p>
			),
		});

	const removeProfile = (p: LearningProfile) =>
		showConfirmModal({
			tTitle: "nginxions.learning.profiles.delete.title",
			tConfirm: "nginxions.common.remove",
			danger: true,
			onConfirm: () => run(`delete-${p.id}`, () => deleteLearningProfile(p.id)),
			children: (
				<p className="mb-0">
					<T id="nginxions.learning.profiles.delete.text" data={{ name: p.name }} />
				</p>
			),
		});

	const upload = (file: File | undefined) => {
		if (fileRef.current) fileRef.current.value = "";
		if (file) run("upload", () => uploadLearningProfile(file), "nginxions.learning.profiles.uploaded");
	};

	return (
		<Modal show={visible} onHide={remove} size="xl">
			<Modal.Header closeButton>
				<Modal.Title>
					<T id="nginxions.learning.profiles.title" />
				</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				<Alert variant="danger" show={!!(failure || error)} onClose={() => setFailure(null)} dismissible>
					{failure || (error as Error)?.message}
				</Alert>
				<p className="text-secondary">
					<T id="nginxions.learning.profiles.text" />
				</p>
				{data?.fingerprint && (
					<p className={styles.muted}>
						<T id="nginxions.learning.profiles.key" data={{ fingerprint: data.fingerprint }} />
					</p>
				)}
				{creating && (
					<NewProfile
						onCancel={() => setCreating(false)}
						onDone={() => {
							setCreating(false);
							refresh();
						}}
					/>
				)}
				{isLoading ? (
					<LoadingPage noLogo />
				) : !data?.profiles.length ? (
					<p className="text-secondary mb-0">
						<T id="nginxions.learning.profiles.empty" />
					</p>
				) : (
					<div className="table-responsive">
						<table className="table table-vcenter table-sm">
							<thead>
								<tr>
									<th>
										<T id="nginxions.learning.profiles.name" />
									</th>
									<th>
										<T id="nginxions.learning.profiles.sites" />
									</th>
									<th>
										<T id="nginxions.learning.profiles.origin" />
									</th>
									<th />
								</tr>
							</thead>
							<tbody>
								{data.profiles.map((p) => (
									<tr key={p.id}>
										<td>
											<strong>{p.name}</strong>
											{p.forNewNodes && (
												<span className="badge bg-blue-lt ms-2">
													<T id="nginxions.learning.profiles.for-new-nodes" />
												</span>
											)}
											<div className={styles.muted}>{dateTime(p.createdOn)}</div>
											{p.appliedOn && (
												<div className={styles.muted}>
													<T
														id="nginxions.learning.profiles.applied-on"
														data={{ time: dateTime(p.appliedOn) }}
													/>
												</div>
											)}
										</td>
										<td>
											{p.sites.map((s) => s.domains.join(", ")).join("; ")}
											<div className={styles.muted}>
												<T
													id="nginxions.learning.snapshots.learned.value"
													data={{
														assets: p.assets.length,
														values: p.assets.reduce((n, a) => n + a.values, 0),
													}}
												/>
											</div>
										</td>
										<td>
											<T
												id={
													p.own
														? "nginxions.learning.profiles.origin.own"
														: "nginxions.learning.profiles.origin.import"
												}
												data={{ server: p.source?.server ?? "" }}
											/>
											<div className={styles.muted} title={p.fingerprint}>
												<T
													id="nginxions.learning.profiles.signed"
													data={{ fingerprint: p.fingerprint.slice(0, 23) }}
												/>
											</div>
										</td>
										<td className="text-end text-nowrap">
											{label && (
												<button
													type="button"
													className="btn btn-sm"
													onClick={() => downloadLearningProfile(p.id)}
												>
													<T id="nginxions.learning.snapshots.download" />
												</button>
											)}
											{nodes && p.own && (
												<button
													type="button"
													className="btn btn-sm ms-1"
													disabled={!!busy}
													onClick={() =>
														run(`nodes-${p.id}`, () =>
															setProfileForNewNodes(p.id, !p.forNewNodes),
														)
													}
												>
													<T
														id={
															p.forNewNodes
																? "nginxions.learning.profiles.for-new-nodes.off"
																: "nginxions.learning.profiles.for-new-nodes.on"
														}
													/>
												</button>
											)}
											{manage && (
												<>
													<button
														type="button"
														className="btn btn-sm ms-1"
														disabled={!!busy}
														onClick={() => apply(p)}
													>
														<T id="nginxions.learning.profiles.apply" />
													</button>
													<button
														type="button"
														className="btn btn-sm btn-ghost-danger ms-1"
														disabled={!!busy}
														onClick={() => removeProfile(p)}
													>
														<T id="nginxions.common.remove" />
													</button>
												</>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Modal.Body>
			<Modal.Footer>
				<Button onClick={remove}>
					<T id="nginxions.common.close" />
				</Button>
				{manage && (
					<>
						<input
							ref={fileRef}
							type="file"
							accept=".gz,application/gzip"
							className="d-none"
							aria-label={t("nginxions.learning.profiles.upload")}
							onChange={(e) => upload(e.target.files?.[0])}
						/>
						<Button
							className="ms-auto"
							isLoading={busy === "upload"}
							disabled={!!busy}
							onClick={() => fileRef.current?.click()}
						>
							<T id="nginxions.learning.profiles.upload" />
						</Button>
					</>
				)}
				{label && (
					<Button
						actionType="primary"
						className={manage ? "" : "ms-auto"}
						disabled={creating}
						onClick={() => setCreating(true)}
					>
						<T id="nginxions.learning.profiles.new" />
					</Button>
				)}
			</Modal.Footer>
		</Modal>
	);
});

export const showProfilesModal = (props: Omit<Props, keyof InnerModalProps>) => {
	EasyModal.show(ProfilesModal, props);
};
