#!/usr/bin/env node
// deploy/seccomp/nginxions.json: the default seccomp profile of Docker (moby/profiles, seccomp/default.json) with no
// SCTP sockets (deploy/seccomp/README.md). In the default profile socket() is allowed by address family; for IPv4 and
// IPv6 this one allows only stream, datagram and raw sockets whose protocol is not SCTP (132). SOCK_SEQPACKET of
// IPv4/IPv6 is SCTP even with protocol 0, it is refused too. Other families (unix, netlink, ...) stay as Docker has them.
//
//   node scripts/seccomp-profile.mjs <default.json of moby/profiles> deploy/seccomp/nginxions.json

import { readFileSync, writeFileSync } from "node:fs";

export const SCTP = 132;
const AF_INET = 2;
const AF_INET6 = 10;
// SOCK_STREAM, SOCK_DGRAM, SOCK_RAW; the flags of the type (SOCK_CLOEXEC, SOCK_NONBLOCK) are masked out
const TYPES = [1, 2, 3];

const inet = (domain) =>
	TYPES.map((type) => ({
		names: ["socket"],
		action: "SCMP_ACT_ALLOW",
		args: [
			{ index: 0, value: domain, op: "SCMP_CMP_EQ" },
			{ index: 1, value: 15, valueTwo: type, op: "SCMP_CMP_MASKED_EQ" },
			{ index: 2, value: SCTP, op: "SCMP_CMP_NE" },
		],
	}));

/** the profile of Docker with the rules of socket() for IPv4 and IPv6 replaced */
export const withoutSctp = (profile) => {
	const found = new Set();
	const syscalls = [];
	for (const rule of profile.syscalls) {
		const arg = rule.names?.length === 1 && rule.names[0] === "socket" ? rule.args?.[0] : null;
		if (arg && arg.index === 0 && arg.op === "SCMP_CMP_LT" && arg.value === 3) {
			// AF_UNSPEC, AF_UNIX and AF_INET: the first two as they were, AF_INET without SCTP
			syscalls.push({ ...rule, args: [{ index: 0, value: AF_INET, op: "SCMP_CMP_LT" }] }, ...inet(AF_INET));
			found.add(AF_INET);
		} else if (arg && arg.index === 0 && arg.op === "SCMP_CMP_EQ" && arg.value === AF_INET6) {
			syscalls.push(...inet(AF_INET6));
			found.add(AF_INET6);
		} else {
			if (rule.names?.includes("socket") && !rule.args?.length && rule.action === "SCMP_ACT_ALLOW") {
				throw new Error("the profile allows socket() without conditions: its layout changed, check this script");
			}
			syscalls.push(rule);
		}
	}
	if (found.size !== 2) throw new Error("the rules of socket() for IPv4 and IPv6 were not found: check this script");
	return { ...profile, syscalls };
};

if (import.meta.url === `file://${process.argv[1]}`) {
	const [src, dst] = process.argv.slice(2);
	if (!src || !dst) {
		console.error("usage: seccomp-profile.mjs <moby default.json> <out.json>");
		process.exit(1);
	}
	writeFileSync(dst, `${JSON.stringify(withoutSctp(JSON.parse(readFileSync(src, "utf8"))), null, 1)}\n`);
}
