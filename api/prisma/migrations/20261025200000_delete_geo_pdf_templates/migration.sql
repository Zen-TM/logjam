-- GeoPDF templates are removed. Nothing reads or writes the rows any more, and
-- the data export no longer lists them, so none is held. The table and its
-- Prisma model stay until the release after this one drops them.
DELETE FROM "geo_pdf_templates";
