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
  type QuestionSet,
  type QuestionSetDetail,
  type QuizAttempt,
} from '../db/schemas/quiz';
import { randomUUIDv7 } from 'bun';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { SuccessResponse } from '../types';
import { userProfileTable } from '../db/schemas/profile';

export const quizRouter = new Hono<Context>()
  .post('/:questionSetId/start', loggedIn, async (c) => {
    const questionSetId = c.req.param('questionSetId');
    const user = c.get('user')!;

    const [questionSet] = await db
      .select()
      .from(questionSetTable)
      .where(eq(questionSetTable.id, questionSetId))
      .limit(1);

    if (!questionSet) {
      throw new HTTPException(404, { message: 'Question set not found' });
    }

    const questions = await db
      .select({ id: questionTable.id }) // Only select id, we just need the count
      .from(questionTable)
      .where(eq(questionTable.questionSetId, questionSetId));

    const totalQuestions = 10;

    if (questions.length === 0) {
      throw new HTTPException(404, {
        message: 'No questions found for this question set',
      });
    }

    const attemptId = randomUUIDv7();
    const newAttempt: QuizAttempt = {
      id: attemptId,
      userId: user.id,
      questionSetId,
      score: 0,
      totalQuestions,
      startedAt: new Date(),
      completedAt: null, // Initially null
    };

    await db.insert(quizAttemptTable).values(newAttempt);

    return c.json({
      success: true,
      message: 'Quiz started successfully',
      data: {
        attemptId,
        totalQuestions,
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

      const [quizAttempt] = await db
        .select()
        .from(quizAttemptTable)
        .where(
          and(
            eq(quizAttemptTable.id, attemptId),
            eq(quizAttemptTable.userId, user.id),
          ),
        )
        .limit(1);

      if (!quizAttempt) {
        throw new HTTPException(404, {
          message: 'Quiz attempt not found or does not belong to user',
        });
      }
      if (quizAttempt.completedAt) {
        throw new HTTPException(403, {
          message: 'Quiz attempt has already been completed',
        });
      }

      const [question] = await db
        .select()
        .from(questionTable)
        .where(eq(questionTable.id, questionId))
        .limit(1);

      if (!question) {
        throw new HTTPException(404, { message: 'Question not found' });
      }

      if (question.questionSetId !== quizAttempt.questionSetId) {
        throw new HTTPException(403, {
          message: 'Question does not belong to this quiz set',
        });
      }

      let isCorrect = false;
      if (
        question.type === 'single_selection' ||
        question.type === 'true_false'
      ) {
        isCorrect = userAnswer === question.correctAnswer;
      }

      const answerId = randomUUIDv7();
      const newAnswer = {
        id: answerId,
        quizAttemptId: attemptId,
        questionId: questionId,
        userAnswer: userAnswer,
        isCorrect: isCorrect,
        answeredAt: new Date(),
      };

      await db.transaction(async (tx) => {
        await tx.insert(quizAnswerTable).values(newAnswer);

        if (isCorrect) {
          await tx
            .update(quizAttemptTable)
            .set({ score: (quizAttempt.score || 0) + 1 })
            .where(eq(quizAttemptTable.id, attemptId));
        }
      });

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

    const [quizAttempt] = await db
      .select()
      .from(quizAttemptTable)
      .where(
        and(
          eq(quizAttemptTable.id, attemptId),
          eq(quizAttemptTable.userId, user.id),
        ),
      )
      .limit(1);

    if (!quizAttempt) {
      throw new HTTPException(404, {
        message: 'Quiz attempt not found or does not belong to user',
      });
    }
    if (quizAttempt.completedAt) {
      throw new HTTPException(403, {
        message: 'Quiz attempt has already been completed',
      });
    }

    const completedAt = await db.transaction(async (tx) => {
      const completedAt = new Date();
      await tx
        .update(quizAttemptTable)
        .set({ completedAt: completedAt })
        .where(eq(quizAttemptTable.id, attemptId));

      const [userProfile] = await tx
        .select()
        .from(userProfileTable)
        .where(eq(userProfileTable.userId, user.id))
        .limit(1);

      if (userProfile) {
        const newTotalQuizzesTaken = (userProfile.totalQuizzesTaken || 0) + 1;
        const newHighestScore = Math.max(
          userProfile.highestScore || 0,
          quizAttempt.score || 0,
        );
        await tx
          .update(userProfileTable)
          .set({
            totalQuizzesTaken: newTotalQuizzesTaken,
            highestScore: newHighestScore,
          })
          .where(eq(userProfileTable.userId, user.id));
      } else {
        await tx.insert(userProfileTable).values({
          id: randomUUIDv7(), // Assuming userProfileTable has its own id
          userId: user.id,
          totalQuizzesTaken: 1,
          highestScore: quizAttempt.score || 0,
        });
      }
      return completedAt;
    });

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
        level: questionSetTable.level,
        description: questionSetTable.description,
        createdAt: questionSetTable.createdAt,
        // Add other fields if necessary, e.g., createdBy, difficulty
      })
      .from(questionSetTable);

    return c.json<SuccessResponse<QuestionSet[]>>({
      success: true,
      message: 'Successfully fetched question sets',
      data: questionSets,
    });
  })
  .get('/sets/:questionSetId', loggedIn, async (c) => {
    const questionSetId = c.req.param('questionSetId');

    const [questionSet] = await db
      .select()
      .from(questionSetTable)
      .where(eq(questionSetTable.id, questionSetId))
      .limit(1);

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

    return c.json<SuccessResponse<QuestionSetDetail>>({
      success: true,
      message: 'Successfully fetched question set details',
      data: {
        questionSet,
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
      .where(eq(quizAttemptTable.userId, user.id))
      .orderBy(quizAttemptTable.startedAt);

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
      .limit(1);

    if (!quizAttempt) {
      throw new HTTPException(404, {
        message: 'Quiz attempt not found or access denied',
      });
    }

    const answers = await db
      .select({
        questionId: quizAnswerTable.questionId,
        questionContent: questionTable.content,
        questionType: questionTable.type,
        questionOptions: questionTable.options,
        userAnswer: quizAnswerTable.userAnswer,
        isCorrect: quizAnswerTable.isCorrect,
        correctAnswer: questionTable.correctAnswer,
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
