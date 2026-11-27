import { useId } from "react";
import { intl, T } from "src/locale";
import { type PolicyObject, RULE_FIELDS, type RuleRefs } from "./api";
import { objectTitle } from "./names";
import styles from "./RefsEditor.module.css";

const fields = [
	"threatPreventionPractices",
	"accessControlPractices",
	"triggers",
	"customResponse",
	"exceptions",
	"sourceIdentifiers",
	"trustedSources",
] as const;

export function RefsEditor({
	value,
	onChange,
	objects,
	disabled,
}: {
	value: RuleRefs;
	onChange: (value: RuleRefs) => void;
	objects: PolicyObject[];
	disabled?: boolean;
}) {
	const id = useId();

	return (
		<div className={styles.fields}>
			{fields.map((field) => {
				const { kind, many } = RULE_FIELDS[field];
				const options = objects.filter((o) => o.kind === kind);
				const label = `nginxions.policy.rule.${field}`;
				if (field === "exceptions") {
					const ids = value.exceptions ?? [];
					return (
						<div className={styles.row} key={field}>
							<span id={`${id}-exceptions`} className={styles.label}>
								<T id={label} />
							</span>
							<div role="group" aria-labelledby={`${id}-exceptions`} className={styles.control}>
								{options.length ? (
									<details>
										<summary>
											<T id="nginxions.policy.exceptions-selected" data={{ count: ids.length }} />
										</summary>
										{options.map((o) => (
											<label className="form-check mt-2 mb-0" key={o.id}>
												<input
													className="form-check-input"
													type="checkbox"
													disabled={disabled}
													checked={ids.includes(o.id)}
													onChange={(e) =>
														onChange({
															...value,
															exceptions: e.target.checked
																? [...ids, o.id]
																: ids.filter((n) => n !== o.id),
														})
													}
												/>
												<span className="form-check-label">{objectTitle(o)}</span>
											</label>
										))}
									</details>
								) : (
									<span className="text-secondary">
										<T id="nginxions.policy.none" />
									</span>
								)}
							</div>
						</div>
					);
				}

				const current = value[field];
				const selected = Array.isArray(current) ? current[0] : current;

				return (
					<div className={styles.row} key={field}>
						<label className={styles.label} htmlFor={`${id}-${field}`}>
							<T id={label} />
						</label>
						<select
							id={`${id}-${field}`}
							className="form-select"
							disabled={disabled}
							value={selected ?? ""}
							onChange={(e) => {
								const next = e.target.value ? Number(e.target.value) : null;
								onChange({ ...value, [field]: many ? (next === null ? [] : [next]) : next });
							}}
						>
							<option value="">{intl.formatMessage({ id: "nginxions.policy.none" })}</option>
							{selected != null && !options.some((o) => o.id === selected) && (
								<option value={selected}>#{selected}</option>
							)}
							{options.map((o) => (
								<option key={o.id} value={o.id}>
									{objectTitle(o)}
								</option>
							))}
						</select>
					</div>
				);
			})}
		</div>
	);
}
