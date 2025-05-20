import { Hono } from 'hono';
import type { Context } from '../context';
import { loggedIn } from '../middleware/loggedIn';
import { db } from '../adapter';
import { eq, and } from 'drizzle-orm';
import {
  questionSetTable,
  questionTable,
  quizAttemptTable,
  quizAnswerTable,
  userProfileTable,
  type QuestionSetTable,
  type QuestionTable,
  type QuizAttemptTable,
  type QuizAnswerTable,
  type UserProfileTable,
} from '../db/schemas/quiz'; // Assuming quiz schemas are in their own file or update path
import { userTable } from '../db/schemas/auth'; // For user ID reference
import { randomUUIDv7 } from 'bun';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';

export const quizRouter = new Hono<Context>()
  .post('/:questionSetId/start', loggedIn, async (c) => {
    const questionSetId = c.req.param('questionSetId');
    const user = c.get('user')!;

    // Validate that a questionSet with this ID exists
    const questionSet = await db
      .select()
      .from(questionSetTable)
      .where(eq(questionSetTable.id, questionSetId))
      .get(); // .get() is used if we expect a single result

    if (!questionSet) {
      throw new HTTPException(404, { message: 'Question set not found' });
    }

    // Fetch all questions for this questionSetId to get the totalQuestions count
    const questions = await db
      .select({ id: questionTable.id }) // Only select id, we just need the count
      .from(questionTable)
      .where(eq(questionTable.questionSetId, questionSetId));

    const totalQuestions = questions.length;

    if (totalQuestions === 0) {
      throw new HTTPException(404, { message: 'No questions found for this question set' });
    }

    // Create a new entry in quizAttemptTable
    const attemptId = randomUUIDv7();
    const newAttempt: QuizAttemptTable = {
      id: attemptId,
      userId: user.id,
      questionSetId: questionSetId,
      score: 0,
      totalQuestions: totalQuestions,
      startedAt: new Date(),
      completedAt: null, // Initially null
    };

    await db.insert(quizAttemptTable).values(newAttempt);

    // For simplicity, returning attemptId and a message.
    // Fetching the first question can be handled by a separate endpoint or added later.
    return c.json({
      success: true,
      message: 'Quiz started successfully',
      data: {
        attemptId: attemptId,
        totalQuestions: totalQuestions,
        // Optionally, you could fetch and return the first question here.
        // For example:
        // firstQuestion: questions[0] // (if questions were fetched with full details)
      },
    });
  })
  .post(
    '/attempt/:attemptId/answer',
    loggedIn,
    zValidator(
      'json',
      z.object({
        questionId: z.string(),
        userAnswer: z.string(), // Can be 'true', 'false', or option_id
      }),
    ),
    async (c) => {
      const attemptId = c.req.param('attemptId');
      const { questionId, userAnswer } = c.req.valid('json');
      const user = c.get('user')!;

      // 1. Validate quizAttempt
      const quizAttempt = await db
        .select()
        .from(quizAttemptTable)
        .where(
          and(
            eq(quizAttemptTable.id, attemptId),
            eq(quizAttemptTable.userId, user.id),
          ),
        )
        .get();

      if (!quizAttempt) {
        throw new HTTPException(404, { message: 'Quiz attempt not found or does not belong to user' });
      }
      if (quizAttempt.completedAt) {
        throw new HTTPException(403, { message: 'Quiz attempt has already been completed' });
      }

      // 2. Fetch question details
      const question = await db
        .select()
        .from(questionTable)
        .where(eq(questionTable.id, questionId))
        .get();

      if (!question) {
        throw new HTTPException(404, { message: 'Question not found' });
      }
      
      // Check if this question belongs to the question set of the current attempt
      if (question.questionSetId !== quizAttempt.questionSetId) {
        throw new HTTPException(403, { message: 'Question does not belong to this quiz set' });
      }

      // 3. Determine if userAnswer is correct
      let isCorrect = false;
      if (question.type === 'single_selection' || question.type === 'true_false') {
        isCorrect = userAnswer === question.correctAnswer;
      }
      // Add other types like 'multiple_selection' if needed in future

      // 4. Create new entry in quizAnswerTable
      const answerId = randomUUIDv7();
      const newAnswer: QuizAnswerTable = {
        id: answerId,
        quizAttemptId: attemptId,
        questionId: questionId,
        userAnswer: userAnswer,
        isCorrect: isCorrect,
        answeredAt: new Date(),
      };
      await db.insert(quizAnswerTable).values(newAnswer);

      // 5. If correct, increment score
      if (isCorrect) {
        await db
          .update(quizAttemptTable)
          .set({ score: (quizAttempt.score || 0) + 1 })
          .where(eq(quizAttemptTable.id, attemptId));
      }

      // 6. Response
      return c.json({
        success: true,
        message: 'Answer submitted successfully',
        data: {
          wasCorrect: isCorrect,
          correctAnswer: question.correctAnswer, // Send correct answer for feedback
        },
      });
    },
  )
  .post('/attempt/:attemptId/complete', loggedIn, async (c) => {
    const attemptId = c.req.param('attemptId');
    const user = c.get('user')!;

    // 1. Validate quizAttempt
    const quizAttempt = await db
      .select()
      .from(quizAttemptTable)
      .where(
        and(
          eq(quizAttemptTable.id, attemptId),
          eq(quizAttemptTable.userId, user.id),
        ),
      )
      .get();

    if (!quizAttempt) {
      throw new HTTPException(404, { message: 'Quiz attempt not found or does not belong to user' });
    }
    if (quizAttempt.completedAt) {
      throw new HTTPException(403, { message: 'Quiz attempt has already been completed' });
    }

    // 2. Update quizAttemptTable
    const completedAt = new Date();
    await db
      .update(quizAttemptTable)
      .set({ completedAt: completedAt })
      .where(eq(quizAttemptTable.id, attemptId));

    // 3. Update userProfileTable
    const userProfile = await db
      .select()
      .from(userProfileTable)
      .where(eq(userProfileTable.userId, user.id))
      .get();

    if (userProfile) {
      const newTotalQuizzesTaken = (userProfile.totalQuizzesTaken || 0) + 1;
      const newHighestScore = Math.max(userProfile.highestScore || 0, quizAttempt.score || 0);
      await db
        .update(userProfileTable)
        .set({
          totalQuizzesTaken: newTotalQuizzesTaken,
          highestScore: newHighestScore,
        })
        .where(eq(userProfileTable.userId, user.id));
    } else {
      // First quiz for this user, create a profile entry
      await db.insert(userProfileTable).values({
        id: randomUUIDv7(), // Assuming userProfileTable has its own id
        userId: user.id,
        totalQuizzesTaken: 1,
        highestScore: quizAttempt.score || 0,
        // Initialize other fields as necessary, e.g., badges: JSON.stringify([])
      });
    }

    // 4. Response
    return c.json({
      success: true,
      message: 'Quiz completed successfully',
      data: {
        attemptId: quizAttempt.id,
        score: quizAttempt.score,
        totalQuestions: quizAttempt.totalQuestions,
        startedAt: quizAttempt.startedAt,
        completedAt: completedAt,
      },
    });
  })
  .get('/sets', loggedIn, async (c) => {
    const questionSets = await db
      .select({
        id: questionSetTable.id,
        name: questionSetTable.name,
        description: questionSetTable.description,
        createdAt: questionSetTable.createdAt,
        // Add other fields if necessary, e.g., createdBy, difficulty
      })
      .from(questionSetTable);

    return c.json({
      success: true,
      message: 'Successfully fetched question sets',
      data: questionSets,
    });
  })
  .get('/sets/:questionSetId', loggedIn, async (c) => {
    const questionSetId = c.req.param('questionSetId');

    const questionSet = await db
      .select()
      .from(questionSetTable)
      .where(eq(questionSetTable.id, questionSetId))
      .get();

    if (!questionSet) {
      throw new HTTPException(404, { message: 'Question set not found' });
    }

    const questions = await db
      .select({
        id: questionTable.id,
        questionSetId: questionTable.questionSetId,
        type: questionTable.type,
        content: questionTable.content,
        options: questionTable.options, // Assuming options is a JSON string or similar
        // EXCLUDE questionTable.correctAnswer
        createdAt: questionTable.createdAt,
      })
      .from(questionTable)
      .where(eq(questionTable.questionSetId, questionSetId));

    return c.json({
      success: true,
      message: 'Successfully fetched question set details',
      data: {
        ...questionSet,
        questions: questions,
      },
    });
  })
  .get('/attempts/my', loggedIn, async (c) => {
    const user = c.get('user')!;

    const myAttempts = await db
      .select({
        attemptId: quizAttemptTable.id,
        questionSetId: quizAttemptTable.questionSetId,
        questionSetName: questionSetTable.name, // Joined field
        score: quizAttemptTable.score,
        totalQuestions: quizAttemptTable.totalQuestions,
        startedAt: quizAttemptTable.startedAt,
        completedAt: quizAttemptTable.completedAt,
      })
      .from(quizAttemptTable)
      .leftJoin(
        questionSetTable,
        eq(quizAttemptTable.questionSetId, questionSetTable.id),
      )
      .where(eq(quizAttemptTable.userId, user.id))
      .orderBy(quizAttemptTable.startedAt); // Consider .desc() for newest first

    return c.json({
      success: true,
      message: 'Successfully fetched your quiz attempts',
      data: myAttempts,
    });
  })
  .get('/attempts/:attemptId', loggedIn, async (c) => {
    const attemptId = c.req.param('attemptId');
    const user = c.get('user')!;

    // Fetch the attempt and verify ownership
    const quizAttempt = await db
      .select({
        id: quizAttemptTable.id,
        userId: quizAttemptTable.userId,
        questionSetId: quizAttemptTable.questionSetId,
        questionSetName: questionSetTable.name,
        score: quizAttemptTable.score,
        totalQuestions: quizAttemptTable.totalQuestions,
        startedAt: quizAttemptTable.startedAt,
        completedAt: quizAttemptTable.completedAt,
      })
      .from(quizAttemptTable)
      .leftJoin(
        questionSetTable,
        eq(quizAttemptTable.questionSetId, questionSetTable.id),
      )
      .where(
        and(
          eq(quizAttemptTable.id, attemptId),
          eq(quizAttemptTable.userId, user.id), // Ensure the attempt belongs to the logged-in user
        ),
      )
      .get();

    if (!quizAttempt) {
      throw new HTTPException(404, { message: 'Quiz attempt not found or access denied' });
    }

    // Fetch answers for this attempt, joining with question details
    const answers = await db
      .select({
        questionId: quizAnswerTable.questionId,
        questionContent: questionTable.content,
        questionType: questionTable.type,
        questionOptions: questionTable.options,
        userAnswer: quizAnswerTable.userAnswer,
        isCorrect: quizAnswerTable.isCorrect,
        correctAnswer: questionTable.correctAnswer, // Now we can show the correct answer
        answeredAt: quizAnswerTable.answeredAt,
      })
      .from(quizAnswerTable)
      .leftJoin(questionTable, eq(quizAnswerTable.questionId, questionTable.id))
      .where(eq(quizAnswerTable.quizAttemptId, attemptId));

    return c.json({
      success: true,
      message: 'Successfully fetched quiz attempt details',
      data: {
        ...quizAttempt,
        answers: answers,
      },
    });
  });

// Note: Remember to import and use this router in src/index.ts
// Example:
// import { quizRouter } from './routes/quiz';
// app.route('/quiz', quizRouter);
