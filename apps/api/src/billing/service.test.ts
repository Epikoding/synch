import { beforeEach, describe, expect, it, vi } from "vitest";

const polarMocks = vi.hoisted(() => ({
	createPolarCheckout: vi.fn(),
}));

vi.mock("./polar", () => ({
	createPolarCheckout: polarMocks.createPolarCheckout,
}));

import type { BillingRepository } from "./repository";
import { BillingService } from "./service";

describe("BillingService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates starter checkout for the user's default organization", async () => {
		polarMocks.createPolarCheckout.mockResolvedValueOnce({
			checkoutId: "checkout-1",
			url: "https://polar.example/checkout-1",
		});
		const repository = fakeBillingRepository({
			defaultOrganizationId: "org-1",
			subscriptions: [],
		});
		const service = createBillingService(repository);

		await expect(
			service.createStarterCheckout({
				userId: "user-1",
				email: "user@example.com",
			}),
		).resolves.toEqual({
			checkoutId: "checkout-1",
			url: "https://polar.example/checkout-1",
		});
		expect(repository.readDefaultOrganizationIdForUser).toHaveBeenCalledWith("user-1");
		expect(polarMocks.createPolarCheckout).toHaveBeenCalledWith(
			expect.objectContaining({
				productId: "starter-product",
				wwwBaseUrl: "https://synch.example",
			}),
			{
				organizationId: "org-1",
				userId: "user-1",
				email: "user@example.com",
			},
		);
	});

	it("rejects starter checkout when the user has no organization", async () => {
		const service = createBillingService(fakeBillingRepository({
			defaultOrganizationId: null,
			subscriptions: [],
		}));

		await expect(
			service.createStarterCheckout({
				userId: "user-1",
				email: "user@example.com",
			}),
		).rejects.toThrow("user has no organization");
		expect(polarMocks.createPolarCheckout).not.toHaveBeenCalled();
	});

	it("reports starter billing status for a matching active product subscription", async () => {
		const service = createBillingService(fakeBillingRepository({
			defaultOrganizationId: "org-1",
			subscriptions: [
				{
					productId: "starter-product",
					status: "active",
					periodEnd: new Date(Date.now() + 60_000),
					updatedAt: new Date(),
				},
			],
		}));

		await expect(service.readBillingStatus("user-1")).resolves.toEqual({
			planId: "starter",
			active: true,
			status: "active",
		});
	});

	it("falls back to free billing status for unknown products", async () => {
		const service = createBillingService(fakeBillingRepository({
			defaultOrganizationId: "org-1",
			subscriptions: [
				{
					productId: "other-product",
					status: "active",
					periodEnd: new Date(Date.now() + 60_000),
					updatedAt: new Date(),
				},
			],
		}));

		await expect(service.readBillingStatus("user-1")).resolves.toEqual({
			planId: "free",
			active: false,
			status: "active",
		});
	});
});

function createBillingService(repository: BillingRepository): BillingService {
	return new BillingService(repository, {
		accessToken: "polar-token",
		productId: "starter-product",
		webhookSecret: "webhook-secret",
		publicBaseUrl: "https://api.synch.example",
		wwwBaseUrl: "https://synch.example",
	});
}

function fakeBillingRepository(input: {
	defaultOrganizationId: string | null;
	subscriptions: Awaited<
		ReturnType<BillingRepository["readOrganizationSubscriptionStatuses"]>
	>;
}): BillingRepository {
	return {
		readDefaultOrganizationIdForUser: vi.fn(async () => input.defaultOrganizationId),
		readOrganizationSubscriptionStatuses: vi.fn(async () => input.subscriptions),
	} as unknown as BillingRepository;
}
