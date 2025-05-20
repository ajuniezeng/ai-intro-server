import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import app from '../index'; // Assuming app is exported from src/index.ts
import { db } from '../adapter';
import {
  userTable,
  chatSessionTable,
  chatMessageTable,
} from '../db/schemas'; // Adjust path as needed
import { lucia } from '../lucia'; // For creating sessions
import { randomUUIDv7 } from 'bun'; // For generating IDs

// Mock the OpenAI API
vi.mock('../lib/llm', () => ({
  requestOpenAiChatCompletionsApi: vi.fn(),
}));
import { requestOpenAiChatCompletionsApi } from '../lib/llm';

const TEST_PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${TEST_PORT}/api`;

// Helper function to create a user and session for testing
async function createTestUserAndSession(username = 'testuser') {
  const userId = randomUUIDv7();
  const hashedPassword = 'hashedpassword'; // In real tests, hash a password

  await db.insert(userTable).values({
    id: userId,
    username,
    hashedPassword,
  });

  const session = await lucia.createSession(userId, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  return { userId, sessionCookie, username };
}

describe('Chat Routes - Integration Tests', () => {
  let testUser: { userId: string; sessionCookie: any; username: string };

  beforeEach(async () => {
    // Clear relevant tables before each test
    await db.delete(chatMessageTable);
    await db.delete(chatSessionTable);
    await db.delete(userTable); // If users are created per test suite/test

    // Create a standard test user for most tests
    testUser = await createTestUserAndSession();
  });

  afterEach(async () => {
    // Ensure cleanup after each test
    await db.delete(chatMessageTable);
    await db.delete(chatSessionTable);
    await db.delete(userTable);
    vi.clearAllMocks(); // Clear mocks
  });

  // --- GET /history ---
  describe('GET /history', () => {
    it('should return chat history for a user with history', async () => {
      // 1. Seed data
      const session1Id = randomUUIDv7();
      const session2Id = randomUUIDv7();
      await db.insert(chatSessionTable).values([
        { id: session1Id, userId: testUser.userId, createdAt: new Date(Date.now() - 20000) },
        { id: session2Id, userId: testUser.userId, createdAt: new Date(Date.now() - 10000) },
      ]);
      await db.insert(chatMessageTable).values([
        { id: randomUUIDv7(), chatSessionId: session1Id, role: 'user', content: 'Hello', createdAt: new Date(Date.now() - 19000) },
        { id: randomUUIDv7(), chatSessionId: session1Id, role: 'assistant', content: 'Hi there', createdAt: new Date(Date.now() - 18000) },
        { id: randomUUIDv7(), chatSessionId: session2Id, role: 'user', content: 'How are you?', createdAt: new Date(Date.now() - 9000) },
      ]);

      // 2. Make request
      const response = await app.fetch(new Request(`${BASE_URL}/chat/history`), {
        headers: { Cookie: testUser.sessionCookie.serialize() },
      });
      const body = await response.json();

      // 3. Assert
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(3);
      expect(body.data[0].content).toBe('Hello'); // Assuming default order is by creation time
      expect(body.data[2].content).toBe('How are you?');
    });

    it('should return empty array for user with no history', async () => {
      const response = await app.fetch(new Request(`${BASE_URL}/chat/history`), {
        headers: { Cookie: testUser.sessionCookie.serialize() },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(0);
    });

    it('should return 401 for unauthorized access', async () => {
      const response = await app.fetch(new Request(`${BASE_URL}/chat/history`));
      expect(response.status).toBe(401); // Assuming loggedIn middleware returns 401
    });
  });

  // --- POST /completions ---
  describe('POST /completions', () => {
    it('should successfully create a completion and store messages', async () => {
      const mockLlmResponse = {
        id: 'llm-session-' + randomUUIDv7(),
        created: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
        choices: [{ message: { role: 'assistant', content: 'This is the LLM response.' } }],
      };
      (requestOpenAiChatCompletionsApi as any).mockResolvedValue(mockLlmResponse);

      const userMessage = { role: 'user', content: 'Tell me a joke' };
      const requestTime = new Date();

      const response = await app.fetch(
        new Request(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json', // Assuming JSON, or use 'multipart/form-data' if that's what zValidator('form',...) expects
            Cookie: testUser.sessionCookie.serialize(),
          },
          body: JSON.stringify(userMessage), // Or construct FormData if form
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.content).toBe('This is the LLM response.');

      // Verify DB entries
      const sessions = await db.select().from(chatSessionTable).where(eq(chatSessionTable.userId, testUser.userId));
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe(mockLlmResponse.id);
      expect(sessions[0].createdAt.getTime()).toBe(mockLlmResponse.created * 1000);

      const messages = await db.select().from(chatMessageTable).where(eq(chatMessageTable.chatSessionId, mockLlmResponse.id)).orderBy(chatMessageTable.createdAt);
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe(userMessage.content);
      // Check if user message timestamp is close to requestTime, and definitely not the LLM time
      expect(messages[0].createdAt.getTime()).toBeGreaterThanOrEqual(requestTime.getTime() - 1000); // Allow 1s diff
      expect(messages[0].createdAt.getTime()).toBeLessThanOrEqual(requestTime.getTime() + 1000); // Allow 1s diff
      expect(messages[0].createdAt.getTime()).not.toBe(mockLlmResponse.created * 1000);


      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toBe('This is the LLM response.');
      expect(messages[1].createdAt.getTime()).toBe(mockLlmResponse.created * 1000);
    });

    it('should handle LLM API error and return 500', async () => {
      (requestOpenAiChatCompletionsApi as any).mockRejectedValue(new Error('LLM API failed'));

      const userMessage = { role: 'user', content: 'Another message' };
      const response = await app.fetch(
        new Request(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: testUser.sessionCookie.serialize() },
          body: JSON.stringify(userMessage),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toBe('An unexpected error occurred while processing your request.');

      // Verify no new session/messages are stored (or handled by transaction)
      const sessions = await db.select().from(chatSessionTable).where(eq(chatSessionTable.userId, testUser.userId));
      expect(sessions.length).toBe(0); // Assuming transaction rollback
    });
  });
});

// Helper to get the Hono app instance for testing
// This assumes your src/index.ts exports the Hono app instance.
// If it exports { fetch: app.fetch, port: ... }, adjust accordingly.
// For Bun tests, you can often directly import and use `app.fetch`.
// The `app.fetch` is used above.
import { eq } from 'drizzle-orm'; // ensure this is imported for db queries
