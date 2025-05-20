import {
  boolean,
  int,
  json,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core';
import { userTable } from './auth';

export const questionSetTable = mysqlTable('question_set', {
  id: varchar('id', { length: 255 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(), // e.g. "AI Ethnic Level 1", "AI Ethnic Level 2"
  description: text('description'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

export const questionTable = mysqlTable('question', {
  id: varchar('id', { length: 255 }).primaryKey(),
  questionSetId: varchar('question_set_id', { length: 255 })
    .notNull()
    .references(() => questionSetTable.id),
  type: varchar('type', { length: 50 }).notNull(), // 'single_selection' or 'true_false'
  content: text('content').notNull(),
  options: json('options'), // For single selection: array of options; for true/false: null
  correctAnswer: text('correct_answer').notNull(), //Correct option index or 'true'/'false'
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

export const quizAttemptTable = mysqlTable('quiz_attempt', {
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: varchar('user_id', { length: 255 })
    .notNull()
    .references(() => userTable.id),
  questionSetId: varchar('question_set_id', { length: 255 })
    .notNull()
    .references(() => questionSetTable.id),
  score: int('score').notNull().default(0),
  totalQuestions: int('total_question').notNull(),
  startedAt: timestamp('started_at', { mode: 'date' }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { mode: 'date' }),
});

// Quiz Answer Table: Stores user's answers for each question in a quiz attempt
export const quizAnswerTable = mysqlTable('quiz_answer', {
  id: varchar('id', { length: 255 }).primaryKey(),
  quizAttemptId: varchar('quiz_attempt_id', { length: 255 })
    .notNull()
    .references(() => quizAttemptTable.id),
  questionId: varchar('question_id', { length: 255 })
    .notNull()
    .references(() => questionTable.id), 
  userAnswer: text('user_answer').notNull(),
  isCorrect: boolean('is_correct').notNull(),
  answeredAt: timestamp('answered_at', { mode: 'date' }).notNull().defaultNow(),
});