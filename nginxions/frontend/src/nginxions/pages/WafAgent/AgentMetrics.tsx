import { IconActivity, IconCpu, IconDeviceSdCard, IconShield } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Alert from "react-bootstrap/Alert";
import { LoadingPage } from "src/components";
import { intl, T } from "src/locale";
import { type AgentMetricPoint, getWafAgentMetrics } from "../../api";
import { AreaChart, type AreaSeries } from "../../ui/charts/AreaChart";
import { SearchField } from "../../ui/SearchField";
import styles from "./AgentMetrics.module.css";

const t = (id: string, values?: Record<string, any>) => intl.formatMessage({ id }, values);

const labelsOf = (labels: [string, string][]) => labels.map(([k, v]) => `${k}=${v}`).join(", ");

const minute = 60_000;
const time = (n: number) => intl.formatTime(n, { hour: "2-digit", minute: "2-digit" });
const number = (n: number) => intl.formatNumber(n, { maximumFractionDigits: 2 });
const percent = (n: number) => intl.formatNumber(n / 100, { style: "percent", maximumFractionDigits: 2 });
const memory = (n: number) => t("nginxions.metrics.mib", { value: number(n) });
const colors = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const metricsKey = (key: string) => `nginxions.metrics.${key}`;

function MetricChart({
	kind,
	data,
	value,
}: {
	kind: "cpu" | "rss" | "ips";
	data: AgentMetricPoint[];
	value?: number | null;
}) {
	const Icon = { cpu: IconCpu, rss: IconDeviceSdCard, ips: IconShield }[kind];
	const format = { cpu: percent, rss: memory, ips: number }[kind];
	const series: AreaSeries<AgentMetricPoint>[] = (
		kind === "ips" ? (["prevented", "detected", "ignored"] as const) : [kind]
	).map((key, i) => ({ key, label: t(metricsKey(key)), color: colors[i] }));
	return (
		<section className={`${styles.chart} ${kind === "ips" ? styles.wide : ""}`}>
			<div className={styles.chartHeading}>
				<Icon size={18} aria-hidden="true" />
				<h4>{t(metricsKey(kind))}</h4>
				{kind !== "ips" && <strong>{value == null ? "—" : format(value)}</strong>}
			</div>
			<p>{t(metricsKey(`${kind}.hint`))}</p>
			<AreaChart
				data={data}
				series={series}
				height={165}
				xLabel={(item) => time(item.time)}
				tooltipTitle={(item) => time(item.time)}
				format={format}
				legend={kind === "ips"}
				legendTotal="none"
				showSamples
				emptyText={t(metricsKey("no-samples"))}
				ariaLabel={t(metricsKey(kind))}
			/>
		</section>
	);
}

export function AgentMetricsCard() {
	const { data, isLoading, error } = useQuery({
		queryKey: ["nginxions-waf-agent-metrics"],
		queryFn: getWafAgentMetrics,
		refetchInterval: 60000,
	});
	const [q, setQ] = useState("");
	const points = data?.history ?? [];
	const latest = points.at(-1);
	const byMinute = new Map(points.map((p) => [p.time, p]));
	const history: AgentMetricPoint[] = latest
		? Array.from({ length: Math.min(60, 1 + Math.round((latest.time - points[0].time) / minute)) }, (_, i) => {
				const time = points[0].time + i * minute;
				return (
					byMinute.get(time) ?? { time, cpu: null, rss: null, prevented: null, detected: null, ignored: null }
				);
			})
		: [];
	const unavailable = error || !data?.reachable || data.error;
	const needle = q.trim().toLowerCase();
	const metrics = (data?.metrics ?? []).filter(
		(m) => !needle || m.name.toLowerCase().includes(needle) || m.help.toLowerCase().includes(needle),
	);
	return (
		<section className="card">
			<div className={`card-header ${styles.heading}`}>
				<h3 className="card-title">
					<IconActivity size={18} className="me-2" aria-hidden="true" />
					<T id="nginxions.waf.metrics" />
				</h3>
				<span className="text-secondary small">
					{data?.time ? t(metricsKey("updated"), { time: time(data.time) }) : null}
				</span>
			</div>
			<div className="card-body">
				{isLoading ? (
					<LoadingPage noLogo />
				) : (
					<>
						<p className="text-secondary small mb-3">{t(metricsKey("window"))}</p>
						{unavailable && (
							<Alert variant="warning">
								<T id="nginxions.waf.metrics.unreachable" />
								{` (${error?.message || data?.error || "—"})`}
							</Alert>
						)}
						<div className={styles.grid}>
							<MetricChart kind="cpu" data={history} value={latest?.cpu} />
							<MetricChart kind="rss" data={history} value={latest?.rss} />
							<MetricChart kind="ips" data={history} />
						</div>
						{!!data?.metrics?.length && (
							<details className={styles.technical}>
								<summary>{t(metricsKey("technical"))}</summary>
								<div className="my-3">
									<SearchField
										value={q}
										onChange={setQ}
										placeholder={t("nginxions.waf.metrics.search")}
									/>
								</div>
								<div className="table-responsive">
									<table className="table table-sm table-vcenter">
										<thead>
											<tr>
												<th>
													<T id="nginxions.waf.metrics.name" />
												</th>
												<th>
													<T id="nginxions.waf.metrics.labels" />
												</th>
												<th className="text-end">
													<T id="nginxions.waf.metrics.value" />
												</th>
											</tr>
										</thead>
										<tbody>
											{metrics.flatMap((m) =>
												m.samples.map((s, i) => (
													<tr key={`${m.name}-${labelsOf(s.labels)}`}>
														<td title={m.help}>{i === 0 ? m.name : ""}</td>
														<td className="text-secondary small">{labelsOf(s.labels)}</td>
														<td className="text-end">{intl.formatNumber(s.value)}</td>
													</tr>
												)),
											)}
										</tbody>
									</table>
								</div>
							</details>
						)}
					</>
				)}
			</div>
		</section>
	);
}
