CREATE TABLE "experiences_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"experience_id" text NOT NULL,
	"kind" text NOT NULL,
	"quote" text NOT NULL,
	"phrase" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"origin" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiences_experiences" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences_claims" ADD CONSTRAINT "experiences_claims_experience_id_experiences_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences_experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiences_claims_experience_idx" ON "experiences_claims" USING btree ("experience_id");