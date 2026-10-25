-- GeoPDF templates are removed, and the data export no longer lists them, so
-- this deletes the rows that exist at deploy. The previous image can still save
-- one until it is replaced, so the release that drops the table deletes again
-- first. The table and its Prisma model stay until then (ADR 0003). Guard:
-- prisma/upgrade-check/verify.sql.
DELETE FROM "geo_pdf_templates";
