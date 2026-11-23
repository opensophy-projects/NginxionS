// A limit of requests per client address for routes that hand out secrets or act as another user: the download of a
// certificate with its private key, the login as another user. Both need the token of an allowed user already; the
// limit stops a stolen or scripted session from pulling them in bulk. The model of the agent a node downloads from
// its manager (a large file read for each request) has it too. The login itself has its own (routes/tokens.js).
import { rateLimit } from "express-rate-limit";

const perClient = {
	windowMs: 60 * 1000,
	message: { error: { message: "Too many requests, please try again later." } },
	standardHeaders: "draft-8",
	legacyHeaders: false,
	ipv6Subnet: 48,
	validate: { trustProxy: false },
};

export const sensitiveLimiter = rateLimit({ ...perClient, limit: 30 });

// A node can send multiple batches of requests and events per heartbeat. Its agent also reads and writes
// learning files for every protected site. Give that traffic its own budget so it cannot starve heartbeats.
export const nodeLimiter = rateLimit({ ...perClient, limit: 300 });
export const nodeLearningLimiter = rateLimit({ ...perClient, limit: 6000 });
