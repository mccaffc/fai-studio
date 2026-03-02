# Tile Simplification Report

**Total:** 141  |  **OK:** 140  |  **Empty:** 1  |  **Validation failed:** 0  |  **Errors:** 0


## Strategy summary

- `simple_strip`: 67
- `multi_merge`: 30
- `nan_sanitize`: 14
- `primitive_convert+evenodd_holes`: 11
- `geo_clip`: 7
- `primitive_convert`: 6
- `geo_clip+geo_clip+geo_clip`: 2
- `multi_merge+evenodd_holes`: 2
- `geo_clip+geo_clip`: 1
- `clear_tile`: 1

## All results

| File | Status | Strategy | FG shapes in |
|---|---|---|---|
| Angle/01.svg | OK | simple_strip | 1 |
| Angle/02.svg | OK | simple_strip | 1 |
| Angle/03.svg | OK | simple_strip | 1 |
| Angle/04.svg | OK | simple_strip | 1 |
| Angle/05-1.svg | OK | simple_strip | 1 |
| Angle/05-2.svg | OK | simple_strip | 1 |
| Angle/05.svg | OK | simple_strip | 1 |
| Angle/06.svg | OK | simple_strip | 1 |
| Angle/07.svg | OK | simple_strip | 1 |
| Angle/08.svg | OK | simple_strip | 1 |
| Angle/09-1.svg | OK | simple_strip | 1 |
| Angle/09.svg | OK | simple_strip | 1 |
| Angle/10.svg | OK | simple_strip | 1 |
| Cascade/01.svg | OK | nan_sanitize | 1 |
| Cascade/02.svg | OK | nan_sanitize | 1 |
| Cascade/03.svg | OK | nan_sanitize | 1 |
| Cascade/04.svg | OK | nan_sanitize | 1 |
| Cascade/05.svg | OK | simple_strip | 1 |
| Cascade/06.svg | OK | nan_sanitize | 1 |
| Cascade/07.svg | OK | nan_sanitize | 1 |
| Cascade/08.svg | OK | nan_sanitize | 1 |
| Centric/01.svg | OK | nan_sanitize | 1 |
| Centric/02.svg | OK | nan_sanitize | 1 |
| Centric/03.svg | OK | nan_sanitize | 1 |
| Centric/04.svg | OK | geo_clip | 1 |
| Circle/01.svg | OK | simple_strip | 1 |
| Circle/02.svg | OK | simple_strip | 1 |
| Circle/03.svg | OK | simple_strip | 1 |
| Circle/04.svg | OK | simple_strip | 1 |
| Circle/05.svg | OK | primitive_convert | 1 |
| Circle/06.svg | OK | primitive_convert | 1 |
| Circle/07.svg | OK | primitive_convert | 1 |
| Circle/08.svg | OK | primitive_convert | 1 |
| Circle/09.svg | OK | simple_strip | 1 |
| Circle/10.svg | OK | simple_strip | 1 |
| Circle/11.svg | OK | simple_strip | 1 |
| Circle/12.svg | OK | simple_strip | 1 |
| Circle/13.svg | OK | primitive_convert+evenodd_holes | 3 |
| Circle/14.svg | OK | simple_strip | 1 |
| Circle/15.svg | OK | simple_strip | 1 |
| Composition/01.svg | OK | simple_strip | 1 |
| Composition/02.svg | OK | multi_merge | 2 |
| Composition/03.svg | OK | primitive_convert+evenodd_holes | 3 |
| Composition/04.svg | OK | nan_sanitize | 2 |
| Composition/05.svg | OK | geo_clip+geo_clip | 3 |
| Composition/06.svg | OK | geo_clip+geo_clip+geo_clip | 5 |
| Composition/07.svg | OK | multi_merge | 2 |
| Composition/08.svg | OK | primitive_convert+evenodd_holes | 2 |
| Composition/09.svg | OK | multi_merge+evenodd_holes | 3 |
| Composition/10.svg | OK | multi_merge+evenodd_holes | 2 |
| Composition/11.svg | OK | primitive_convert+evenodd_holes | 8 |
| Composition/12.svg | OK | geo_clip | 3 |
| Curve/01.svg | OK | simple_strip | 1 |
| Curve/02.svg | OK | simple_strip | 1 |
| Curve/03.svg | OK | simple_strip | 1 |
| Curve/04.svg | OK | simple_strip | 1 |
| Curve/05.svg | OK | primitive_convert+evenodd_holes | 2 |
| Curve/06.svg | OK | simple_strip | 1 |
| Curve/07.svg | OK | simple_strip | 1 |
| Curve/08.svg | OK | simple_strip | 1 |
| Curve/09.svg | OK | nan_sanitize | 1 |
| Curve/10.svg | OK | simple_strip | 1 |
| Float/01.svg | OK | simple_strip | 1 |
| Float/02.svg | OK | primitive_convert | 1 |
| Float/03.svg | OK | primitive_convert | 1 |
| Float/04.svg | OK | primitive_convert+evenodd_holes | 2 |
| Float/05.svg | OK | primitive_convert+evenodd_holes | 2 |
| Float/06.svg | OK | simple_strip | 1 |
| Float/07.svg | OK | primitive_convert+evenodd_holes | 2 |
| Float/08.svg | OK | primitive_convert+evenodd_holes | 2 |
| Joint/01.svg | OK | multi_merge | 3 |
| Joint/02.svg | OK | multi_merge | 2 |
| Joint/03.svg | OK | nan_sanitize | 2 |
| Joint/04.svg | OK | multi_merge | 2 |
| Joint/05.svg | OK | multi_merge | 2 |
| Joint/06.svg | OK | multi_merge | 2 |
| Joint/07.svg | OK | nan_sanitize | 3 |
| Joint/08.svg | OK | multi_merge | 2 |
| Lines/01.svg | OK | primitive_convert+evenodd_holes | 4 |
| Lines/02.svg | OK | multi_merge | 5 |
| Lines/03.svg | OK | multi_merge | 5 |
| Lines/04.svg | OK | multi_merge | 6 |
| Lines/06.svg | OK | multi_merge | 5 |
| Lines/07.svg | OK | multi_merge | 6 |
| Lines/08.svg | OK | multi_merge | 9 |
| Lines/09.svg | OK | multi_merge | 7 |
| Lines/10.svg | OK | multi_merge | 10 |
| Lines/11.svg | OK | simple_strip | 1 |
| Lines/12.svg | OK | multi_merge | 5 |
| Lines/13.svg | OK | multi_merge | 5 |
| Lines/Clear.svg | EMPTY | clear_tile | 0 |
| Merge/01.svg | OK | simple_strip | 1 |
| Merge/02.svg | OK | multi_merge | 6 |
| Merge/03.svg | OK | primitive_convert+evenodd_holes | 3 |
| Mirror/01.svg | OK | simple_strip | 1 |
| Mirror/02.svg | OK | simple_strip | 1 |
| Mirror/03.svg | OK | geo_clip+geo_clip+geo_clip | 3 |
| Mirror/04.svg | OK | geo_clip | 4 |
| Open/01.svg | OK | multi_merge | 3 |
| Open/02.svg | OK | multi_merge | 3 |
| Open/03.svg | OK | multi_merge | 2 |
| Open/04.svg | OK | multi_merge | 2 |
| Open/05.svg | OK | multi_merge | 2 |
| Open/06.svg | OK | multi_merge | 2 |
| Open/07.svg | OK | multi_merge | 2 |
| Open/08.svg | OK | multi_merge | 2 |
| Open/09.svg | OK | multi_merge | 2 |
| Ramp/01.svg | OK | simple_strip | 1 |
| Ramp/02.svg | OK | simple_strip | 1 |
| Ramp/03.svg | OK | simple_strip | 1 |
| Ramp/04.svg | OK | simple_strip | 1 |
| Ramp/05.svg | OK | simple_strip | 1 |
| Ramp/06.svg | OK | simple_strip | 1 |
| Ramp/07.svg | OK | simple_strip | 1 |
| Ramp/08.svg | OK | simple_strip | 1 |
| Rectangle/01.svg | OK | simple_strip | 1 |
| Rectangle/02.svg | OK | simple_strip | 1 |
| Rectangle/03.svg | OK | simple_strip | 1 |
| Rectangle/04.svg | OK | simple_strip | 1 |
| Rectangle/05.svg | OK | simple_strip | 1 |
| Rectangle/06.svg | OK | simple_strip | 1 |
| Rectangle/07.svg | OK | simple_strip | 1 |
| Rectangle/08.svg | OK | simple_strip | 1 |
| Shape/01.svg | OK | simple_strip | 1 |
| Shape/02.svg | OK | multi_merge | 6 |
| Square/01.svg | OK | simple_strip | 1 |
| Square/02.svg | OK | simple_strip | 1 |
| Square/03.svg | OK | simple_strip | 1 |
| Square/04.svg | OK | simple_strip | 1 |
| Square/05.svg | OK | multi_merge | 3 |
| Square/06.svg | OK | simple_strip | 1 |
| Square/07.svg | OK | simple_strip | 1 |
| Square/08.svg | OK | simple_strip | 1 |
| Wave/01.svg | OK | simple_strip | 1 |
| Wave/02.svg | OK | simple_strip | 1 |
| Wave/03.svg | OK | simple_strip | 1 |
| Wave/04.svg | OK | simple_strip | 1 |
| Wave/05.svg | OK | geo_clip | 1 |
| Wave/06.svg | OK | geo_clip | 1 |
| Wave/07.svg | OK | geo_clip | 1 |
| Wave/08.svg | OK | geo_clip | 1 |