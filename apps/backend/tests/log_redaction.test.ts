import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { getEnv } from '../src/config/env.js';

describe('Log Redaction Integration Tests', () => {
  it('should redact sensitive PII (feedback, contact, password, cookie) from logs', async () => {
    let loggedData = '';
    const env = getEnv();

    const server = Fastify({
      logger: {
        level: 'info',
        stream: {
          write: (msg: string) => {
            loggedData += msg;
          },
        },
        redact: {
          paths: [
            'req.body.password',
            'req.body.feedback',
            'req.body.feedbackText',
            'req.body.customerContact',
            'req.body.feedback_text',
            'req.body.customer_contact',
            'req.headers.cookie',
            'body.password',
            'body.feedback',
            'body.feedbackText',
            'body.customerContact',
            'body.feedback_text',
            'body.customer_contact',
            'headers.cookie',
            'res.body.draft',
          ],
          censor: '[REDACTED]',
        },
      },
    });

    server.post('/test-log', async (req, reply) => {
      req.log.info({ body: req.body }, 'Processing feedback submission');
      return reply.send({ ok: true });
    });

    await server.ready();

    const secretPassword = 'SUPER_SECRET_PASSWORD_123';
    const secretFeedback = 'VERY_SENSITIVE_CUSTOMER_FEEDBACK';
    const secretContact = 'confidential_user@example.com';

    await server.inject({
      method: 'POST',
      url: '/test-log',
      headers: {
        cookie: 'customer_session=secret_token_12345',
      },
      payload: {
        password: secretPassword,
        feedbackText: secretFeedback,
        customerContact: secretContact,
      },
    });

    await server.close();

    // Verify raw secret values are NEVER present in logged output
    expect(loggedData).not.toContain(secretPassword);
    expect(loggedData).not.toContain(secretFeedback);
    expect(loggedData).not.toContain(secretContact);
    expect(loggedData).not.toContain('secret_token_12345');

    // Verify censor token is present
    expect(loggedData).toContain('[REDACTED]');
  });
});
