CREATE TABLE "tracks_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"track_id" text NOT NULL,
	"ncs_code" text,
	"custom_name" text,
	"position" integer NOT NULL,
	CONSTRAINT "tracks_jobs_one_of" CHECK (("tracks_jobs"."ncs_code" is null) <> ("tracks_jobs"."custom_name" is null))
);
--> statement-breakpoint
CREATE TABLE "tracks_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"major_code" text NOT NULL,
	"applicant_type" text NOT NULL,
	"experience_months" integer,
	"regions" jsonb NOT NULL,
	"salary_min" integer,
	"employment_types" jsonb NOT NULL,
	"importance_order" jsonb NOT NULL,
	"weights" jsonb NOT NULL,
	"extra_answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracks_jobs" ADD CONSTRAINT "tracks_jobs_track_id_tracks_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks_jobs" ADD CONSTRAINT "tracks_jobs_ncs_code_ncs_categories_code_fk" FOREIGN KEY ("ncs_code") REFERENCES "public"."ncs_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks_tracks" ADD CONSTRAINT "tracks_tracks_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks_tracks" ADD CONSTRAINT "tracks_tracks_major_code_ncs_categories_code_fk" FOREIGN KEY ("major_code") REFERENCES "public"."ncs_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracks_jobs_track_idx" ON "tracks_jobs" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "tracks_tracks_user_idx" ON "tracks_tracks" USING btree ("user_id");