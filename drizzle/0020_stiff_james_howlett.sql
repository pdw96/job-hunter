ALTER TABLE "applications_questions" ADD COLUMN "kinds" jsonb;--> statement-breakpoint
ALTER TABLE "applications_questions" ADD COLUMN "topics" jsonb;--> statement-breakpoint
ALTER TABLE "applications_questions" ADD COLUMN "freeform_item" text;