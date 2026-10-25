-- Last step of removing GeoPDF templates (ADR 0003): the readers and writers
-- went and the rows were deleted in 20261025200000, and no running image uses
-- the table now.
DROP TABLE "geo_pdf_templates";
