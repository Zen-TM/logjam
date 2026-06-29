-- DropForeignKey
ALTER TABLE "trip_logs" DROP CONSTRAINT "trip_logs_canyon_id_fkey";

-- AddForeignKey
ALTER TABLE "trip_logs" ADD CONSTRAINT "trip_logs_canyon_id_fkey" FOREIGN KEY ("canyon_id") REFERENCES "canyons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
