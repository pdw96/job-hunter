CREATE TABLE "applications_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"posting_id" text NOT NULL,
	"position" integer NOT NULL,
	"prompt" text NOT NULL,
	"char_limit" integer,
	"count_spaces" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"selection" jsonb,
	"draft" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications_questions" ADD CONSTRAINT "applications_questions_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications_questions" ADD CONSTRAINT "applications_questions_posting_id_postings_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings_postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_questions_user_posting_idx" ON "applications_questions" USING btree ("user_id","posting_id");