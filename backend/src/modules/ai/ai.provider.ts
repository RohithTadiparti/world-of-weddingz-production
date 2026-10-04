import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { GENIE_FALLBACK, answerFor } from './genie-knowledge';

/**
 * How one completion should be made.
 *
 * Per call rather than per provider, because the two callers want different
 * things: the assistant is a conversation and reads better with some variety,
 * while extraction is transcription and wants the same answer every time.
 */
export interface CompleteOptions {
  /** An image for the model to read alongside the prompt. */
  imageUrl?: string;
  /** Defaults to DEFAULT_TEMPERATURE, the assistant's conversational setting. */
  temperature?: number;
  /** Ask for a JSON object back rather than prose. */
  json?: boolean;
}

export const DEFAULT_TEMPERATURE = 0.7;

/**
 * LLM abstraction. 'mock' returns deterministic, rule-based text so the WOW
 * Genie works offline and in tests; 'openai' calls a real chat completion API.
 * Both implement the same interface (selected via AI_PROVIDER).
 */
export interface AiProvider {
  complete(prompt: string, options?: CompleteOptions): Promise<string>;
}

/**
 * WOW Genie without a model behind it.
 *
 * This used to echo the question back with a note about an environment
 * variable, which is not an answer — somebody asked how to plan for thirty
 * guests and was told about `AI_PROVIDER`. Reported as incorrect, and it was.
 *
 * It answers properly now, from `genie-knowledge.ts`. Deterministic rather than
 * generated, which for this particular job is a feature: the budget split it
 * quotes is the same one the Budget Insights panel beside it computes, and the
 * booking and RSVP advice describes what this platform actually does. A model
 * would be more fluent and would occasionally describe a product that does not
 * exist.
 */
@Injectable()
export class MockAiProvider implements AiProvider {
  async complete(prompt: string): Promise<string> {
    return answerFor(prompt) ?? GENIE_FALLBACK;
  }
}

@Injectable()
export class OpenAiProvider implements AiProvider {
  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(private readonly cfg: AppConfigService) {}

  async complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
    const { apiKey, model, baseUrl } = this.cfg.ai;
    // Configured for a model and missing the key: answer from what is known
    // rather than telling the person about a configuration problem they cannot
    // do anything about.
    if (!apiKey) return answerFor(prompt) ?? GENIE_FALLBACK;

    const userContent = options.imageUrl
      ? [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: options.imageUrl } },
        ]
      : prompt;

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are WOW Genie, a concise Indian wedding planning assistant.' },
          { role: 'user', content: userContent },
        ],
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) {
      this.logger.error(`OpenAI call failed: ${res.status}`);
      // The provider being down is not a reason to show the user nothing.
      return answerFor(prompt) ?? GENIE_FALLBACK;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content || (answerFor(prompt) ?? GENIE_FALLBACK);
  }
}

export const AI_PROVIDER = 'AI_PROVIDER';

export const aiProviderFactory = {
  provide: AI_PROVIDER,
  inject: [AppConfigService, MockAiProvider, OpenAiProvider],
  useFactory: (cfg: AppConfigService, mock: MockAiProvider, openai: OpenAiProvider): AiProvider =>
    cfg.ai.provider === 'openai' ? openai : mock,
};
