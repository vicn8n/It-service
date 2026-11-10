CREATE TABLE "asset_software_assignments" (
  "id" SERIAL NOT NULL,
  "asset_id" INTEGER NOT NULL,
  "license_id" INTEGER NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  CONSTRAINT "asset_software_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_software_assignments_asset_id_license_id_key" ON "asset_software_assignments"("asset_id", "license_id");
CREATE INDEX "asset_software_assignments_asset_id_idx" ON "asset_software_assignments"("asset_id");
CREATE INDEX "asset_software_assignments_license_id_idx" ON "asset_software_assignments"("license_id");

ALTER TABLE "asset_software_assignments"
  ADD CONSTRAINT "asset_software_assignments_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_software_assignments"
  ADD CONSTRAINT "asset_software_assignments_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "software_licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
