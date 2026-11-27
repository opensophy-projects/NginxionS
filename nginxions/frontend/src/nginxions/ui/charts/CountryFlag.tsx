import { hasFlag } from "country-flag-icons";
// @ts-expect-error This package subpath has no TypeScript declaration.
import Flags from "country-flag-icons/react/3x2";
import styles from "./charts.module.css";
import { countryCode, countryName } from "./format";

export function CountryFlag({ code, fallback }: { code?: string; fallback?: string }) {
	const candidates = [code, fallback].map((value) => countryCode(value?.trim() ?? ""));
	const region = candidates.find(hasFlag);
	if (!region) return null;
	const Flag = (Flags as Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>>)[region];
	if (!Flag) return null;
	const name = countryName(region);
	return (
		<span title={name}>
			<Flag className={styles.flag} role="img" aria-label={name} />
		</span>
	);
}
