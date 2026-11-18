// Parts of the toolbars and footers of the long lists (Events, Requests, Audit log): one export menu, one pager, one
// custom period, so that the lists behave alike.
import { IconChevronLeft, IconChevronRight, IconDownload } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { intl, T } from "src/locale";
import hostStyles from "../pages/Hosts/Hosts.module.css";
import eventStyles from "../pages/WafEvents/Events.module.css";
import { DateTimePicker } from "./DateTimePicker";
import { Dropdown } from "./Dropdown";

const t = (id: string) => intl.formatMessage({ id });

/** the export of a list as CSV or JSON */
export function ExportMenu({ onExport }: { onExport: (format: "csv" | "json") => void }) {
	return (
		<Dropdown
			floating
			inline
			ariaLabel={t("nginxions.events.export")}
			title={t("nginxions.events.export")}
			triggerClassName={hostStyles.tool}
			trigger={
				<>
					<IconDownload size={16} />
					<span className={hostStyles.toolText}>
						<T id="nginxions.events.export" />
					</span>
				</>
			}
			items={[
				{ key: "csv", label: "CSV", onSelect: () => onExport("csv") },
				{ key: "json", label: "JSON", onSelect: () => onExport("json") },
			]}
		/>
	);
}

/** the footer of a list: what it holds, and the newer and older pages */
export function Pager({
	total,
	extra,
	newer,
	older,
}: {
	total: ReactNode;
	/** next to the buttons, e.g. "page 2 of 5" */
	extra?: ReactNode;
	/** null: no newer (or older) page */
	newer: (() => void) | null;
	older: (() => void) | null;
}) {
	return (
		<div className={eventStyles.pager}>
			<span>{total}</span>
			<div className={eventStyles.pagerButtons}>
				{extra}
				<button type="button" className={hostStyles.tool} disabled={!newer} onClick={() => newer?.()}>
					<IconChevronLeft size={16} />
					<T id="nginxions.events.newer" />
				</button>
				<button type="button" className={hostStyles.tool} disabled={!older} onClick={() => older?.()}>
					<T id="nginxions.events.older" />
					<IconChevronRight size={16} />
				</button>
			</div>
		</div>
	);
}

/** a custom period: the start never after the end (or now), the end never before the start; no end is "now" */
export function CustomPeriod({
	from,
	to,
	onFrom,
	onTo,
}: {
	from: string;
	to: string | null;
	onFrom: (iso: string) => void;
	onTo: (iso: string | null) => void;
}) {
	return (
		<div className={eventStyles.custom}>
			<T id="nginxions.events.from" />
			<DateTimePicker
				label={t("nginxions.events.from")}
				value={from}
				max={to || new Date().toISOString()}
				onChange={(iso) => iso && onFrom(iso)}
			/>
			<T id="nginxions.events.to" />
			<DateTimePicker
				label={t("nginxions.events.to")}
				value={to ?? ""}
				min={from || undefined}
				placeholder={t("nginxions.date.now-placeholder")}
				clearable
				onChange={(iso) => onTo(iso || null)}
			/>
		</div>
	);
}
