ALTER TABLE "postings_postings" ADD COLUMN "found_documents" jsonb;--> statement-breakpoint
ALTER TABLE "postings_postings" ADD COLUMN "found_questions" jsonb;--> statement-breakpoint
ALTER TABLE "postings_postings" ADD COLUMN "chosen_documents" jsonb;