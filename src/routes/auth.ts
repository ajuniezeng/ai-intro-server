import { Hono } from 'hono';
import type { Context } from '../context';
import { zValidator } from '@hono/zod-validator';
import { loginSchema, type SuccessResponse } from '../types';
import { generateId } from 'lucia';
import { db } from '../adapter';
import { userTable } from '../db/schemas/auth';
import { lucia } from '../lucia';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { loggedIn } from '../middleware/loggedIn';
import { userProfileTable } from '../db/schemas/profile';

export const authRouter = new Hono<Context>()
  .post('/signup', zValidator('form', loginSchema), async (c) => {
    const { username, password } = c.req.valid('form');
    const passwordHash = await Bun.password.hash(password);
    const userId = generateId(15);
    const profileId = generateId(15);

    try {
      await db.transaction(async (tx) => {
        await tx.insert(userTable).values({
          id: userId,
          username,
          passwordHash,
        });

        await tx.insert(userProfileTable).values({
          id: profileId,
          userId,
        });
      });

      const session = await lucia.createSession(userId, { username });
      const sessionCookie = lucia.createSessionCookie(session.id).serialize();

      c.header('Set-Cookie', sessionCookie, { append: true });

      return c.json<SuccessResponse>(
        {
          success: true,
          message: 'User created',
        },
        201,
      );
    } catch (err) {
      console.log(err);
      throw new HTTPException(500, { message: 'Failed to create user' });
    }
  })
  .post('/login', zValidator('form', loginSchema), async (c) => {
    const { username, password } = c.req.valid('form');

    const [existingUser] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.username, username))
      .limit(1);

    if (!existingUser) {
      throw new HTTPException(401, {
        message: 'Invalid username or password',
        cause: { form: true },
      });
    }

    const validPassword = await Bun.password.verify(
      password,
      existingUser.passwordHash,
    );

    if (!validPassword) {
      throw new HTTPException(401, {
        message: 'Invalid username or password',
        cause: { form: true },
      });
    }

    const session = await lucia.createSession(existingUser.id, { username });
    const sessionCookie = lucia.createSessionCookie(session.id).serialize();

    c.header('Set-Cookie', sessionCookie, { append: true });

    return c.json<SuccessResponse>(
      { success: true, message: 'Logged in' },
      200,
    );
  })
  .get('logout', async (c) => {
    const session = c.get('session');

    if (!session) {
      return c.redirect('/');
    }

    await lucia.invalidateSession(session.id);
    c.header('Set-Cookie', lucia.createBlankSessionCookie().serialize(), {
      append: true,
    });
    return c.redirect('/');
  })
  .get('/user', loggedIn, async (c) => {
    const user = c.get('user')!;

    const [profile] = await db
      .select({
        createdAt: userProfileTable.createdAt,
        updatedAt: userProfileTable.updatedAt,
        totalQuizzesTaken: userProfileTable.totalQuizzesTaken,
        highestScore: userProfileTable.highestScore,
      })
      .from(userProfileTable)
      .where(eq(userProfileTable.userId, user.id))
      .limit(1);

    if (!profile) {
      throw new HTTPException(404, { message: 'User not found' });
    }
    return c.json({
      success: true,
      message: 'User fetched',
      data: { username: user.username, profile },
    });
  });
