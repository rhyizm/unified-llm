import dotenv from 'dotenv';
import { callGeminiAgent } from '../src/providers/google/gemini-agent.js';

dotenv.config();

// const model = 'gemini-3-flash-preview:generateContent';
const model = 'gemini-3-flash-preview:streamGenerateContent?alt=sse';
const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/';
const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) {
  throw new Error('Missing GOOGLE_API_KEY (or GOOGLE_API_KEY/OPENAI_API_KEY).');
}

const base = endpoint.trim().endsWith('/') ? endpoint.trim() : `${endpoint.trim()}/`;
const encodedUrl = `${base}${encodeURIComponent(model)}`;
const rawUrl = `${base}${model}`;

console.log('gemini.debug.endpoint', {
  endpoint,
  model,
  encodedUrl,
  rawUrl,
});

const baseInput = [
  {
    role: 'user',
    content: 'Say hello in one short sentence.',
  },
];

try {
  const response = await callGeminiAgent({
    model,
    endpoint,
    apiKey,
    baseInput,
  });

  console.log('gemini.debug.output', `「${response.output}」`);
  console.log('gemini.debug.usage', response.usage);
} catch (error) {
  console.error('gemini.debug.error', error);
}
