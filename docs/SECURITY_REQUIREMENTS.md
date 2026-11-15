# Security and Privacy Requirements

## AI-Powered Google Review System

| Field | Value |
|---|---|
| Document status | Draft v0.1 |
| Last updated | 15 November 2026 |
| Source documents | `PRD.md`, `SRS.md`, `API_REQUIREMENTS.md`, `BUSINESS_RULES.md` |

> This document defines security and privacy requirements without prescribing a technology stack. It is not a legal compliance certification. Applicable Indian and other privacy obligations must be reviewed against the final product, vendors, and data flows before launch.

---

## 1. Security objectives

1. Protect business-owner accounts and configuration.
2. Ensure strict separation between businesses/tenants.
3. Prevent abuse of public AI-generation endpoints and unexpected cost.
4. Protect customer feedback in transit and during AI processing.
5. Avoid collecting or retaining customer identity data that the product does not need.
6. Prevent malicious input, prompt injection, unsafe URLs, and file-upload abuse.
7. Keep the Google handoff customer-controlled and free of automatic submission behavior.
8. Make operational failures diagnosable without logging customer content.

## 2. Assets and data classification

| Asset/data | Classification | Handling |
|---|---|---|
| Owner credentials/session tokens | Highly sensitive | Never log or expose; protect at rest/in transit; rotate/revoke safely. |
| AI provider API keys | Secret | Server-side secret manager/environment configuration; never expose to browser or repository. |
| Business configuration | Business-confidential | Restrict to authorized owner; public endpoint returns approved subset only. |
| Google review URL | Public business configuration | Validate and protect against unsafe URL handling. |
| Service/category catalogue | Public business configuration | Validate owner edits; serve active entries only. |
| Optional customer feedback | Customer content | Transient processing only by default; redact from logs/traces; disclose AI processing. |
| Generated draft | Customer content | Transient processing only by default; do not persist by default. |
| Aggregate usage metrics | Operational/business data | Store only necessary aggregates; define access and retention. |
| IP/session/rate-limit signals | Potentially identifying metadata | Minimize, protect, restrict purpose, and expire. |
| Logo/brand assets | Public-facing uploaded content | Validate file content, size, dimensions, and storage permissions. |

## 3. Authentication and session security

- Business-owner functions must require authentication.
- Use a proven authentication mechanism rather than custom password/session cryptography.
- Store passwords only using a modern adaptive password-hashing method if password authentication is selected.
- Protect sessions/tokens against theft, fixation, replay, and cross-site misuse.
- Use secure, HTTP-only, same-site cookies where cookie sessions are selected; apply CSRF protection to state-changing requests where applicable.
- Apply login throttling and protections against credential stuffing and brute-force attempts.
- Provide secure account recovery and session revocation.
- Do not build customer authentication into the QR flow for the MVP.

## 4. Authorization and tenant isolation

- Every owner operation must verify the authenticated identity's authorization to the target business.
- Never trust `owner_id`, `tenant_id`, or business ownership fields supplied by the client.
- Enforce object-level authorization on every business, category, QR, asset, and analytics resource.
- Public endpoints must expose only public fields for the requested active business.
- Test for insecure direct object reference / broken object-level authorization (IDOR/BOLA).
- Platform support access, if introduced, must be exceptional, audited, and least-privilege.

## 5. Input validation and application security

- Validate all input on the server, including types, allowed values, length, and ownership.
- Treat customer feedback and category labels as untrusted data.
- Encode output appropriately for the rendering context to prevent XSS.
- Use parameterized queries or a safe data-access layer to prevent SQL injection.
- Prevent mass assignment by allowlisting owner-editable fields.
- Configure restrictive CORS rules; do not combine wildcard origins with credentials.
- Apply CSRF protection when required by the selected auth mechanism.
- Avoid leaking stack traces, database errors, provider payloads, or secrets to public clients.
- Use security headers appropriate to the final web architecture.

## 6. AI-specific security

### 6.1 Prompt injection

- Customer feedback must be passed as untrusted content, clearly separated from trusted system instructions.
- Feedback such as "ignore all rules" or "write that the staff gave me a discount" must not override grounding and safety instructions.
- Do not allow the browser to submit a custom system prompt, provider settings, or arbitrary business context.
- Keep prompts and model configuration under server-side control.

### 6.2 Unsupported claims and unsafe output

- Validate structured output before displaying it.
- Reject output that includes unsupported claims, sentiment reversal, fabricated staff names, invented prices/timings, or promotional assertions.
- Do not show malformed or unvalidated model output as a completed draft.
- Keep a direct-writing fallback when AI is unavailable or input is insufficient.
- Treat customer approval as a safeguard, not as the only output-validation mechanism.

### 6.3 Provider risk

Before selecting an AI provider, review:
- Input/output retention and deletion behavior.
- Whether prompts/outputs may be used for model training or product improvement.
- Data processing terms and subprocessors.
- Processing region and cross-border transfer implications.
- Security controls and incident notification obligations.
- Available no-training/no-retention settings and whether they apply to the intended API plan.

