import { pgSchema, uuid, varchar, boolean, text, timestamp } from 'drizzle-orm/pg-core';

export const gatewaySchema = pgSchema('gateway');

export const featureFlags = gatewaySchema.table('feature_flags', {
  id:          uuid('id').defaultRandom().primaryKey(),
  name:        varchar('name', { length: 100 }).notNull().unique(),
  enabled:     boolean('enabled').notNull().default(false),
  description: text('description'),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
