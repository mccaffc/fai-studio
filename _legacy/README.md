# Legacy data (June 2026 rebuild)

`tiles-manifest.json` — the original v1 tile manifest. Superseded by
`tiles-manifest-v2.json` at the project root, which is now the single canonical
manifest read by every live tool (`fai_banner.py`, `fai_contact.py`,
`fai_calibrate.py`, `build_dominant_direction.py`). v2 adds `dominant_direction`,
`raster_fill`, `fg_centroid`, accurate `path_count`, and a `quarantine` list.

Kept for reference / rollback only. Safe to delete after the rebuild is ratified.
