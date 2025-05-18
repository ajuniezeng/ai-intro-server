import { DrizzleMySQLAdapter } from '@lucia-auth/adapter-drizzle';
import { drizzle } from 'drizzle-orm/mysql2';
import { z } from 'zod';
import { sessionTable, userTable } from './db/schemas/auth';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
});

const processEnv = EnvSchema.parse(process.env);

export const db = drizzle(processEnv.DATABASE_URL);

export const adapter = new DrizzleMySQLAdapter(
  db,
  sessionTable,
  userTable,
)