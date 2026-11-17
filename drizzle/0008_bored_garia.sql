ALTER TABLE "experiences_experiences" ADD COLUMN "content_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences_experiences" ADD COLUMN "phrase_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences_experiences" ADD COLUMN "dismissed_phrases" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences_experiences" ADD COLUMN "judged_at" timestamp with time zone;