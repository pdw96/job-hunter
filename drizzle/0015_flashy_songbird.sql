CREATE TABLE "applications_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"posting_id" text NOT NULL,
	"number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"reopened_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "applications_submissions" ADD CONSTRAINT "applications_submissions_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications_submissions" ADD CONSTRAINT "applications_submissions_posting_id_postings_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings_postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_submissions_posting_number_idx" ON "applications_submissions" USING btree ("posting_id","number");--> statement-breakpoint
CREATE INDEX "applications_submissions_user_posting_idx" ON "applications_submissions" USING btree ("user_id","posting_id");