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
    .references(() => quizAttemptTable.id), // Links to quiz attempt
  questionId: varchar('question_id', { length: 255 })
    .notNull()
    .references(() => questionTable.id), // Links to question
  userAnswer: text('user_answer').notNull(), // User's selected answer
  isCorrect: boolean('is_correct').notNull(), // Whether the answer was correct
  answeredAt: timestamp('answered_at', { mode: 'date' }).notNull().defaultNow(),
});

// === LLM Chat History Tables ===
// Chat Session Table: Stores individual chat sessions between user and LLM
export const chatSessionTable = mysqlTable('chat_session', {
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: varchar('user_id', { length: 255 })
    .notNull()
    .references(() => userTable.id), // Links to user
  startedAt: timestamp('started_at', { mode: 'date' }).notNull().defaultNow(),
});

// Chat Message Table: Stores individual messages in a chat session
export const chatMessageTable = mysqlTable('chat_message', {
  id: varchar('id', { length: 255 }).primaryKey(),
  chatSessionId: varchar('chat_session_id', { length: 255 })
    .notNull()
    .references(() => chatSessionTable.id), // Links to chat session
  sender: varchar('sender', { length: 50 }).notNull(), // 'user' or 'llm'
  content: text('content').notNull(), // The message content
  sentAt: timestamp('sent_at', { mode: 'date' }).notNull().defaultNow(),
});