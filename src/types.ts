import { z } from 'zod';

export type SuccessResponse<T = void> = {
  success: true;
  message: string;
} & (T extends void ? object : { data: T });

export type ErrorResponse = {
  success: false;
  error: string;
  isFormError?: boolean;
};

export const loginSchema = z.object({
  username: z
    .string()
    .min(3, {
      message: '用户名必须至少包含3个字符',
    })
    .max(32, {
      message: '用户名最多包含32个字符',
    })
    .regex(/^[a-zA-Z0-9_]+$/, {
      message: '非法用户名',
    }),
  password: z
    .string()
    .min(6, {
      message: '密码必须至少包含6个字符',
    })
    .max(32, {
      message: '密码最多包含32个字符',
    }),
});

export const signupSchema = z.object({
  username: z
    .string()
    .min(3, {
      message: '用户名必须至少包含3个字符',
    })
    .max(32, {
      message: '用户名最多包含32个字符',
    })
    .regex(/^[a-zA-Z0-9_]+$/, {
      message: '用户名只能包含字母、数字和下划线',
    }),
  password: z
    .string()
    .min(6, {
      message: '密码必须至少包含6个字符',
    })
    .max(32, {
      message: '密码最多包含32个字符',
    }),
});

export const updatePasswordSchema = z.object({
  oldPassword: z
    .string()
    .min(6, {
      message: '密码必须至少包含6个字符',
    })
    .max(32, {
      message: '密码最多包含32个字符',
    }),
  newPassword: z
    .string()
    .min(6, {
      message: '密码必须至少包含6个字符',
    })
    .max(32, {
      message: '密码最多包含32个字符',
    }),
});
