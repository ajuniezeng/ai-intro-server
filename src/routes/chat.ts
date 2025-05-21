import { Hono } from 'hono';
import type { Context } from '../context';
import { loggedIn } from '../middleware/loggedIn';
import { zValidator } from '@hono/zod-validator';
import {
  chatMessageSchema,
  type ChatMessage,
  type SuccessResponse,
} from '../types';
import { requestOpenAiChatCompletionsApi } from '../lib/llm';
import { db } from '../adapter';
import {
  chatMessageTable,
  chatSessionTable,
  type ChatMessagesTable,
  type ChatSessionTable,
} from '../db/schemas/chat';
import { randomUUIDv7 } from 'bun';
import { HTTPException } from 'hono/http-exception';
import { eq, inArray } from 'drizzle-orm';

type ChatHistory = {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
};

export const chatRouter = new Hono<Context>()
  .post(
    '/completions',
    zValidator('form', chatMessageSchema),
    loggedIn,
    async (c) => {
      const serverReceivedTimestamp = new Date(); // Capture server-side timestamp
      const message = c.req.valid('form');
      const user = c.get('user')!;

      try {
        const res = await requestOpenAiChatCompletionsApi([message]);
        const chatSession: ChatSessionTable = {
          id: res.id,
          userId: user.id,
          createdAt: new Date(res.created * 1000),
        };

        const chatMessageFromUser: ChatMessagesTable = {
          id: randomUUIDv7(),
          chatSessionId: res.id,
          role: message.role,
          content: message.content,
          createdAt: serverReceivedTimestamp, // Use server-side timestamp
        };

        const completions = res.choices.map((item) => item.message).join();
        const chatMessageFromLlm: ChatMessagesTable = {
          id: randomUUIDv7(),
          chatSessionId: res.id,
          role: 'assistant',
          content: completions,
          createdAt: new Date(res.created * 1000),
        };

        await db.transaction(async (tx) => {
          await tx.insert(chatSessionTable).values(chatSession);
          await tx.insert(chatMessageTable).values(chatMessageFromUser);
          await tx.insert(chatMessageTable).values(chatMessageFromLlm);
        });

        return c.json<SuccessResponse<ChatMessage>>(
          {
            success: true,
            message: 'Successfully generate chat completions',
            data: {
              role: 'assistant',
              content: completions,
            },
          },
          200,
        );
      } catch (err) {
        console.error('Error in POST /completions:');
        console.error(err);
        
        throw new HTTPException(500, {
          message: 'An unexpected error occurred while processing your request.',
        });
      }
    },
  )
  .get('/history', loggedIn, async (c) => {
    const user = c.get('user')!;

    const sessionIds = await db
      .select({ id: chatSessionTable.id })
      .from(chatSessionTable)
      .where(eq(chatSessionTable.userId, user.id));

    if (sessionIds.length === 0) {
      return c.json<SuccessResponse<ChatHistory[]>>({
        success: true,
        message: 'Successfully fetch chat history',
        data: [],
      });
    }

    const uniqueSessionIds = sessionIds.map((session) => session.id);

    const messages = await db
      .select()
      .from(chatMessageTable)
      .where(inArray(chatMessageTable.chatSessionId, uniqueSessionIds))
      .orderBy(chatMessageTable.createdAt); // Sort messages by createdAt

    return c.json<SuccessResponse<ChatHistory[]>>({
      success: true,
      message: 'Successfully fetch chat history',
      data: messages.map((item) => {
        return {
          id: item.chatSessionId,
          role: item.role,
          content: item.content,
          createdAt: item.createdAt,
        };
      }),
    });
  });
