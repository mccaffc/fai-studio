# Retired scripts (June 2026 banner-generator rebuild)

These were superseded by the rebuilt pipeline and are kept only for reference /
rollback. Nothing in the live toolchain imports them. Safe to delete once the
creative director has signed off on the rebuild.

| Retired file | Replaced by | Why |
|---|---|---|
| `generate_banner.py` (~2900 lines) | `scripts/fai_banner.py` | Old generate-and-score rubric diverged from `FAI-Composition-Logic-Supplement.md`; rebuilt to implement all eight supplement axes faithfully, plus 3 CLI color modes and a robust tile renderer. |
| `banner_studio.py` | `scripts/fai_banner.py` CLI + `scripts/fai_contact.py` static sheets | Hand-rolled `http.server` was hard to maintain; replaced by a clean CLI and static contact-sheet generator. |
| `contact_all.py` | `fai_contact.py tiles` | Whole-library contact sheet. |
| `contact_pick.py` | `fai_contact.py tiles --families ...` | Family-subset sheet. |
| `family_montage.py` | `fai_contact.py tiles --per-family 1` | One representative per family. |
| `sets_montage.py` | `fai_contact.py tiles --families ... --recolor ...` | Recolored family-set montage. |
| `generate_contact_sheet.py` | `fai_contact.py banners` | Banner contact sheet (now annotated with the supplement's sub-scores). |

The retired montage/contact scripts also read the legacy `tiles-manifest.json`;
the rebuild standardised on `tiles-manifest-v2.json` (the only manifest the live
tools read).
