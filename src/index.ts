import { Hono } from 'hono';
import type { Context } from './context';
import { z } from 'zod';
import { cors } from 'hono/cors';
import { lucia } from './lucia';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import type { ErrorResponse } from './types';
import { HTTPException } from 'hono/http-exception';
import { authRouter } from './routes/auth';
import { quizRouter } from './routes/quiz'; // Import quizRouter
import { chatRouter } from './routes/chat';

const envSchema = z.object({
  PORT: z.number({ coerce: true }),
});

const env = envSchema.parse(process.env);
const port = env.PORT;

const app = new Hono<Context>();

app.use('*', cors(), async (c, next) => {
  const sessionId = lucia.readSessionCookie(c.req.header('Cookie') ?? '');
  if (!sessionId) {
    c.set('user', null);
    c.set('session', null);
    return next();
  }

  const { session, user } = await lucia.validateSession(sessionId);
  if (session && session.fresh) {
    c.header('Set-Cookie', lucia.createSessionCookie(session.id).serialize(), {
      append: true,
    });
  }
  if (!session) {
    c.header('Set-Cookie', lucia.createBlankSessionCookie().serialize(), {
      append: true,
    });
  }
  c.set('session', session);
  c.set('user', user);
  return next();
});

app.use(logger());
app.use(prettyJSON());

app
  .basePath('/api')
  .route('/auth', authRouter)
  .route('/quiz', quizRouter)
  .route('/chat', chatRouter); 

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const errResponse =
      err.res ??
      c.json<ErrorResponse>(
        {
          success: false,
          error: err.message,
          isFormError:
            err.cause && typeof err.cause === 'object' && 'form' in err.cause
              ? err.cause.form === true
              : false,
        },
        err.status,
      );
    return errResponse;
  }

  return c.json<ErrorResponse>(
    {
      success: false,
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal Server Error'
          : (err.stack ?? err.message),
    },
    500,
  );
});

export default {
  port: port ?? 3000,
  fetch: app.fetch,
};
