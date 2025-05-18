import { mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const userTable = mysqlTable('user', {
  id: varchar('id', { length: 255 }).primaryKey(),
  username: varchar('username', { length: 255 }).notNull().unique(),
  password_hash: text('password_hash').notNull(),
});

export const sessionTable = mysqlTable('session', {
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: varchar('user_id', { length: 255 })
    .notNull()
    .references(() => userTable.id),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
});
