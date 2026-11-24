import { AiGenerationOptions, AiGenerationResult } from '../types.js';

export interface AiProvider {
  readonly providerName: string;
  generateDraft(options: AiGenerationOptions): Promise<AiGenerationResult>;
}
