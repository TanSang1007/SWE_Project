import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'node prisma/seed.cjs' },
  datasource: { url: env('DIRECT_URL') },
});
