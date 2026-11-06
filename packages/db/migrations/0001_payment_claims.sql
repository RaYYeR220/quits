CREATE TABLE "payment_claims" (
	"digest" text PRIMARY KEY NOT NULL,
	"debt_id" text NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_claims_debt_id_unique" UNIQUE("debt_id")
);
