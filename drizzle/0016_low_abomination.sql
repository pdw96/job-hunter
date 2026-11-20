CREATE TABLE "experiences_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"content_version" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"track_scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"moved_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"organization" text,
	"start_month" text,
	"end_month" text,
	"is_ongoing" boolean DEFAULT false NOT NULL,
	"role" text
);
--> statement-breakpoint
CREATE TABLE "experiences_courses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"content_version" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"track_scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"moved_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"institution" text,
	"start_month" text,
	"end_month" text,
	"hours" integer,
	"learned" text
);
--> statement-breakpoint
CREATE TABLE "experiences_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"content_version" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"track_scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"moved_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"issuer" text,
	"month" text,
	"score" text
);
--> statement-breakpoint
CREATE TABLE "experiences_education" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"content_version" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"track_scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"moved_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"school_name" text NOT NULL,
	"location" text,
	"degree" text NOT NULL,
	"major" text,
	"start_month" text,
	"end_month" text,
	"status" text NOT NULL,
	"gpa" text,
	"gpa_scale" text
);
--> statement-breakpoint
CREATE TABLE "experiences_gaps" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"content_version" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"track_scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"moved_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"start_month" text NOT NULL,
	"end_month" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "experiences_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"content_version" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"track_scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"moved_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company" text NOT NULL,
	"department" text,
	"title" text,
	"employment" text NOT NULL,
	"start_month" text,
	"end_month" text,
	"is_ongoing" boolean DEFAULT false NOT NULL,
	"duties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"banned_phrases" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiences_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"step" text NOT NULL,
	"old_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiences_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"content_version" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"track_scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"moved_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"job_id" text,
	"education_id" text,
	"course_id" text,
	"start_month" text,
	"end_month" text,
	"is_ongoing" boolean DEFAULT false NOT NULL,
	"role" text,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"banned_phrases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "experiences_projects_one_parent" CHECK (num_nonnulls("experiences_projects"."job_id", "experiences_projects"."education_id", "experiences_projects"."course_id") <= 1)
);
--> statement-breakpoint
CREATE TABLE "experiences_record_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scene_id" text,
	"job_id" text,
	"project_id" text,
	"kind" text NOT NULL,
	"quote" text NOT NULL,
	"phrase" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"origin" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiences_record_claims_one_owner" CHECK (num_nonnulls("experiences_record_claims"."scene_id", "experiences_record_claims"."job_id", "experiences_record_claims"."project_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "experiences_scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"content_version" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"track_scopes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"moved_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" text,
	"project_id" text,
	"activity_id" text,
	"title" text NOT NULL,
	"start_month" text,
	"end_month" text,
	"is_ongoing" boolean DEFAULT false NOT NULL,
	"situation" text,
	"judgment" text,
	"actions" text,
	"result" text,
	"lessons" text,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"not_done" text,
	"banned_phrases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_note" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rubric" jsonb NOT NULL,
	"phrase_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dismissed_phrases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"judged_at" timestamp with time zone,
	CONSTRAINT "experiences_scenes_one_head" CHECK (num_nonnulls("experiences_scenes"."job_id", "experiences_scenes"."project_id", "experiences_scenes"."activity_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "experiences_interviews" ADD COLUMN "scene_id" text;--> statement-breakpoint
ALTER TABLE "experiences_interviews" ADD COLUMN "head_kind" text;--> statement-breakpoint
ALTER TABLE "experiences_interviews" ADD COLUMN "head_id" text;--> statement-breakpoint
ALTER TABLE "experiences_activities" ADD CONSTRAINT "experiences_activities_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_courses" ADD CONSTRAINT "experiences_courses_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_credentials" ADD CONSTRAINT "experiences_credentials_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_education" ADD CONSTRAINT "experiences_education_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_gaps" ADD CONSTRAINT "experiences_gaps_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_jobs" ADD CONSTRAINT "experiences_jobs_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_moves" ADD CONSTRAINT "experiences_moves_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_projects" ADD CONSTRAINT "experiences_projects_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_projects" ADD CONSTRAINT "experiences_projects_job_id_experiences_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."experiences_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_projects" ADD CONSTRAINT "experiences_projects_education_id_experiences_education_id_fk" FOREIGN KEY ("education_id") REFERENCES "public"."experiences_education"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_projects" ADD CONSTRAINT "experiences_projects_course_id_experiences_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."experiences_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_record_claims" ADD CONSTRAINT "experiences_record_claims_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_record_claims" ADD CONSTRAINT "experiences_record_claims_scene_id_experiences_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."experiences_scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_record_claims" ADD CONSTRAINT "experiences_record_claims_job_id_experiences_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."experiences_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_record_claims" ADD CONSTRAINT "experiences_record_claims_project_id_experiences_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."experiences_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_scenes" ADD CONSTRAINT "experiences_scenes_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_scenes" ADD CONSTRAINT "experiences_scenes_job_id_experiences_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."experiences_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_scenes" ADD CONSTRAINT "experiences_scenes_project_id_experiences_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."experiences_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_scenes" ADD CONSTRAINT "experiences_scenes_activity_id_experiences_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."experiences_activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiences_activities_user_idx" ON "experiences_activities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "experiences_courses_user_idx" ON "experiences_courses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "experiences_credentials_user_idx" ON "experiences_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "experiences_education_user_idx" ON "experiences_education" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "experiences_gaps_user_idx" ON "experiences_gaps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "experiences_jobs_user_idx" ON "experiences_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "experiences_moves_user_idx" ON "experiences_moves" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "experiences_moves_user_old_idx" ON "experiences_moves" USING btree ("user_id","old_id");--> statement-breakpoint
CREATE INDEX "experiences_projects_user_idx" ON "experiences_projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "experiences_record_claims_user_idx" ON "experiences_record_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "experiences_scenes_user_idx" ON "experiences_scenes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "experiences_interviews" ADD CONSTRAINT "experiences_interviews_scene_id_experiences_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."experiences_scenes"("id") ON DELETE cascade ON UPDATE no action;