-- CreateTable
CREATE TABLE "geo_pdf_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_pdf_templates_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "geo_pdf_templates" ADD CONSTRAINT "geo_pdf_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
