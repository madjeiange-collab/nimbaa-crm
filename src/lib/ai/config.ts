import type { UserRole } from '@/types/database';

/**
 * OpenAI model routing — budget model for field users, mid-tier for
 * managers/admins who ask analytical questions. Overridable via env so a
 * model swap never needs a redeploy of code changes.
 */
export const AI_MODELS: Record<UserRole, string> = {
  rep: process.env.AI_MODEL_FIELD ?? 'gpt-5.6-luna',
  technician: process.env.AI_MODEL_FIELD ?? 'gpt-5.6-luna',
  manager: process.env.AI_MODEL_ANALYSIS ?? 'gpt-5.6-terra',
  admin: process.env.AI_MODEL_ANALYSIS ?? 'gpt-5.6-terra',
};

export const TRANSCRIBE_MODEL = process.env.AI_MODEL_TRANSCRIBE ?? 'gpt-4o-mini-transcribe';

export const TTS_MODEL = process.env.AI_MODEL_TTS ?? 'gpt-4o-mini-tts';
export const TTS_VOICE = process.env.AI_TTS_VOICE ?? 'nova';

/** Hard ceiling on questions per user per day (see ai_usage table). */
export const DAILY_QUESTION_CAP = 25;

/** Max assistant loop iterations (tool rounds) per question. */
export const MAX_TOOL_ROUNDS = 5;
