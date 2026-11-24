CREATE TABLE "applications_careers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"posting_id" text,
	"version" integer DEFAULT 0 NOT NULL,
	"selection" jsonb,
	"content" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications_careers" ADD CONSTRAINT "applications_careers_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications_careers" ADD CONSTRAINT "applications_careers_track_id_tracks_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications_careers" ADD CONSTRAINT "applications_careers_posting_id_postings_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings_postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_careers_common_idx" ON "applications_careers" USING btree ("user_id","track_id") WHERE "applications_careers"."posting_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_careers_tailored_idx" ON "applications_careers" USING btree ("posting_id") WHERE "applications_careers"."posting_id" is not null;