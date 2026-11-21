// The WAF policy of the sites of a learning profile (docs/ROADMAP.md, phase 15, step 15.5): with the learned state,
// a profile can carry how each site is protected, to move it between clusters. Ids of objects differ between servers,
// so the profile names them (kind and name) and carries the objects of the administrator themselves; built-in objects
// are on every server. Applied on another server: a site is found by its domains, an object of the same kind and name
// there is used as it is (never overwritten), a missing one is created.

/** the references of a policy ({field: id | [id]}) as names: {field: {kind, name} | [{kind, name}]} */
export const refsByName = (objects, byId) => {
	if (!objects) return null;
	const out = {};
	for (const [field, value] of Object.entries(objects)) {
		if (field === "template") {
			out.template = value;
			continue;
		}
		const name = (id) => {
			const o = byId.get(Number(id));
			return o ? { kind: o.kind, name: o.name } : null;
		};
		out[field] = Array.isArray(value) ? value.map(name).filter(Boolean) : name(value);
	}
	return out;
};

/** names back to ids of this server ({kind, name} → id); what is not here is left out and named */
export const refsById = (refs, objects) => {
	if (!refs) return { objects: null, missing: [] };
	const missing = [];
	const idOf = (r) => {
		const found = r && objects.find((o) => o.kind === r.kind && o.name === r.name);
		if (r && !found) missing.push(`${r.kind}/${r.name}`);
		return found?.id ?? null;
	};
	const out = {};
	for (const [field, value] of Object.entries(refs)) {
		if (field === "template") out.template = value;
		else if (Array.isArray(value)) out[field] = value.map(idOf).filter((id) => id !== null);
		else if (value) {
			const id = idOf(value);
			if (id !== null) out[field] = id;
		}
	}
	return { objects: out, missing };
};

/** the objects of the administrator a policy names (built-in ones are on every server) */
const namedObjects = (refs, byKey) => {
	const out = [];
	for (const [field, value] of Object.entries(refs ?? {})) {
		if (field === "template") continue;
		for (const r of Array.isArray(value) ? value : [value]) {
			const o = r && byKey.get(`${r.kind}/${r.name}`);
			if (o && !o.builtin)
				out.push({ kind: o.kind, name: o.name, description: o.description ?? "", spec: o.spec });
		}
	}
	return out;
};

/**
 * The WAF of each site, as a profile carries it.
 * @param {{id: number, domains: string[]}[]} sites
 * @param {(id: number) => Promise<object>} getWaf  the WAF of a host (waf/hosts.js get)
 * @param {object[]} objects  the policy objects of this server
 */
export const policyOfSites = async (sites, getWaf, objects) => {
	const byId = new Map(objects.map((o) => [o.id, o]));
	const byKey = new Map(objects.map((o) => [`${o.kind}/${o.name}`, o]));
	const out = [];
	const carried = new Map();
	for (const site of sites) {
		const waf = await getWaf(site.id);
		const refs = refsByName(waf.objects, byId);
		const locations = (waf.locations ?? []).map((l) => ({
			path: l.path,
			inherit: Boolean(l.inherit),
			enabled: Boolean(l.enabled),
			mode: l.mode,
			minimum_confidence: l.minimum_confidence,
			objects: l.inherit ? null : refsByName(l.objects, byId),
		}));
		for (const o of [refs, ...locations.map((l) => l.objects)].flatMap((r) => namedObjects(r, byKey))) {
			carried.set(`${o.kind}/${o.name}`, o);
		}
		out.push({
			domains: site.domains,
			enabled: Boolean(waf.enabled),
			mode: waf.mode,
			minimum_confidence: waf.minimum_confidence,
			objects: refs,
			locations,
		});
	}
	return { sites: out, objects: [...carried.values()] };
};

/**
 * The WAF of the sites of a profile on this server.
 * @param {{sites: object[], objects: object[]}} policy  of the profile
 * @param {{hosts: {id: number, domains: string[]}[], objects: () => Promise<object[]>,
 *   createObject: (o: object) => Promise<void>, setWaf: (id: number, data: object) => Promise<void>}} io
 * @returns {Promise<{sites: number, created: string[], missing: string[], notFound: string[]}>}
 */
export const applyPolicy = async (policy, io) => {
	const created = [];
	let objects = await io.objects();
	for (const o of policy?.objects ?? []) {
		if (objects.some((x) => x.kind === o.kind && x.name === o.name)) continue;
		await io.createObject(o);
		created.push(`${o.kind}/${o.name}`);
	}
	if (created.length) objects = await io.objects();
	const missing = new Set();
	const notFound = [];
	let applied = 0;
	for (const site of policy?.sites ?? []) {
		const host = io.hosts.find((h) => h.domains.some((d) => site.domains.includes(d)));
		if (!host) {
			notFound.push(site.domains.join(", "));
			continue;
		}
		const own = refsById(site.objects, objects);
		for (const m of own.missing) missing.add(m);
		const locations = (site.locations ?? []).map((l) => {
			const refs = l.inherit ? { objects: null, missing: [] } : refsById(l.objects, objects);
			for (const m of refs.missing) missing.add(m);
			return {
				path: l.path,
				inherit: l.inherit,
				enabled: l.enabled,
				mode: l.mode,
				minimum_confidence: l.minimum_confidence,
				...(l.inherit ? {} : { objects: refs.objects }),
			};
		});
		await io.setWaf(host.id, {
			enabled: site.enabled,
			mode: site.mode,
			minimum_confidence: site.minimum_confidence,
			objects: own.objects,
			locations,
		});
		applied += 1;
	}
	return { sites: applied, created, missing: [...missing], notFound };
};
