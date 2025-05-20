import { mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { userTable } from './auth';

// Chat Session Table: Stores individual chat sessions between user and LLM
export const chatSessionTable = mysqlTable('chat_session', {
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: varchar('user_id', { length: 255 })
    .notNull()
    .references(() => userTable.id),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
});

// Chat Message Table: Stores individual messages in a chat session
export const chatMessageTable = mysqlTable('chat_message', {
  id: varchar('id', { length: 255 }).primaryKey(),
  chatSessionId: varchar('chat_session_id', { length: 255 })
    .notNull()
    .references(() => chatSessionTable.id),
  role: varchar('sender', { length: 50 }).notNull(), // 'user' or 'assistant'
  content: text('content').notNull(), // The message content
  createdAt: timestamp('sent_at', { mode: 'date' }).notNull().defaultNow(),
});

export type ChatSessionTable = {
  id: string;
  userId: string;
  createdAt: Date;
};

export type ChatMessagesTable = {
  id: string;
  chatSessionId: string;
  role: string;
  content: string;
  createdAt: Date;
};
