"""Shared context object + S3 helpers passed into each renderer."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

log = logging.getLogger("export_worker.context")


class RenderError(Exception):
    """User-visible export failure. Worker echoes the message into the email."""


RASTER_LAYERS = {"hillshade", "vegetation", "slope"}
VECTOR_LAYERS = {"contours", "features"}


@dataclass
class RenderContext:
    s3: Any
    bucket: str
    work_dir: Path
    source_jobs: List[dict]
    layers: List[str]
    bundling: str   # "composite" | "per-layer"
    vector_style: Dict[str, Any]

    # Local caches populated lazily by ensure_* helpers.
    _cog_paths: Dict[str, Path] = field(default_factory=dict)
    _geojson_paths: Dict[str, Path] = field(default_factory=dict)

    @property
    def is_composite(self) -> bool:
        return self.bundling == "composite"

    @property
    def primary_job(self) -> dict:
        return self.source_jobs[0]

    def output_keys_for(self, job: dict) -> List[dict]:
        return list(job.get("s3_output_keys") or [])

    def cog_path(self, job_id: str, layer: str) -> Path:
        """Local Path to the styled COG for a given job/layer, downloading on
        first access. Raises RenderError if the layer is not raster or the
        upstream job did not produce a COG."""
        if layer not in RASTER_LAYERS:
            raise RenderError(f"Layer '{layer}' has no COG (not a raster layer)")
        cache_key = f"{job_id}/{layer}.tif"
        if cache_key in self._cog_paths:
            return self._cog_paths[cache_key]

        job = next((j for j in self.source_jobs if j["id"] == job_id), None)
        if job is None:
            raise RenderError(f"Source job {job_id} not in context")
        match = next((o for o in self.output_keys_for(job) if o.get("name") == layer), None)
        if not match or not match.get("cogKey"):
            raise RenderError(f"Source job {job_id} has no {layer} COG")

        local = self.work_dir / f"sources_{job_id}_{layer}.tif"
        log.info(f"Downloading s3://{self.bucket}/{match['cogKey']}")
        self.s3.download_file(self.bucket, match["cogKey"], str(local))
        self._cog_paths[cache_key] = local
        return local

    def geojson_path(self, job_id: str, layer: str) -> Path:
        """Local Path to the raw vector GeoJSON for a given job/layer."""
        if layer not in VECTOR_LAYERS:
            raise RenderError(f"Layer '{layer}' has no GeoJSON (not a vector layer)")
        cache_key = f"{job_id}/{layer}.geojson"
        if cache_key in self._geojson_paths:
            return self._geojson_paths[cache_key]

        # Fixed worker filenames (see topo/worker.py).
        filename = {
            "contours": "contours_5m.geojson",
            "features": "osm_features.geojson",
        }[layer]
        key = f"outputs/{job_id}/{filename}"
        local = self.work_dir / f"sources_{job_id}_{layer}.geojson"
        log.info(f"Downloading s3://{self.bucket}/{key}")
        try:
            self.s3.download_file(self.bucket, key, str(local))
        except Exception as e:
            raise RenderError(f"Source job {job_id} has no {layer} GeoJSON: {e}")
        self._geojson_paths[cache_key] = local
        return local
