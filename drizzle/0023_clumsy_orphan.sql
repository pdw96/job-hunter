CREATE TABLE "postings_research" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company_key" text NOT NULL,
	"company" text NOT NULL,
	"status" text NOT NULL,
	"failure" text,
	"started_at" timestamp with time zone NOT NULL,
	"researched_at" timestamp with time zone,
	"talent" jsonb,
	"talent_skipped" boolean DEFAULT false NOT NULL,
	"news" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "postings_research_user_company" UNIQUE("user_id","company_key")
);
--> statement-breakpoint
ALTER TABLE "postings_research" ADD CONSTRAINT "postings_research_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;