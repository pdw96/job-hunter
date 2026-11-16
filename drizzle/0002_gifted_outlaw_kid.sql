CREATE TABLE "profile_contacts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"legal_name" text,
	"phone" text,
	"address" text,
	"birth_date" date,
	"contact_email" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_contacts" ADD CONSTRAINT "profile_contacts_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;