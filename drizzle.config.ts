import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.UNIFIED_LLM_DB_PATH || './data/chat-history.db',
  },
  verbose: true,
  strict: true,
});