import cn from "classnames";
import { useId, useState } from "react";
import { intl, T } from "src/locale";
import type { Counter } from "../../crowdsec/api";
import { t } from "../../crowdsec/labels";
import cardStyles from "../../pki/Pki.module.css";
import { BarList } from "../../ui/Charts";
import toggleStyles from "../AgentOpenappsec/Agent.module.css";
import styles from "./Crowdsec.module.css";

const messages = "nginxions.crowdsec.metrics";
const OPENAPPSEC_LOG = "/var/log/openappsec/cp-nano-http-transaction-handler.log";
const sourceNames: Record<string, string> = {
	"/var/log/nginxions/access.log": "source-access",
	"/var/log/nginxions/error.log": "source-error",
	[OPENAPPSEC_LOG]: "source-openappsec",
};
const chartLimit = 6;

function groupSources(rows: Counter[]): Counter[] {
	const values = new Map<string, number>();
	for (const { key, value } of rows) {
		const source = key.startsWith(OPENAPPSEC_LOG) ? OPENAPPSEC_LOG : key;
		values.set(source, (values.get(source) ?? 0) + value);
	}
	return [...values].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

export function MetricsPanel({ kind, rows }: { kind: "sources" | "overflows"; rows?: Counter[] }) {
	const [view, setView] = useState<"chart" | "table">("chart");
	const id = useId();
	const heading = `${messages}.${kind}`;
	const sources = kind === "sources";
	const ranked = sources ? groupSources(rows ?? []) : (rows ?? []);
	const empty = rows ? `${heading}.none` : `${messages}.none`;
	const items = ranked.slice(0, chartLimit).map(({ key, value }) => ({
		key: `counter:${key}`,
		label: sources && Object.hasOwn(sourceNames, key) ? t(`${messages}.${sourceNames[key]}`) : key || "—",
		title: key,
		value,
	}));
	const remaining = ranked.slice(chartLimit);
	if (remaining.length) {
		const label = t(`${messages}.other`, { count: remaining.length });
		items.push({
			key: "other",
			label,
			title: label,
			value: remaining.reduce((total, row) => total + row.value, 0),
		});
	}

	return (
		<section className={cn("card", cardStyles.card, styles.metric)} aria-labelledby={id}>
			<header className={styles.metricHeader}>
				<h3 id={id} className="card-title">
					<T id={heading} />
				</h3>
				<div className={toggleStyles.toggle} role="group" aria-labelledby={id}>
					{(["chart", "table"] as const).map((option) => (
						<button
							key={option}
							type="button"
							className={cn(toggleStyles.toggleItem, view === option && toggleStyles.toggleOn)}
							aria-pressed={view === option}
							onClick={() => setView(option)}
						>
							<T id={`${messages}.view.${option}`} />
						</button>
					))}
				</div>
			</header>
			<p className={styles.metricHint}>
				<T id={`${heading}.hint`} />
			</p>
			{!rows?.length ? (
				<p className={cardStyles.empty}>
					<T id={empty} />
				</p>
			) : view === "chart" ? (
				<BarList items={items} wrapLabels emptyText={t(empty)} format={(n) => intl.formatNumber(n)} />
			) : (
				<div className={styles.metricScroll}>
					<table className="table table-sm mb-0" aria-labelledby={id}>
						<thead>
							<tr>
								<th scope="col">
									<T id={sources ? `${messages}.file` : "nginxions.crowdsec.scenario"} />
								</th>
								<th scope="col" className="text-end">
									<T id={`${heading}.count`} />
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.map(({ key, value }) => (
								<tr key={key}>
									<td className="font-monospace">{key || "—"}</td>
									<td className="text-end">{intl.formatNumber(value)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}
