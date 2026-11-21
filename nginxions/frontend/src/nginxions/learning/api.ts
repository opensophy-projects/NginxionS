// Learning of the agent (/api/nginxions/learning/*), see nginxions/backend/nginxions/learning
import * as api from "src/api/backend/base";

export type Decision = "benign" | "malicious" | "dismiss";
export type ScopeType = "parameterValue" | "parameterName" | "url" | "source";
export type Reason = "blocked" | "grey" | "detected";

export interface Scope {
	type: ScopeType;
	value: string;
}

export interface QueueGroup {
	key: string;
	hostId: number;
	hostName: string;
	hostMode: string | null;
	host: string;
	uri: string;
	parameter: string;
	indicators: string;
	incidentType: string;
	sample: string;
	eventId: number | null;
	events: number;
	sources: number;
	blocked: number;
	score: number | null;
	first: string | null;
	last: string | null;
	reason: Reason;
	new: boolean;
	scopes: Scope[];
}

export interface Suggestion {
	id: string;
	asset: string;
	hostId: number;
	hostName: string;
	type: ScopeType;
	title: string;
	severity: string;
	attackTypes: string[];
	metrics: { name: string; value: number }[];
}

export interface Queue {
	period: string;
	total: number;
	counts: Record<Reason, number>;
	limit: number;
	offset: number;
	items: QueueGroup[];
	suggestions: Suggestion[];
	suggestionsError: string | null;
}

interface GroupDetails extends QueueGroup {
	sourceList: { ip: string; events: number }[];
	labelled: boolean;
}

export interface Label {
	id: number;
	createdOn: string;
	user: { id: number; name: string } | null;
	origin: "group" | "tuning";
	hostId: number | null;
	host: string;
	decision: Decision;
	scopes: Scope[];
	features: Record<string, any>;
	note: string;
	exception: boolean;
	exceptionActive: boolean;
	expiresOn: string | null;
	banned: string[];
	banDuration: string;
	syncedOn: string | null;
	syncError: string;
	undoneOn: string | null;
	undoneBy: { id: number; name: string } | null;
}

interface LabelsPage {
	items: Label[];
	total: number;
	limit: number;
	offset: number;
}

interface HostStats {
	readiness: string;
	level: number;
	recommendation: string;
	ready: boolean;
	requests: number;
	elapsed: string;
	sources?: number;
	urls?: number;
	legitimate?: number;
	malicious?: number;
}

export interface LearningHost {
	id: number;
	name: string;
	mode: string;
	minimumConfidence: string;
	stats: HostStats | null;
	labels: { benign: number; malicious: number; dismiss: number; exceptions: number };
	enforced: number;
	falsePositives: { before: number; after: number };
	queue: number;
	readyToPrevent: boolean;
	/** the open trial of blocking (running, or finished and waiting for a decision) */
	trial: WafTrial | null;
}

/** trial mode of a host: blocking tried on the log only, then a report (waf/trial.js) */
export interface WafTrial {
	id: number;
	hostId: number;
	mode: string;
	startedOn: string;
	endsOn: string;
	state: "running" | "finished" | "closed";
	outcome: "enabled" | "dismissed" | "cancelled" | null;
}

export const TRIAL_HOURS = [1, 6, 24, 72, 168] as const;

interface LabelInput {
	key?: string;
	/** an event of the group (the group of an event card may be out of the queue) */
	eventId?: number;
	suggestion?: Suggestion;
	decision: Decision;
	scopes?: Scope[];
	exception?: boolean;
	ttlDays?: number;
	ban?: boolean;
	banDuration?: string;
	note?: string;
}

export const TTL_DAYS = [7, 14, 30, 90, 0];
export const BAN_DURATIONS = ["1h", "4h", "24h", "168h", "720h"];

export const getQueue = (params: Record<string, string | number | undefined>): Promise<Queue> =>
	api.get({ url: "/nginxions/learning/queue", params });

export const getGroup = (key: string): Promise<GroupDetails> =>
	api.get({ url: `/nginxions/learning/groups/${encodeURIComponent(key)}` });

export const getEventGroup = (eventId: string | number): Promise<GroupDetails> =>
	api.get({ url: `/nginxions/learning/events/${eventId}/group` });

export const getLabels = (params: Record<string, string | number | undefined>): Promise<LabelsPage> =>
	api.get({ url: "/nginxions/learning/labels", params });

export const createLabel = (data: LabelInput): Promise<Label | { id: number }> =>
	api.post({ url: "/nginxions/learning/labels", data });

export const undoLabel = (id: number): Promise<{ ok: boolean }> => api.del({ url: `/nginxions/learning/labels/${id}` });

export const getLearningHosts = (): Promise<{ hosts: LearningHost[]; tenant: string | null; error: string | null }> =>
	api.get({ url: "/nginxions/learning/hosts" });

export const getWafTrial = (
	hostId: number,
): Promise<{ trial: WafTrial | null; report: import("../policy/api").Simulation | null }> =>
	api.get({ url: `/nginxions/waf/hosts/${hostId}/trial` });

export const startWafTrial = (hostId: number, hours: number) =>
	api.post({ url: `/nginxions/waf/hosts/${hostId}/trial`, data: { hours } });

export const finishWafTrial = (hostId: number, enable: boolean) =>
	api.put({ url: `/nginxions/waf/hosts/${hostId}/trial`, data: { enable } });

/** what the WAF of the agent counts as normal for a parameter */
export interface LearnedParam {
	param: string;
	values: string[];
}

