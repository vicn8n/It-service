CREATE TABLE "kb_attachments" (
    "id" SERIAL NOT NULL,
    "article_id" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kb_attachments_article_id_idx" ON "kb_attachments"("article_id");

ALTER TABLE "kb_attachments" ADD CONSTRAINT "kb_attachments_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "kb_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
