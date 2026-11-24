CREATE TABLE "ephemeral_session_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"client_draft_id" varchar(64) NOT NULL,
	"payload_fingerprint" varchar(64) NOT NULL,
	"draft_text" text NOT NULL,
	"generations_remaining_at_settlement" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_session_client_draft" UNIQUE("session_id","client_draft_id"),
	CONSTRAINT "check_settlement_remaining_bounds" CHECK ("ephemeral_session_drafts"."generations_remaining_at_settlement" >= 0 AND "ephemeral_session_drafts"."generations_remaining_at_settlement" <= 2)
);
--> statement-breakpoint
ALTER TABLE "ephemeral_sessions" ADD COLUMN "generations_remaining" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "ephemeral_sessions" ADD COLUMN "generation_lock_token" uuid;--> statement-breakpoint
ALTER TABLE "ephemeral_sessions" ADD COLUMN "generation_lock_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ephemeral_session_drafts" ADD CONSTRAINT "ephemeral_session_drafts_session_id_ephemeral_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ephemeral_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ephemeral_sessions" ADD CONSTRAINT "check_generations_remaining_bounds" CHECK ("ephemeral_sessions"."generations_remaining" >= 0 AND "ephemeral_sessions"."generations_remaining" <= 3);
