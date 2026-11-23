# Project Structure Document

## AI-Powered Google Review Assistance SaaS Platform

| Field | Value |
|---|---|
| Document Status | Approved Architecture Baseline v1.1 (Final Pre-Implementation) |
| Last Updated | 23 November 2026 |
| Workspace Architecture | Modular Monorepo (pnpm / npm Workspaces) |
| Language Standard | TypeScript 5+ (Strict Mode) |

---

## 1. Directory Tree Overview

```
AI-Powered-Google-Review-System/
├── docs/                                  # Project Documentation
│   ├── PRD.md                             # Product Requirements Document
│   ├── SRS.md                             # Software Requirements Specification
│   ├── BUSINESS_RULES.md                  # Invariant Business & Policy Rules
│   ├── USER_FLOWS.md                      # End-to-End User Journeys
│   ├── AI_SPECIFICATION.md                # AI Prompting & Safety Guidelines
│   ├── SECURITY_REQUIREMENTS.md           # Security & Privacy Guidelines
│   ├── ACCEPTANCE_CRITERIA.md             # Formal Acceptance Criteria
│   └── architecture/                      # Architectural Blueprints
│       ├── SYSTEM_ARCHITECTURE.md         # System Architecture & ADRs
│       ├── DATABASE_DESIGN.md             # Relational Schema & Migration Strategy
│       ├── API_DESIGN.md                  # REST Contracts & Endpoints
│       ├── PROJECT_STRUCTURE.md           # This File
│       ├── IMPLEMENTATION_ROADMAP.md      # Testable Milestones & DoD
│       └── OPEN_DECISIONS.md              # Decision Register & Google Policy Risks
├── packages/
│   └── shared/                            # Shared Types, Zod Schemas & DTOs
│       ├── src/
│       │   ├── contracts/                 # API Request & Response Contracts
│       │   ├── schemas/                   # Zod Validation Schemas
│       │   │   ├── auth.schema.ts         # Excludes is_platform_admin
│       │   │   ├── feedback.schema.ts     # Includes consent_given
│       │   │   ├── ai.schema.ts           # Meaningful input bounds (10-500 chars)
│       │   │   └── location.schema.ts     # Google URL regex validation
│       │   ├── constants/                 # Error codes, limits, regexes
│       │   └── index.ts                   # Library entry point
│       ├── package.json
│       └── tsconfig.json
├── apps/
│   ├── backend/                           # Fastify API Server
│   │   ├── drizzle/                       # Database Migrations & Seeders
│   │   │   ├── migrations/                # Versioned SQL migrations
│   │   │   └── schema.ts                  # Drizzle ORM Schema definitions
│   │   ├── src/
│   │   │   ├── config/                    # Validated Env Config (Zod)
│   │   │   ├── plugins/                   # Fastify Global Plugins
│   │   │   │   ├── db.ts                  # Database connection pool
│   │   │   │   ├── auth.ts                # Owner session cookie verification (sessions table)
│   │   │   │   ├── rate-limit.ts          # In-memory rate limiter (single-instance for MVP)
│   │   │   │   └── logger.ts              # Pino logger with privacy redaction
│   │   │   ├── modules/                   # Domain Modules (Controller + Service)
│   │   │   │   ├── auth/                  # Register, login, logout, sessions table
│   │   │   │   ├── tenant/                # Tenants, subscriptions, memberships
│   │   │   │   ├── location/              # Physical branch locations & review URLs
│   │   │   │   ├── service/               # Service catalogue CRUD
│   │   │   │   ├── qr/                    # QR generation & campaign management
│   │   │   │   ├── ai/                    # LLM adapter, meaningful-input check, policy gate
│   │   │   │   ├── feedback/              # Private feedback collection & merchant inbox
│   │   │   │   ├── analytics/             # Funnel event ingestion & aggregations
│   │   │   │   └── admin/                 # Platform administration & admin_audit_logs
│   │   │   ├── routes/                    # API Route Aggregation
│   │   │   │   ├── public.routes.ts       # Customer /q/:code routes & ephemeral_sessions
│   │   │   │   ├── owner.routes.ts        # Authenticated merchant routes
│   │   │   │   └── admin.routes.ts        # Platform admin routes
│   │   │   ├── server.ts                  # App factory
│   │   │   └── index.ts                   # Server bootstrap
│   │   ├── tests/
│   │   │   ├── unit/                      # Prompt, meaningful-input validation, URL tests
│   │   │   ├── integration/               # Tenant isolation, auth, ephemeral session tests
│   │   │   └── setup.ts                   # Test container DB harness
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── frontend/                          # Client Single Page Application (React)
│       ├── public/                        # Static assets (favicons, manifest)
│       ├── src/
│       │   ├── assets/                    # SVG icons, illustrations
│       │   ├── components/                # Reusable UI Component Kit
│       │   │   ├── ui/                    # Buttons, modals, inputs, badges
│       │   │   └── common/                # Header, footer, alerts
│       │   ├── layouts/                   # Route Shells
│       │   │   ├── PublicCustomerLayout.tsx# Ultra-light mobile shell
│       │   │   └── OwnerPortalLayout.tsx  # Responsive dashboard sidebar/nav
│       │   ├── pages/                     # Routed View Pages
│       │   │   ├── public/                # Anonymous customer QR experience
│       │   │   │   ├── QRScanLanding.tsx  # Direct Google link + choices
│       │   │   │   ├── ReviewAssist.tsx   # Meaningful feedback & AI polish
│       │   │   │   ├── PrivateFeedback.tsx# Separate private feedback form with consent
│       │   │   │   └── InactivePage.tsx   # Expired/suspended campaign notice
│       │   │   └── owner/                 # Business owner portal
│       │   │       ├── LoginPage.tsx
│       │   │       ├── RegisterPage.tsx
│       │   │       ├── DashboardPage.tsx  # High-level funnel metrics
│       │   │       ├── LocationsPage.tsx  # Manage branch review URLs
│       │   │       ├── ServicesPage.tsx   # Manage services catalogue
│       │   │       ├── QRCampaignsPage.tsx# Create & print QR codes
│       │   │       └── FeedbackInbox.tsx  # Read & resolve private feedback
│       │   ├── hooks/                     # Custom React Hooks
│       │   │   ├── useAuth.ts             # Owner authentication state
│       │   │   ├── useClipboard.ts        # Safe copy-to-clipboard hook
│       │   │   └── useApi.ts              # Type-safe fetch client
│       │   ├── services/                  # Backend API Client Wrappers
│       │   ├── App.tsx                    # React Router configuration
│       │   ├── main.tsx                   # React entry point
│       │   └── index.css                  # Tailwind CSS root
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       ├── package.json
│       └── tsconfig.json
├── package.json                           # Root workspace orchestrator
├── tsconfig.base.json                     # Shared TypeScript base configuration
└── README.md
```

---

## 2. Code Organization Rules & Boundary Enforcement

1. **Strict Separation of Session Handlers**:
   - Authenticated owner sessions use `sessions` table via `auth.ts` plugin.
   - Anonymous customer sessions use `ephemeral_sessions` table via `public.routes.ts`.
2. **Platform Admin Security**:
   - Route handlers under `apps/backend/src/modules/admin/` require `req.user.is_platform_admin === true`.
   - All state-changing admin actions write to `admin_audit_logs`.
3. **Private Feedback Separation**:
   - `feedback/` module is isolated from `ai/` and `analytics/`.
   - Logging redaction policy ensures `feedback_text` and `customer_contact` never touch server stdout or APM.
4. **Tenant Boundary Enforcement**:
   - All queries in `owner.*` modules must include an explicit tenant filter: `where(eq(schema.table.tenantId, activeTenantId))`.
