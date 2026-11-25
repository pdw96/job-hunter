ALTER TABLE "experiences_projects" DROP CONSTRAINT "experiences_projects_one_parent";--> statement-breakpoint
ALTER TABLE "experiences_scenes" DROP CONSTRAINT "experiences_scenes_one_head";--> statement-breakpoint
ALTER TABLE "experiences_projects" ADD COLUMN "activity_id" text;--> statement-breakpoint
ALTER TABLE "experiences_scenes" ADD COLUMN "education_id" text;--> statement-breakpoint
ALTER TABLE "experiences_scenes" ADD COLUMN "course_id" text;--> statement-breakpoint
ALTER TABLE "experiences_projects" ADD CONSTRAINT "experiences_projects_activity_id_experiences_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."experiences_activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_scenes" ADD CONSTRAINT "experiences_scenes_education_id_experiences_education_id_fk" FOREIGN KEY ("education_id") REFERENCES "public"."experiences_education"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_scenes" ADD CONSTRAINT "experiences_scenes_course_id_experiences_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."experiences_courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_projects" ADD CONSTRAINT "experiences_projects_one_parent" CHECK (num_nonnulls("experiences_projects"."job_id", "experiences_projects"."education_id", "experiences_projects"."course_id", "experiences_projects"."activity_id") <= 1);--> statement-breakpoint
ALTER TABLE "experiences_scenes" ADD CONSTRAINT "experiences_scenes_one_head" CHECK (num_nonnulls("experiences_scenes"."job_id", "experiences_scenes"."project_id", "experiences_scenes"."activity_id", "experiences_scenes"."education_id", "experiences_scenes"."course_id") = 1);