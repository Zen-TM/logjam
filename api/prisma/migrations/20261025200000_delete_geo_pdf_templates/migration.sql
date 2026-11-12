-- GeoPDF templates are removed, and the data export no longer lists them, so
-- this deletes the rows that exist at deploy. The previous image can still save
-- one until it is replaced; that straggler goes with the table, which drops a
-- release later along with its Prisma model (ADR 0003).
DELETE FROM "geo_pdf_templates";
