-- A plan place keeps the name and icon of the custom type it was added with.
ALTER TABLE "places" ADD COLUMN "type_name" TEXT,
ADD COLUMN "type_icon_key" TEXT;
