import { beforeEach, describe, expect, it, vi } from "vitest";

const polarMocks = vi.hoisted(() => ({
	checkoutsCreate: vi.fn(),
	Polar: vi.fn(function Polar(this: unknown, config: unknown) {
		Object.assign(this as object, {
			config,
			checkouts: {
				create: polarMocks.checkoutsCreate,
			},
		});
	}),
}));

vi.mock("@polar-sh/sdk", () => ({
	Polar: polarMocks.Polar,
}));

import { createPolarCheckout } from "./polar";

describe("createPolarCheckout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates a starter checkout with organization metadata", async () => {
		polarMocks.checkoutsCreate.mockResolvedValueOnce({
			id: "checkout-1",
			url: "https://polar.example/checkout-1",
		});

		await expect(
			createPolarCheckout(
				{
					accessToken: "polar-token",
					wwwBaseUrl: "https://synch.example",
					sandbox: true,
				},
				{
					planId: "starter",
					productId: "starter-product",
					organizationId: "org-1",
					userId: "user-1",
					email: "user@example.com",
				},
			),
		).resolves.toEqual({
			checkoutId: "checkout-1",
			url: "https://polar.example/checkout-1",
		});

		expect(polarMocks.Polar).toHaveBeenCalledWith({
			accessToken: "polar-token",
			server: "sandbox",
		});
		expect(polarMocks.checkoutsCreate).toHaveBeenCalledWith({
			products: ["starter-product"],
			externalCustomerId: "user-1",
			customerEmail: "user@example.com",
			successUrl: "https://synch.example/billing/success?checkout_id={CHECKOUT_ID}",
			metadata: {
				referenceId: "org-1",
				organizationId: "org-1",
				userId: "user-1",
				planId: "starter",
			},
		});
	});

	it("requires a Polar access token", async () => {
		await expect(
			createPolarCheckout(
				{
					wwwBaseUrl: "https://synch.example",
				},
				{
					planId: "starter",
					productId: "starter-product",
					organizationId: "org-1",
					userId: "user-1",
					email: "user@example.com",
				},
			),
		).rejects.toThrow("POLAR_ACCESS_TOKEN is not configured");
		expect(polarMocks.checkoutsCreate).not.toHaveBeenCalled();
	});

	it("throws Polar checkout failures", async () => {
		polarMocks.checkoutsCreate.mockRejectedValueOnce(new Error("polar unavailable"));

		await expect(
			createPolarCheckout(
				{
					accessToken: "polar-token",
					wwwBaseUrl: "https://synch.example",
				},
				{
					planId: "starter",
					productId: "starter-product",
					organizationId: "org-1",
					userId: "user-1",
					email: "user@example.com",
				},
			),
		).rejects.toThrow("polar unavailable");
	});
});
