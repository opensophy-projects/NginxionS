import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useHealth } from "src/hooks";
import { T } from "src/locale";
import { type ReleaseCheck, checkRelease, getReleaseSettings, setAutoUpdate } from "../api";
import { useCan, useRbacMe } from "../rbac/hooks";
import styles from "./Shell.module.css";

const releaseSettingsKey = ["nginxions-release"];
const releaseStatus = {
	available: "nginxions.release.available",
	current: "nginxions.release.current",
	unavailable: "nginxions.release.unavailable",
	unpublished: "nginxions.release.unpublished",
} satisfies Record<ReleaseCheck["status"], string>;

export function ReleaseInfo() {
	const [open, setOpen] = useState(false);
	const current = useHealth().data?.version;
	const { data: actor } = useRbacMe();
	const can = useCan();
	const global = actor?.admin || actor?.scope === "all";
	const canCheck = global && can("settings");
	const canManage = global && can("settings", "manage");
	const client = useQueryClient();
	const settings = useQuery({
		queryKey: releaseSettingsKey,
		queryFn: getReleaseSettings,
		enabled: open && !!canCheck,
		retry: false,
	});
	const check = useMutation({ mutationFn: checkRelease });
	const save = useMutation({
		mutationFn: setAutoUpdate,
		onSuccess: (value) => {
			client.setQueryData(releaseSettingsKey, value);
		},
	});
	const tag = check.data?.tag;

	if (!current) return null;
	if (!canCheck) {
		return (
			<p className={styles.release}>
				<T id="nginxions.release.version" data={{ version: current }} />
			</p>
		);
	}
	return (
		<details className={styles.release} onToggle={(event) => setOpen(event.currentTarget.open)}>
			<summary>
				<T id="nginxions.release.version" data={{ version: current }} />
			</summary>
			<div className={styles.releaseActions}>
				<button
					type="button"
					className="btn btn-outline-secondary btn-sm"
					disabled={check.isPending}
					onClick={() => check.mutate()}
				>
					<T id="nginxions.release.check" />
				</button>
				<div aria-live="polite">
					{check.isError ? <T id="nginxions.release.unavailable" /> : null}
					{check.data ? <T id={releaseStatus[check.data.status]} data={{ version: tag ?? "" }} /> : null}
					{check.data?.status === "available" && tag && (
						<>
							{" "}
							<a
								href={`https://github.com/opensophy-projects/NginxionS/releases/tag/${encodeURIComponent(tag)}`}
								target="_blank"
								rel="noreferrer"
							>
								<T id="nginxions.release.notes" />
							</a>
						</>
					)}
				</div>
				{settings.data?.canAutoUpdate && canManage && (
					<label className={styles.releaseToggle}>
						<input
							type="checkbox"
							checked={settings.data.autoUpdate}
							disabled={save.isPending}
							onChange={(event) => save.mutate(event.target.checked)}
						/>
						<T id="nginxions.release.automatic" />
					</label>
				)}
				{settings.data?.canAutoUpdate && !canManage && (
					<T id={settings.data.autoUpdate ? "nginxions.release.auto-on" : "nginxions.release.auto-off"} />
				)}
				{settings.data && !settings.data.canAutoUpdate && <T id="nginxions.release.host-required" />}
				{settings.isError || save.isError ? <T id="nginxions.release.settings-error" /> : null}
			</div>
		</details>
	);
}
