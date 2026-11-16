CREATE TABLE "ncs_aliases" (
	"alias" text NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "ncs_aliases_alias_code_pk" PRIMARY KEY("alias","code")
);
--> statement-breakpoint
CREATE TABLE "ncs_categories" (
	"code" text PRIMARY KEY NOT NULL,
	"level" integer NOT NULL,
	"name" text NOT NULL,
	"parent_code" text
);
--> statement-breakpoint
ALTER TABLE "ncs_aliases" ADD CONSTRAINT "ncs_aliases_code_ncs_categories_code_fk" FOREIGN KEY ("code") REFERENCES "public"."ncs_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncs_categories" ADD CONSTRAINT "ncs_categories_parent_code_ncs_categories_code_fk" FOREIGN KEY ("parent_code") REFERENCES "public"."ncs_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ncs_categories_parent_idx" ON "ncs_categories" USING btree ("parent_code");