export interface LearnedAsset {
	asset: string;
	updatedOn: string | null;
	indicators?: LearnedParam[];
	types?: LearnedParam[];
	trustedIndicators?: LearnedParam[];
	trustedTypes?: LearnedParam[];
}

/** what the agent learned on a host: statistics and, per asset, the normal indicators and types of parameters */
export const getLearned = (
	hostId: number,
): Promise<{ id: number; name: string; stats: HostStats | null; assets: LearnedAsset[]; error: string | null }> =>
	api.get({ url: `/nginxions/learning/hosts/${hostId}/learned` });

// ---- snapshots of what the agent learned ----
export type SnapshotReason = "auto" | "manual" | "before-restore" | "import";

export interface LearningShift {
	asset: string;
	before: number;
	after: number;
	direction: "growth" | "drop";
}

export interface LearningSnapshot {
	id: string;
	takenOn: string;
	reason: SnapshotReason;
	userId: number;
	size: number;
	files: number;
	/** files of the learning put together from the nodes (a manager with nodes), restored with the snapshot */
	cluster?: number;
	assets: { asset: string; params: number; values: number }[];
	shift: LearningShift[];
	comparedWith: string | null;
	sourceTakenOn: string | null;
	restoredOn: string | null;
}

export const getLearningSnapshots = (): Promise<{ snapshots: LearningSnapshot[]; keepAuto: number }> =>
	api.get({ url: "/nginxions/learning/snapshots" });

export const takeLearningSnapshot = (): Promise<LearningSnapshot> => api.post({ url: "/nginxions/learning/snapshots" });

export const restoreLearningSnapshot = (id: string): Promise<{ restored: string; before: string }> =>
	api.post({ url: `/nginxions/learning/snapshots/${encodeURIComponent(id)}/restore` });

export const deleteLearningSnapshot = (id: string) =>
	api.del({ url: `/nginxions/learning/snapshots/${encodeURIComponent(id)}` });

export const downloadLearningSnapshot = (id: string) =>
	api.download(
		{ url: `/nginxions/learning/snapshots/${encodeURIComponent(id)}/download` },
		`nginxions-learning-${id}.json.gz`,
	);

/** a file (a snapshot, a profile) as the body of a POST; the error of the backend as the message */
const uploadFile = async (url: string, file: File) => {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/octet-stream" },
		body: file,
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
	return payload;
};

export const uploadLearningSnapshot = (file: File): Promise<LearningSnapshot> =>
	uploadFile("/api/nginxions/learning/snapshots/upload", file);

/** the shift of the latest snapshot (automatic or manual) of the last two days: what the page warns about */
export const recentShift = (snapshots: LearningSnapshot[], now = Date.now()) => {
	const latest = snapshots.find((s) => s.reason === "auto" || s.reason === "manual");
	if (!latest || now - new Date(latest.takenOn).getTime() > 2 * 24 * 3600 * 1000) return null;
	return latest.shift.length ? latest : null;
};

// ---- learning profiles: what the agent learned of chosen sites, signed, applied here, elsewhere or on new nodes ----
export interface LearningProfile {
	id: string;
	name: string;
	createdOn: string;
	/** taken here, or uploaded (made on another NginxionS) */
	origin: "taken" | "import";
	source: { server: string; snapshot: string | null } | null;
	sites: { domains: string[] }[];
	/** the WAF of its sites it carries (sites, policy objects), or null */
	policy: { sites: number; objects: number } | null;
	assets: { asset: string; params: number; values: number }[];
	files: number;
	size: number;
	version: string;
	/** the key that signed it (SHA-256), and whether it is the key of this server */
	fingerprint: string;
	own: boolean;
	/** the profile new nodes of this manager start with */
	forNewNodes: boolean;
	appliedOn: string | null;
}

export const getLearningProfiles = (): Promise<{ profiles: LearningProfile[]; fingerprint: string }> =>
	api.get({ url: "/nginxions/learning/profiles" });

export const createLearningProfile = (data: {
	name: string;
	host_ids: number[];
	snapshot_id?: string;
	/** the WAF of the sites goes with it (to move them to another cluster) */
	with_policy?: boolean;
}): Promise<LearningProfile> => api.post({ url: "/nginxions/learning/profiles", data });

/** what applying the WAF of a profile did */
export interface ProfilePolicyResult {
	sites: number;
	created: string[];
	missing: string[];
	notFound: string[];
}

export const applyLearningProfile = (
	id: string,
	opts: { hostIds?: number[]; withPolicy?: boolean } = {},
): Promise<{ assets: string[]; policy: ProfilePolicyResult | null }> =>
	api.post({
		url: `/nginxions/learning/profiles/${encodeURIComponent(id)}/apply`,
		data: {
			...(opts.hostIds?.length ? { host_ids: opts.hostIds } : {}),
			...(opts.withPolicy ? { with_policy: true } : {}),
		},
	});

export const setProfileForNewNodes = (id: string, on: boolean): Promise<LearningProfile> =>
	api.put({ url: `/nginxions/learning/profiles/${encodeURIComponent(id)}`, data: { for_new_nodes: on } });

export const deleteLearningProfile = (id: string) =>
	api.del({ url: `/nginxions/learning/profiles/${encodeURIComponent(id)}` });

export const downloadLearningProfile = (id: string) =>
	api.download(
		{ url: `/nginxions/learning/profiles/${encodeURIComponent(id)}/download` },
		`nginxions-profile-${id}.json.gz`,
	);

export const uploadLearningProfile = (file: File): Promise<LearningProfile> =>
	uploadFile("/api/nginxions/learning/profiles/upload", file);