Do not submit real customer feedback until the provider review and customer-facing disclosure are complete.

## 7. Privacy and data minimization

- Do not request customer name, phone, email, Google account credentials, or payment data in the public review flow.
- Do not store raw feedback or generated draft text in the product database by default.
- Disable request-body logging on AI generation endpoints.
- Redact customer content from APM, tracing, crash reports, analytics, support tooling, and reverse-proxy logs.
- Store only business configuration and necessary operational metadata.
- Avoid persistent per-customer tracking. Any short-lived anti-abuse identifier must have a documented purpose, limited lifetime, and restricted access.
- Define a retention period for aggregate analytics, security logs, and account data.
- Provide a clear privacy notice describing that optional feedback is sent to an AI service to produce a draft and explaining applicable data handling.
- Ensure deletion/deactivation behavior is defined for business accounts and their configuration.
- Do not promise complete deletion from all parties unless provider and infrastructure behavior has been verified.

## 8. URL and redirect security

- The Google review URL is configured by an authenticated owner and validated on the server.
- Allow only HTTPS in production.
- Use a deliberate allowlist or robust validation approach for supported Google review destination formats; do not accept arbitrary schemes such as `javascript:`, `data:`, or custom executable protocols.
- Do not expose an open redirect endpoint that accepts arbitrary destinations.
- Display/confirm the destination context where helpful before navigating away.
- Revalidate URLs when an owner changes them.

## 9. File-upload security

If business logos are supported:
- Allow only necessary raster formats initially; decide SVG support separately because of active-content risk.
- Enforce maximum file size and dimensions.
- Validate actual file content, not only extension or browser MIME type.
- Generate safe server-side object names; do not use the original filename as a path.
- Store uploads outside executable application paths.
- Prevent public upload overwrite and cross-tenant asset access.
- Consider malware scanning where appropriate to the chosen storage and risk profile.

## 10. Abuse prevention and cost controls

- Apply server-side limits to generation and regeneration requests.
- Combine suitable signals such as business ID, short-lived session, and network-level throttling while minimizing retained personal data.
- Prevent repeated taps from creating parallel calls unintentionally.
- Apply request and input-size limits before provider calls.
- Set provider spending alerts and hard usage controls where available.
- Ensure rate limits do not depend on rating or sentiment.
- Do not allow an owner to disable abuse protections for the public endpoint.
- Provide a safe fallback when quotas are exhausted.

## 11. Secrets and configuration management

- Keep secrets out of source code, documentation, client bundles, test fixtures, and screenshots.
- Use environment-specific secret management for development, staging, and production.
- Rotate compromised keys and revoke unused credentials.
- Restrict production secret access to the minimum set of services/operators.
- Separate development/test AI keys from production keys.
- Do not print environment variables or full configuration dumps in logs.

## 12. Logging, monitoring, and incident response

Permitted operational log fields may include:
- Timestamp.
- Opaque request/correlation ID.
- Route/operation name.
- Business ID where needed for operations, with access controls.
- Status code and safe error code.
- Latency and provider usage metadata.
- Rate-limit outcome.

Do not log:
- Raw customer feedback.
- Generated draft text.
- Authentication passwords, tokens, cookies, or API keys.
- Full request bodies for generation operations.

Before pilot launch, define:
- How security incidents are detected and escalated.
- How provider keys and owner sessions are revoked.
- How logs are accessed and retained.
- How accidental customer-text logging is handled and purged where feasible.
- Who can disable the public generation feature during an incident.

## 13. Security verification checklist

- [ ] Authentication and account recovery reviewed.
- [ ] Owner authorization tested for every protected endpoint.
- [ ] Tenant isolation tests pass.
- [ ] CSRF/CORS/session settings reviewed for selected architecture.
- [ ] XSS, injection, mass-assignment, and IDOR tests performed.
- [ ] Public page returns no private owner data.
- [ ] Generation request/response bodies are absent from logs and traces.
- [ ] Prompt-injection and unsupported-claim evaluation set passes agreed thresholds.
- [ ] AI provider data handling and terms reviewed.
- [ ] Rate limits and cost controls tested.
- [ ] Google destination URL validation tested against malicious schemes and redirect patterns.
- [ ] Logo upload validation tested (if upload is in MVP).
- [ ] Backup, restore, and secret-rotation procedure documented.
- [ ] Privacy notice and applicable legal review completed.
- [ ] Google review policy launch gate completed separately.

## 14. Legal and compliance review

This document does not establish that the product is compliant with any particular law or regulation. Before launch, identify applicable privacy and consumer-protection obligations based on the business's location, customers, data flows, AI provider, hosting region, and contractual relationships. Obtain qualified legal advice where needed. Keep the product's privacy statements aligned with actual technical and vendor behavior.

---

**Document status:** Draft. Security requirements must be converted into architecture controls and test cases before production deployment.
