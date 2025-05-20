import { z } from 'zod';
import type { ChatMessage, OpenAiChatCompletions } from '../types';

const envSchema = z.object({
  baseUrl: z.string().url(),
  model: z.string(),
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
      model: env.model,
      messages,
    }),
  };

  const response = await fetch(env.baseUrl, fetchOptions);
  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`);
  }

  return (await response.json()) as OpenAiChatCompletions;
}
