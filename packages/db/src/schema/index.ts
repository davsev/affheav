// Drizzle schema definitions — populated as services are extracted in Phases 5–10
// Each service adds its tables here, scoped to its PostgreSQL schema.
//
// Example (Phase 6 — Auth):
//   import { pgSchema } from 'drizzle-orm/pg-core';
//   export const authSchema = pgSchema('auth');
//   export const sessions = authSchema.table('sessions', { ... });

export * from './gateway.js';
