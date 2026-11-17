CREATE TABLE "postings_postings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"deadline" date,
	"is_rolling" boolean DEFAULT false NOT NULL,
	"location_text" text,
	"regions" jsonb NOT NULL,
	"career_type" text NOT NULL,
	"min_years" integer,
	"employment_type" text NOT NULL,
	"url" text,
	"raw_text" text NOT NULL,
	"company_note" text,
	"status" text DEFAULT 'interest' NOT NULL,
	"exclude_override" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "postings_postings" ADD CONSTRAINT "postings_postings_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings_postings" ADD CONSTRAINT "postings_postings_track_id_tracks_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "postings_postings_user_track_idx" ON "postings_postings" USING btree ("user_id","track_id");