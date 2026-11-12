CREATE TABLE "cosmos"."doc_embedding" (
	"model" text NOT NULL,
	"content_hash" text NOT NULL,
	"vector" real[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_embedding_model_content_hash_pk" PRIMARY KEY("model","content_hash")
);
