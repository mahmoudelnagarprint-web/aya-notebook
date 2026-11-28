export type { AyaCollection, AyaMemoryEntry, AyaRow, AyaStore } from './aya-store-types';
export { BaseAyaStore, sortBy } from './aya-base';
export { MemoryAyaStore } from './memory-aya-store';
export {
  getSupabaseAdmin,
  isSupabaseConfigured,
  publicUploadUrl,
  supabaseUrl,
  type SupabaseEnv,
} from './supabase-client';
export { AYA_TABLES, SupabaseAyaStore } from './supabase-store';
// `createAyaStore()` lives at `@ayatodoist/database/create-store`: it lazy-loads
// the bun:sqlite adapter, so it must stay out of this serverless-safe barrel.
export { PrismaStore, isActivityRow } from './store';
export { SqliteStore, decodeRow, encodeRow } from './sqlite-store';

// The SQLite adapter lives at `@ayatodoist/database/sqlite` (it imports
// `bun:sqlite`); intentionally not re-exported here so this barrel stays
// bundleable for Node/Netlify Functions.
