CREATE TABLE "applications_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"topic" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"posting_id" text,
	"company" text NOT NULL,
	"company_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications_questions" ADD COLUMN "asks" jsonb;--> statement-breakpoint
ALTER TABLE "applications_questions" ADD COLUMN "answer_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "applications_answers" ADD CONSTRAINT "applications_answers_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications_answers" ADD CONSTRAINT "applications_answers_posting_id_postings_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings_postings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_answers_user_topic_idx" ON "applications_answers" USING btree ("user_id","topic");