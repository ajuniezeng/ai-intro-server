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
import { eq } from 'drizzle-orm';

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
          createdAt: new Date(res.created * 1000),
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
        throw new HTTPException(500, {
          message: 'Internal Error ' + err,
        });
      }
    },
  )
  .get('/history', loggedIn, async (c) => {
    const user = c.get('user')!;

    const sessionIdList = await db
      .select()
      .from(chatSessionTable)
      .where(eq(chatSessionTable.userId, user.id));

    const history = await Promise.all(
      sessionIdList.map(async (id) => {
        return await db
          .select()
          .from(chatMessageTable)
          .where(eq(chatMessageTable.chatSessionId, id.id));
      }),
    );

    return c.json<SuccessResponse<ChatHistory[]>>({
      success: true,
      message: 'Successfully fetch chat history',
      data: history.flat().map((item) => {
        return {
          id: item.chatSessionId,
          role: item.role,
          content: item.content,
          createdAt: item.createdAt,
        };
      }),
    });
  });
