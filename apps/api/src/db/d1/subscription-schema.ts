import { relations, sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { organization } from "./auth-schema";

export const polarSubscription = sqliteTable(
	"polar_subscription",
	{
		id: text("id").primaryKey(),
		productId: text("product_id").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		polarCustomerId: text("polar_customer_id").notNull(),
		polarSubscriptionId: text("polar_subscription_id").notNull(),
		polarCheckoutId: text("polar_checkout_id"),
		status: text("status").notNull(),
		periodStart: integer("period_start", { mode: "timestamp_ms" }),
		periodEnd: integer("period_end", { mode: "timestamp_ms" }),
		cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
			.default(false)
			.notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("polar_subscription_organizationId_idx").on(table.organizationId),
		index("polar_subscription_customerId_idx").on(table.polarCustomerId),
		index("polar_subscription_status_idx").on(table.status, table.periodEnd),
		uniqueIndex("polar_subscription_polarSubscriptionId_uidx").on(
			table.polarSubscriptionId,
		),
	],
);

export const polarSubscriptionRelations = relations(
	polarSubscription,
	({ one }) => ({
		organization: one(organization, {
			fields: [polarSubscription.organizationId],
			references: [organization.id],
		}),
	}),
);
