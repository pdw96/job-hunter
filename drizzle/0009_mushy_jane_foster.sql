CREATE TABLE "experiences_interviews" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"experience_id" text,
	"track_id" text,
	"messages" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiences_interviews" ADD CONSTRAINT "experiences_interviews_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_interviews" ADD CONSTRAINT "experiences_interviews_experience_id_experiences_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences_experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_interviews" ADD CONSTRAINT "experiences_interviews_track_id_tracks_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks_tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiences_interviews_user_idx" ON "experiences_interviews" USING btree ("user_id");