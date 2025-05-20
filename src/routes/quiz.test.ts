import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import app from '../index'; // Assuming app is exported from src/index.ts
import { db } from '../adapter';
import {
  userTable,
  questionSetTable,
  questionTable,
  quizAttemptTable,
  quizAnswerTable,
  userProfileTable,
  type UserProfileTable,
  type QuestionSetTable,
  type QuestionTable,
  type QuizAttemptTable
} from '../db/schemas'; // Adjust path as needed
import { lucia } from '../lucia'; // For creating sessions
import { randomUUIDv7 } from 'bun';
import { eq, and } from 'drizzle-orm';

const TEST_PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${TEST_PORT}/api`;

// Helper function to create a user and session for testing
async function createTestUserAndSession(username = 'quizuser') {
  const userId = randomUUIDv7();
  const hashedPassword = 'hashedpasswordquiz'; // In real tests, hash a password

  await db.insert(userTable).values({
    id: userId,
    username,
    hashedPassword,
  });

  const session = await lucia.createSession(userId, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  return { userId, sessionCookie, username };
}

// Helper function to create a question set
async function createQuestionSet(name = 'Test Set 1', description = 'A test question set') {
  const questionSetId = randomUUIDv7();
  await db.insert(questionSetTable).values({
    id: questionSetId,
    name,
    description,
    createdAt: new Date(),
    // createdById: 'admin_user_id' // If you have such a field
  });
  return { questionSetId, name, description };
}

// Helper function to create a question
async function createQuestion(questionSetId: string, content: string, type: 'true_false' | 'single_selection', options: any, correctAnswer: string) {
  const questionId = randomUUIDv7();
  await db.insert(questionTable).values({
    id: questionId,
    questionSetId,
    type,
    content,
    options, // Store as JSON or appropriate type
    correctAnswer,
    createdAt: new Date(),
  });
  return { questionId, content, type, options, correctAnswer };
}


describe('Quiz Routes - Integration Tests', () => {
  let testUser: { userId: string; sessionCookie: any; username: string };
  let testSet1: { questionSetId: string; name: string; description: string; };
  let question1InSet1: { questionId: string; content: string; type: 'true_false' | 'single_selection'; options: any; correctAnswer: string; };
  let question2InSet1: { questionId: string; content: string; type: 'true_false' | 'single_selection'; options: any; correctAnswer: string; };


  beforeEach(async () => {
    // Clear relevant tables before each test
    await db.delete(quizAnswerTable);
    await db.delete(quizAttemptTable);
    await db.delete(questionTable);
    await db.delete(questionSetTable);
    await db.delete(userProfileTable);
    await db.delete(userTable);

    testUser = await createTestUserAndSession();
    testSet1 = await createQuestionSet('Math Basics', 'Basic arithmetic questions');
    question1InSet1 = await createQuestion(testSet1.questionSetId, '2 + 2 = 4?', 'true_false', null, 'true');
    question2InSet1 = await createQuestion(testSet1.questionSetId, 'What is 10 / 2?', 'single_selection', ['2', '5', '8', '10'], '5');
  });

  afterEach(async () => {
    // Ensure cleanup after each test
    await db.delete(quizAnswerTable);
    await db.delete(quizAttemptTable);
    await db.delete(questionTable);
    await db.delete(questionSetTable);
    await db.delete(userProfileTable);
    await db.delete(userTable);
    vi.clearAllMocks();
  });

  // --- POST /quiz/:questionSetId/start ---
  describe('POST /quiz/:questionSetId/start', () => {
    it('should successfully start a quiz', async () => {
      const response = await app.fetch(new Request(`${BASE_URL}/quiz/${testSet1.questionSetId}/start`, {
        method: 'POST',
        headers: { Cookie: testUser.sessionCookie.serialize() },
      }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.attemptId).toBeString();
      expect(body.data.totalQuestions).toBe(2); // Based on seeded questions for testSet1

      const attempt = await db.select().from(quizAttemptTable).where(eq(quizAttemptTable.id, body.data.attemptId)).get();
      expect(attempt).toBeDefined();
      expect(attempt?.userId).toBe(testUser.userId);
      expect(attempt?.questionSetId).toBe(testSet1.questionSetId);
      expect(attempt?.score).toBe(0);
      expect(attempt?.totalQuestions).toBe(2);
      expect(attempt?.startedAt).toBeDate();
    });

    it('should return 404 for invalid questionSetId', async () => {
      const invalidId = randomUUIDv7();
      const response = await app.fetch(new Request(`${BASE_URL}/quiz/${invalidId}/start`, {
        method: 'POST',
        headers: { Cookie: testUser.sessionCookie.serialize() },
      }));
      expect(response.status).toBe(404);
    });

    it('should return 401 if not logged in', async () => {
      const response = await app.fetch(new Request(`${BASE_URL}/quiz/${testSet1.questionSetId}/start`, { method: 'POST' }));
      expect(response.status).toBe(401);
    });
     it('should return 404 if question set has no questions', async () => {
        const emptySet = await createQuestionSet('Empty Set', 'This set has no questions');
        const response = await app.fetch(new Request(`${BASE_URL}/quiz/${emptySet.questionSetId}/start`, {
            method: 'POST',
            headers: { Cookie: testUser.sessionCookie.serialize() },
        }));
        const body = await response.json();
        expect(response.status).toBe(404);
        expect(body.success).toBe(false);
        expect(body.error).toBe('No questions found for this question set');
    });
  });

  // --- POST /quiz/attempt/:attemptId/answer ---
  describe('POST /quiz/attempt/:attemptId/answer', () => {
    let attemptId: string;

    beforeEach(async () => {
      // Start a quiz to get a valid attemptId
      const startResponse = await app.fetch(new Request(`${BASE_URL}/quiz/${testSet1.questionSetId}/start`, {
        method: 'POST',
        headers: { Cookie: testUser.sessionCookie.serialize() },
      }));
      const startBody = await startResponse.json();
      attemptId = startBody.data.attemptId;
    });

    it('should record a correct answer and increment score', async () => {
      const payload = { questionId: question1InSet1.questionId, userAnswer: 'true' };
      const response = await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${attemptId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: testUser.sessionCookie.serialize() },
        body: JSON.stringify(payload),
      }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.wasCorrect).toBe(true);
      expect(body.data.correctAnswer).toBe(question1InSet1.correctAnswer);

      const dbAnswer = await db.select().from(quizAnswerTable).where(eq(quizAnswerTable.questionId, question1InSet1.questionId)).get();
      expect(dbAnswer?.isCorrect).toBe(true);

      const dbAttempt = await db.select().from(quizAttemptTable).where(eq(quizAttemptTable.id, attemptId)).get();
      expect(dbAttempt?.score).toBe(1);
    });

    it('should record an incorrect answer and not increment score', async () => {
      const payload = { questionId: question1InSet1.questionId, userAnswer: 'false' }; // Incorrect
      const response = await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${attemptId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: testUser.sessionCookie.serialize() },
        body: JSON.stringify(payload),
      }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.wasCorrect).toBe(false);

      const dbAttempt = await db.select().from(quizAttemptTable).where(eq(quizAttemptTable.id, attemptId)).get();
      expect(dbAttempt?.score).toBe(0); // Score remains 0
    });

    it('should return 404 for invalid attemptId', async () => {
        const invalidAttemptId = randomUUIDv7();
        const payload = { questionId: question1InSet1.questionId, userAnswer: 'true' };
        const response = await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${invalidAttemptId}/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: testUser.sessionCookie.serialize() },
            body: JSON.stringify(payload),
        }));
        expect(response.status).toBe(404);
    });

    it('should return 403 if attempt belongs to another user', async () => {
        const otherUser = await createTestUserAndSession('otheruser');
        // Start an attempt for the original testUser
        const startResponse = await app.fetch(new Request(`${BASE_URL}/quiz/${testSet1.questionSetId}/start`, {
            method: 'POST',
            headers: { Cookie: testUser.sessionCookie.serialize() },
        }));
        const startBody = await startResponse.json();
        const userAttemptId = startBody.data.attemptId;

        // Try to answer as otherUser
        const payload = { questionId: question1InSet1.questionId, userAnswer: 'true' };
        const response = await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${userAttemptId}/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: otherUser.sessionCookie.serialize() },
            body: JSON.stringify(payload),
        }));
        expect(response.status).toBe(404); // Or 403, depends on how specific the check "not found or does not belong to user" is
    });


    it('should return 403 if attempt already completed', async () => {
        // Complete the attempt
        await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${attemptId}/complete`, {
            method: 'POST',
            headers: { Cookie: testUser.sessionCookie.serialize() },
        }));

        // Try to answer again
        const payload = { questionId: question1InSet1.questionId, userAnswer: 'true' };
        const response = await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${attemptId}/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: testUser.sessionCookie.serialize() },
            body: JSON.stringify(payload),
        }));
        expect(response.status).toBe(403);
    });
    
    it('should return 400 for invalid payload (missing questionId)', async () => {
        const payload = { userAnswer: 'true' }; // Missing questionId
        const response = await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${attemptId}/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: testUser.sessionCookie.serialize() },
            body: JSON.stringify(payload),
        }));
        expect(response.status).toBe(400); // zValidator should catch this
    });
  });

  // --- POST /quiz/attempt/:attemptId/complete ---
  describe('POST /quiz/attempt/:attemptId/complete', () => {
    let attemptId: string;
    let initialScore: number;

    beforeEach(async () => {
      const startRes = await app.fetch(new Request(`${BASE_URL}/quiz/${testSet1.questionSetId}/start`, {
        method: 'POST',
        headers: { Cookie: testUser.sessionCookie.serialize() },
      }));
      const startBody = await startRes.json();
      attemptId = startBody.data.attemptId;

      // Answer one question correctly
      await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${attemptId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: testUser.sessionCookie.serialize() },
        body: JSON.stringify({ questionId: question1InSet1.questionId, userAnswer: 'true' }),
      }));
      const attemptBeforeComplete = await db.select().from(quizAttemptTable).where(eq(quizAttemptTable.id, attemptId)).get();
      initialScore = attemptBeforeComplete!.score!;
    });

    it('should successfully complete a quiz and update user profile', async () => {
      const response = await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${attemptId}/complete`, {
        method: 'POST',
        headers: { Cookie: testUser.sessionCookie.serialize() },
      }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.attemptId).toBe(attemptId);
      expect(body.data.score).toBe(initialScore); // Score is 1 from the answered question
      expect(body.data.completedAt).toBeString();

      const dbAttempt = await db.select().from(quizAttemptTable).where(eq(quizAttemptTable.id, attemptId)).get();
      expect(dbAttempt?.completedAt).toBeDate();

      const userProfile = await db.select().from(userProfileTable).where(eq(userProfileTable.userId, testUser.userId)).get();
      expect(userProfile).toBeDefined();
      expect(userProfile?.totalQuizzesTaken).toBe(1);
      expect(userProfile?.highestScore).toBe(initialScore);

      // Complete another quiz to check profile update
      const startRes2 = await app.fetch(new Request(`${BASE_URL}/quiz/${testSet1.questionSetId}/start`, { method: 'POST', headers: { Cookie: testUser.sessionCookie.serialize() } }));
      const startBody2 = await startRes2.json();
      const attemptId2 = startBody2.data.attemptId;
      // Answer 2 questions correctly for a higher score
      await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${attemptId2}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: testUser.sessionCookie.serialize() }, body: JSON.stringify({ questionId: question1InSet1.questionId, userAnswer: 'true' }) }));
      await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${attemptId2}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: testUser.sessionCookie.serialize() }, body: JSON.stringify({ questionId: question2InSet1.questionId, userAnswer: '5' }) }));
      const attempt2Score = (await db.select().from(quizAttemptTable).where(eq(quizAttemptTable.id, attemptId2)).get())!.score!;

      await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${attemptId2}/complete`, { method: 'POST', headers: { Cookie: testUser.sessionCookie.serialize() } }));
      
      const updatedProfile = await db.select().from(userProfileTable).where(eq(userProfileTable.userId, testUser.userId)).get();
      expect(updatedProfile?.totalQuizzesTaken).toBe(2);
      expect(updatedProfile?.highestScore).toBe(attempt2Score); // Should be 2
    });
  });

  // --- GET /quiz/sets ---
  describe('GET /quiz/sets', () => {
    it('should return all available question sets', async () => {
      await createQuestionSet('Set 2', 'Another set');
      const response = await app.fetch(new Request(`${BASE_URL}/quiz/sets`), {
        headers: { Cookie: testUser.sessionCookie.serialize() },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(2); // testSet1 + Set 2
      expect(body.data[0].name).toBe(testSet1.name);
      expect(body.data[1].name).toBe('Set 2');
    });

    it('should return empty array if no sets exist', async () => {
      await db.delete(questionSetTable); // Clear all sets
      const response = await app.fetch(new Request(`${BASE_URL}/quiz/sets`), {
        headers: { Cookie: testUser.sessionCookie.serialize() },
      });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.data.length).toBe(0);
    });
  });

  // --- GET /quiz/sets/:questionSetId ---
  describe('GET /quiz/sets/:questionSetId', () => {
    it('should return set details and questions (without correct answers)', async () => {
      const response = await app.fetch(new Request(`${BASE_URL}/quiz/sets/${testSet1.questionSetId}`), {
        headers: { Cookie: testUser.sessionCookie.serialize() },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(testSet1.questionSetId);
      expect(body.data.name).toBe(testSet1.name);
      expect(body.data.questions.length).toBe(2);
      expect(body.data.questions[0].content).toBe(question1InSet1.content);
      expect(body.data.questions[0].correctAnswer).toBeUndefined(); // CRITICAL
      expect(body.data.questions[1].options).toEqual(['2', '5', '8', '10']);
      expect(body.data.questions[1].correctAnswer).toBeUndefined(); // CRITICAL
    });

    it('should return 404 for invalid questionSetId', async () => {
      const response = await app.fetch(new Request(`${BASE_URL}/quiz/sets/${randomUUIDv7()}`), {
        headers: { Cookie: testUser.sessionCookie.serialize() },
      });
      expect(response.status).toBe(404);
    });
  });

  // --- GET /quiz/attempts/my ---
  describe('GET /quiz/attempts/my', () => {
    it('should return user\'s quiz attempts', async () => {
      // Start one attempt
      const startRes = await app.fetch(new Request(`${BASE_URL}/quiz/${testSet1.questionSetId}/start`, { method: 'POST', headers: { Cookie: testUser.sessionCookie.serialize() } }));
      const startBody = await startRes.json();
      const attemptId1 = startBody.data.attemptId;
      // Complete it
      await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${attemptId1}/complete`, { method: 'POST', headers: { Cookie: testUser.sessionCookie.serialize() } }));


      const response = await app.fetch(new Request(`${BASE_URL}/quiz/attempts/my`), {
        headers: { Cookie: testUser.sessionCookie.serialize() },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1);
      expect(body.data[0].attemptId).toBe(attemptId1);
      expect(body.data[0].questionSetName).toBe(testSet1.name);
    });

     it('should return empty array if user has no attempts', async () => {
        const response = await app.fetch(new Request(`${BASE_URL}/quiz/attempts/my`), {
            headers: { Cookie: testUser.sessionCookie.serialize() },
        });
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.data.length).toBe(0);
    });
  });

  // --- GET /quiz/attempts/:attemptId ---
  describe('GET /quiz/attempts/:attemptId', () => {
    let attemptId: string;

    beforeEach(async () => {
      const startRes = await app.fetch(new Request(`${BASE_URL}/quiz/${testSet1.questionSetId}/start`, { method: 'POST', headers: { Cookie: testUser.sessionCookie.serialize() } }));
      const startBody = await startRes.json();
      attemptId = startBody.data.attemptId;
      // Answer one question
      await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${attemptId}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: testUser.sessionCookie.serialize() }, body: JSON.stringify({ questionId: question1InSet1.questionId, userAnswer: 'true' }) }));
      // Complete the quiz
      await app.fetch(new Request(`${BASE_URL}/quiz/attempt/${attemptId}/complete`, { method: 'POST', headers: { Cookie: testUser.sessionCookie.serialize() } }));
    });

    it('should return details of a specific attempt with answers and correct answers', async () => {
      const response = await app.fetch(new Request(`${BASE_URL}/quiz/attempts/${attemptId}`), {
        headers: { Cookie: testUser.sessionCookie.serialize() },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(attemptId);
      expect(body.data.questionSetName).toBe(testSet1.name);
      expect(body.data.answers.length).toBe(1);
      expect(body.data.answers[0].questionId).toBe(question1InSet1.questionId);
      expect(body.data.answers[0].userAnswer).toBe('true');
      expect(body.data.answers[0].isCorrect).toBe(true);
      expect(body.data.answers[0].correctAnswer).toBe(question1InSet1.correctAnswer); // Correct answer is present
    });
    
    it('should return 404 for invalid attemptId', async () => {
        const response = await app.fetch(new Request(`${BASE_URL}/quiz/attempts/${randomUUIDv7()}`), {
            headers: { Cookie: testUser.sessionCookie.serialize() },
        });
        expect(response.status).toBe(404);
    });

    it('should return 404 if attempt belongs to another user', async () => {
        const otherUser = await createTestUserAndSession('otheruserquiz');
        const response = await app.fetch(new Request(`${BASE_URL}/quiz/attempts/${attemptId}`), {
            headers: { Cookie: otherUser.sessionCookie.serialize() }, // Trying to access testUser's attempt
        }));
        expect(response.status).toBe(404); // Or 403, "Quiz attempt not found or access denied"
    });
  });
});
