CREATE TABLE "api_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"debt_id" text NOT NULL,
	"user_id" text NOT NULL,
	"decision" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"expense_id" text NOT NULL,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"rule_id" text,
	"clarify" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debts" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"debtor_id" text NOT NULL,
	"creditor_id" text NOT NULL,
	"usdc_micro" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"mandate_id" text,
	"onchain_debt_id" text,
	"pullable_at" timestamp with time zone,
	"tx_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "debts_tx_digest_unique" UNIQUE("tx_digest")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"payer_id" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"fx_rate" text,
	"fx_source" text,
	"fx_at" timestamp with time zone,
	"usdc_micro" bigint NOT NULL,
	"participants" text[] NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applied" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"raw_text" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"created_by" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"group_id" text NOT NULL,
	"allowance_id" text NOT NULL,
	"mandate_object_id" text NOT NULL,
	"lifetime_cap" bigint NOT NULL,
	"weekly_limit" bigint NOT NULL,
	"max_per_debt" bigint NOT NULL,
	"objection_window_ms" bigint NOT NULL,
	"creditors" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"open_tx" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandates_mandate_object_id_unique" UNIQUE("mandate_object_id")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"ns" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"account_id" text,
	"job_id" text,
	"blob_id" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stored_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"group_id" text,
	"user_id" text,
	"kind" text NOT NULL,
	"body" jsonb NOT NULL,
	"sentence" text NOT NULL,
	"learned_at" timestamp with time zone NOT NULL,
	"memory_id" text,
	"source_expense_id" text,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"expense_id" text NOT NULL,
	"member_id" text NOT NULL,
	"usdc_micro" bigint NOT NULL,
	CONSTRAINT "shares_expense_id_member_id_pk" PRIMARY KEY("expense_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "tatum_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"surface" text NOT NULL,
	"method" text NOT NULL,
	"ms" integer NOT NULL,
	"ok" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"chat_id" text NOT NULL,
	"group_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_users" (
	"telegram_user_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sui_address" text,
	"auth_provider" text NOT NULL,
	"memwal_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_sui_address_unique" UNIQUE("sui_address")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_debt_id_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_users" ADD CONSTRAINT "telegram_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "debts_group_idx" ON "debts" USING btree ("group_id","status");--> statement-breakpoint
CREATE INDEX "expenses_group_idx" ON "expenses" USING btree ("group_id","occurred_at");--> statement-breakpoint
CREATE INDEX "memories_state_idx" ON "memories" USING btree ("state");--> statement-breakpoint
CREATE INDEX "memories_ns_idx" ON "memories" USING btree ("ns");--> statement-breakpoint
CREATE INDEX "rules_group_idx" ON "rules" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "rules_user_idx" ON "rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tatum_calls_at_idx" ON "tatum_calls" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_chat_idx" ON "telegram_links" USING btree ("chat_id");