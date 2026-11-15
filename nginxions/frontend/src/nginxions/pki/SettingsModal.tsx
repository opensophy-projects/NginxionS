// Certificates → Settings: what is set once for the whole section. The PKI (public address for CRLs and links,
// lifetimes, key type), the templates of certificates and when ACME certificates are renewed.
import EasyModal, { type InnerModalProps } from "ez-modal-react";
import cn from "classnames";
import { useState } from "react";
import Modal from "react-bootstrap/Modal";
import { T } from "src/locale";
import { useCan } from "../rbac/hooks";
import { EnvSection, RestartBanner } from "../system/EnvSection";
import { usePki } from "./api";
import { SettingsTab, TemplatesTab } from "./Sections";

type Tab = "pki" | "templates" | "renewal";

interface Props extends InnerModalProps {
	refresh: () => void;
}

const SettingsModal = EasyModal.create(({ visible, remove, refresh }: Props) => {
	const can = useCan();
	// read here, not passed in: a saved template shows at once
	const data = usePki({ enabled: can("pki", "view") }).data;
	const tabs: Tab[] = [
		...(data ? (["pki", "templates"] as Tab[]) : []),
		...(can("settings", "view") ? (["renewal"] as Tab[]) : []),
	];
	const [chosen, setTab] = useState<Tab | null>(null);
	const tab = chosen && tabs.includes(chosen) ? chosen : (tabs[0] ?? "renewal");
	return (
		<Modal show={visible} onHide={remove} size="xl">
			<Modal.Header closeButton>
				<Modal.Title>
					<T id="nginxions.certs.settings" />
				</Modal.Title>
			</Modal.Header>
			<Modal.Body className="d-flex flex-column gap-3">
				<ul className="nav nav-tabs flex-nowrap overflow-auto">
					{tabs.map((x) => (
						<li className="nav-item" key={x}>
							<button
								type="button"
								className={cn("nav-link text-nowrap", { active: tab === x })}
								onClick={() => setTab(x)}
							>
								<T id={`nginxions.certs.settings.${x}`} />
							</button>
						</li>
					))}
				</ul>
				{tab === "pki" && data && <SettingsTab data={data} refresh={refresh} />}
				{tab === "templates" && data && <TemplatesTab data={data} refresh={refresh} />}
				{tab === "renewal" && (
					<div>
						<RestartBanner />
						<EnvSection group="acme" />
					</div>
				)}
			</Modal.Body>
		</Modal>
	);
});

export const showCertSettingsModal = (props: Omit<Props, keyof InnerModalProps>) =>
	EasyModal.show(SettingsModal, props);
