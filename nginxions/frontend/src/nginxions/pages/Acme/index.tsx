// Certificates → ACME: the ACME servers certificates come from (presets, your own, the default one) and the settings of
// their renewal. Moved here from Administration → Settings: everything about certificates is in one section. Changing
// them takes the permission of the settings (the account keys and EAB of a server serve every certificate).
import { HasPermission } from "src/components";
import { T } from "src/locale";
import { CERTIFICATES, VIEW } from "src/modules/Permissions";
import { AcmeServers } from "../../acme/AcmeServers";
import { useCan } from "../../rbac/hooks";
import { EnvSection, RestartBanner } from "../../system/EnvSection";
import hostStyles from "../Hosts/Hosts.module.css";

function AcmePage() {
	const can = useCan();
	return (
		<div className={hostStyles.page}>
			<div className={hostStyles.head}>
				<div>
					<h1 className={hostStyles.title}>ACME</h1>
					<p className={hostStyles.subtitle}>
						<T id="nginxions.acme.page.subtitle" />
					</p>
				</div>
			</div>
			<div className="card">
				<AcmeServers canManage={can("settings", "manage")} />
			</div>
			{can("settings", "view") && (
				<div className="card">
					<RestartBanner />
					<div className="px-4 pt-4">
						<h3 className="h4 m-0">
							<T id="nginxions.acme.page.renewal" />
						</h3>
					</div>
					<EnvSection group="acme" />
				</div>
			)}
		</div>
	);
}

const Acme = () => (
	<HasPermission section={CERTIFICATES} permission={VIEW} pageLoading loadingNoLogo>
		<AcmePage />
	</HasPermission>
);

export default Acme;
