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

export const chatMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export interface OpenAiChatCompletions {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | object;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
