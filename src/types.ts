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
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6).max(255),
});

export const updatePasswordSchema = z.object({
  oldPassword: z.string().min(6).max(255),
  newPassword: z.string().min(6).max(255),
});
