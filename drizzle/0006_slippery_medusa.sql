CREATE TABLE "experiences_experiences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"organization" text,
	"role" text,
	"start_month" text,
	"end_month" text,
	"is_ongoing" boolean DEFAULT false NOT NULL,
	"situation" text,
	"actions" text,
	"result" text,
	"metrics" jsonb NOT NULL,
	"not_done" text,
	"banned_phrases" jsonb NOT NULL,
	"evidence_note" text,
	"tags" jsonb NOT NULL,
	"rubric" jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiences_track_scopes" (
	"experience_id" text NOT NULL,
	"track_id" text NOT NULL,
	"scope" text NOT NULL,
	CONSTRAINT "experiences_track_scopes_experience_id_track_id_pk" PRIMARY KEY("experience_id","track_id")
);
--> statement-breakpoint
ALTER TABLE "experiences_experiences" ADD CONSTRAINT "experiences_experiences_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_track_scopes" ADD CONSTRAINT "experiences_track_scopes_experience_id_experiences_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences_experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences_track_scopes" ADD CONSTRAINT "experiences_track_scopes_track_id_tracks_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiences_experiences_user_idx" ON "experiences_experiences" USING btree ("user_id");