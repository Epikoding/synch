import { describe, expect, it, vi } from "vitest";

import { BlobRepository } from "./repository";

describe("BlobRepository", () => {
	it("deletes all objects under a prefix in R2 list batches", async () => {
		const bucket = {
			list: vi
				.fn()
				.mockResolvedValueOnce({
					objects: [{ key: "vault-1/blob-a" }, { key: "vault-1/blob-b" }],
					truncated: true,
					cursor: "next-page",
				})
				.mockResolvedValueOnce({
					objects: [{ key: "vault-1/blob-c" }],
					truncated: false,
				}),
			delete: vi.fn(async () => {}),
		};
		const repository = new BlobRepository(bucket as unknown as R2Bucket);

		await repository.deleteByPrefix("vault-1/");

		expect(bucket.list).toHaveBeenNthCalledWith(1, {
			prefix: "vault-1/",
			cursor: undefined,
			limit: 1000,
		});
		expect(bucket.list).toHaveBeenNthCalledWith(2, {
			prefix: "vault-1/",
			cursor: "next-page",
			limit: 1000,
		});
		expect(bucket.delete).toHaveBeenNthCalledWith(1, [
			"vault-1/blob-a",
			"vault-1/blob-b",
		]);
		expect(bucket.delete).toHaveBeenNthCalledWith(2, ["vault-1/blob-c"]);
	});
});
