ALTER TABLE "private_feedback" ADD COLUMN "client_submission_id" varchar(64);--> statement-breakpoint
ALTER TABLE "private_feedback" ADD COLUMN "payload_fingerprint" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "unique_campaign_client_submission_id" ON "private_feedback" USING btree ("campaign_id","client_submission_id") WHERE "client_submission_id" IS NOT NULL;
