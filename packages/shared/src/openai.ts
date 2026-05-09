import OpenAI from "openai";
import { loadEnv } from "./env.js";

export function createOpenAIClient() {
  const env = loadEnv();
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}
