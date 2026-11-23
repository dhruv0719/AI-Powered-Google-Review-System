CREATE TABLE "ephemeral_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"issued_code" varchar(32) NOT NULL,
	"feedback_submitted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_ephemeral_token_hash" UNIQUE("token_hash"),
	CONSTRAINT "unique_ephemeral_session_composite" UNIQUE("tenant_id","location_id","campaign_id","id")
);
--> statement-breakpoint
CREATE TABLE "private_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"feedback_text" text,
	"customer_contact" varchar(100),
	"consent_given" boolean NOT NULL,
	"consent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consent_version" varchar(20) DEFAULT 'v1.0' NOT NULL,
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_session_private_feedback" UNIQUE("session_id"),
	CONSTRAINT "unique_tenant_location_feedback" UNIQUE("tenant_id","location_id","id"),
	CONSTRAINT "check_feedback_rating" CHECK ("private_feedback"."rating" >= 1 AND "private_feedback"."rating" <= 5),
	CONSTRAINT "check_feedback_text_length" CHECK ("private_feedback"."feedback_text" IS NULL OR (char_length(trim("private_feedback"."feedback_text")) >= 3 AND char_length("private_feedback"."feedback_text") <= 1000)),
	CONSTRAINT "check_consent_affirmative" CHECK ("private_feedback"."consent_given" = true),
	CONSTRAINT "check_feedback_status" CHECK ("private_feedback"."status" IN ('new', 'reviewed', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "private_feedback_services" (
	"feedback_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"service_name_snapshot" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_feedback_services_feedback_id_service_id_pk" PRIMARY KEY("feedback_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "qr_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_campaign_code" UNIQUE("code"),
	CONSTRAINT "unique_tenant_location_campaign" UNIQUE("tenant_id","location_id","id"),
	CONSTRAINT "check_campaign_status" CHECK ("qr_campaigns"."status" IN ('active', 'inactive', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "unique_tenant_location_service" UNIQUE("tenant_id","location_id","id");
--> statement-breakpoint
ALTER TABLE "ephemeral_sessions" ADD CONSTRAINT "ephemeral_sessions_tenant_id_location_id_campaign_id_qr_campaigns_tenant_id_location_id_id_fk" FOREIGN KEY ("tenant_id","location_id","campaign_id") REFERENCES "public"."qr_campaigns"("tenant_id","location_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_feedback" ADD CONSTRAINT "private_feedback_tenant_id_location_id_campaign_id_session_id_ephemeral_sessions_tenant_id_location_id_campaign_id_id_fk" FOREIGN KEY ("tenant_id","location_id","campaign_id","session_id") REFERENCES "public"."ephemeral_sessions"("tenant_id","location_id","campaign_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_feedback" ADD CONSTRAINT "private_feedback_tenant_id_location_id_campaign_id_qr_campaigns_tenant_id_location_id_id_fk" FOREIGN KEY ("tenant_id","location_id","campaign_id") REFERENCES "public"."qr_campaigns"("tenant_id","location_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_feedback_services" ADD CONSTRAINT "private_feedback_services_tenant_id_location_id_feedback_id_private_feedback_tenant_id_location_id_id_fk" FOREIGN KEY ("tenant_id","location_id","feedback_id") REFERENCES "public"."private_feedback"("tenant_id","location_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_feedback_services" ADD CONSTRAINT "private_feedback_services_tenant_id_location_id_service_id_services_tenant_id_location_id_id_fk" FOREIGN KEY ("tenant_id","location_id","service_id") REFERENCES "public"."services"("tenant_id","location_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_campaigns" ADD CONSTRAINT "qr_campaigns_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ephemeral_sessions_expires_at" ON "ephemeral_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_private_feedback_tenant_created" ON "private_feedback" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_private_feedback_location" ON "private_feedback" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_qr_campaigns_code" ON "qr_campaigns" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_qr_campaigns_location" ON "qr_campaigns" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_qr_campaigns_tenant" ON "qr_campaigns" USING btree ("tenant_id");