import { int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { userTable } from './auth';

export const userProfileTable = mysqlTable('profile', {
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: varchar('user_id', { length: 255 })
    .notNull()
    .references(() => userTable.id),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
  totalQuizzesTaken: int('total_quizzes_taken').notNull().default(0),
  highestScore: int('highest_score').notNull().default(0),
});
