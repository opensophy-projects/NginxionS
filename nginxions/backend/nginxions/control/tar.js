// The one file of a tar archive the Docker API answers for GET /containers/{id}/archive?path=<file>: nginxions-control
// reads the policy the agent applies from the agent's container this way (server.js), without sharing its files.
// A header of 512 bytes (the size in octal at 124, the time at 136), then the content.

/**
 * @param {Buffer} tar
 * @returns {{size: number, mtime: Date, content: Buffer}}
 */
export const untarOne = (tar) => {
	if (tar.length < 512) throw new Error("an empty archive");
	const octal = (offset, length) =>
		Number.parseInt(
			tar
				.subarray(offset, offset + length)
				.toString("ascii")
				.split("\0")[0]
				.trim() || "0",
			8,
		);
	const size = octal(124, 12);
	if (!Number.isFinite(size) || 512 + size > tar.length) throw new Error("a cut archive");
	return { size, mtime: new Date(octal(136, 12) * 1000), content: tar.subarray(512, 512 + size) };
};
