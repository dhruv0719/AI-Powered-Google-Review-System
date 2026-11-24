import { describe, it, expect } from 'vitest';
import { PromptEngine } from '../src/ai/prompt_engine';

describe('PromptEngine Unit Tests', () => {
  it('creates role-separated system and user prompt messages', () => {
    const messages = PromptEngine.buildPromptMessages('Service was fast and clean.');

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('includes strict non-invention and tone preservation directives in system prompt', () => {
    const messages = PromptEngine.buildPromptMessages('Service was fast.');
    const systemContent = messages[0].content;

    expect(systemContent).toContain('Preserve the customer\'s original meaning, tone, and sentiment');
    expect(systemContent).toContain('Never invent details, numbers, staff names, wait times, prices');
    expect(systemContent).toContain('Return ONLY the polished review text');
  });

  it('safely serializes customer feedback into JSON payload without tag stripping', () => {
    const rawFeedback = 'I liked the <ambience> but price was > ₹500 & waiter was rude.';
    const messages = PromptEngine.buildPromptMessages(rawFeedback);
    const userContent = messages[1].content;

    // Verify raw tags and special characters are preserved inside valid JSON
    expect(userContent).toContain(rawFeedback);

    // Verify JSON parseability of payload
    const jsonStart = userContent.indexOf('{');
    const parsed = JSON.parse(userContent.slice(jsonStart));
    expect(parsed.customer_feedback).toBe(rawFeedback);
  });

  it('excludes star rating, business names, and session identifiers from prompt payload', () => {
    const messages = PromptEngine.buildPromptMessages('Food was fresh.');
    const fullPromptText = messages.map((m) => m.content).join('\n');

    expect(fullPromptText).not.toContain('star');
    expect(fullPromptText).not.toContain('rating');
    expect(fullPromptText).not.toContain('session');
    expect(fullPromptText).not.toContain('cookie');
  });
});
