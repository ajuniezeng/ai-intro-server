import { z } from 'zod';
import type { ChatMessage, OpenAiChatCompletions } from '../types';

const envSchema = z.object({
  BASE_URL: z.string().url(),
  MODEL: z.string(),
  API_KEY: z.string(),
});

export async function requestOpenAiChatCompletionsApi(messages: ChatMessage[]) {
  const env = envSchema.parse(process.env);

  const fetchOptions: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.API_KEY}`,
    },
    method: 'POST',
    body: JSON.stringify({
      model: env.MODEL,
      messages,
    }),
  };

  const response = await fetch(env.BASE_URL, fetchOptions);
  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`);
  }

  const result = await response.json();

  return result as OpenAiChatCompletions;
}
