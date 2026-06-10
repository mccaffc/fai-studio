"""
FAI Brand Color Constants and Normalization Utilities

Canonical source of truth for the FAI illustration system's 7 permitted
fill colors, plus a deterministic color map for normalizing off-brand
values found in Figma exports.
"""

import re
from typing import NamedTuple

# ──────────────────────────────────────────────────────────
# Canonical brand palette  (the ONLY 7 permitted fill colors)
# ──────────────────────────────────────────────────────────
BRAND_COLORS: dict[str, str] = {
    "international_orange": "#FF4F00",
    "cod_gray":             "#121212",
    "white":                "#FFFFFF",
    "smoke_white":          "#F3F3F3",
    "chrome_yellow":        "#FFA300",
    "celestial_blue":       "#4997D0",
    "timberwolf":           "#D9D9D6",
}

# Reverse lookup: uppercase hex -> token name
HEX_TO_NAME: dict[str, str] = {v: k for k, v in BRAND_COLORS.items()}

# Set of brand hex values (uppercase) for fast membership checks
BRAND_HEX_SET: set[str] = set(BRAND_COLORS.values())

# ──────────────────────────────────────────────────────────
# Deterministic color map: off-brand hex -> brand hex
# Every key was identified in the Figma export audit and confirmed
# by the creative director.  All keys are UPPERCASE.
# ──────────────────────────────────────────────────────────
COLOR_MAP: dict[str, str] = {
    "#48A0CC": "#4997D0",   # near Celestial Blue
    "#47A0CC": "#4997D0",   # variant near Celestial Blue
    "#FFA002": "#FFA300",   # near Chrome Yellow
    "#F99F1B": "#FFA300",   # near Chrome Yellow (Illustrator legacy)
    "#FAA21B": "#FFA300",   # near Chrome Yellow (Illustrator legacy)
    "#131313": "#121212",   # near Cod Gray
    "#131314": "#121212",   # near Cod Gray
    "#141414": "#121212",   # near Cod Gray
    "#141415": "#121212",   # near Cod Gray (Illustrator legacy)
    "#231F20": "#121212",   # rich black (CMYK legacy) -> Cod Gray
    "#F3F3F4": "#F3F3F3",   # near Smoke White
    "#CCC9C4": "#D9D9D6",   # warm gray -> Timberwolf
    "#DBE2E9": "#F3F3F3",   # cool blue-gray -> Smoke White (confirmed)
    "#BECDBD": "#D9D9D6",   # green-gray -> Timberwolf (confirmed)
    "#BECCBC": "#D9D9D6",   # variant green-gray -> Timberwolf
    "#F05223": "#FF4F00",   # near International Orange (Illustrator legacy)
}

# CSS color keywords that appear in Figma exports
KEYWORD_MAP: dict[str, str] = {
    "white":       "#FFFFFF",
    "black":       "#000000",  # not brand — will be caught by validation
    "transparent": "none",
}

# ──────────────────────────────────────────────────────────
# Color temperature classification (used by the generator)
# ──────────────────────────────────────────────────────────
WARM_COLORS = {"#FF4F00", "#FFA300"}          # orange, yellow
COOL_COLORS = {"#4997D0"}                      # blue
NEUTRAL_COLORS = {"#121212", "#FFFFFF", "#F3F3F3", "#D9D9D6"}  # grays

# ──────────────────────────────────────────────────────────
# Regex for detecting hex colors
# ──────────────────────────────────────────────────────────
HEX_RE = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


class ColorResult(NamedTuple):
    """Result of normalizing a single color value."""
    normalized: str    # the final color string
    was_remapped: bool # True if it was changed
    original: str      # what was in the source SVG


def _expand_short_hex(h: str) -> str:
    """Expand #abc to #AABBCC."""
    if len(h) == 4:  # #rgb
        return "#" + h[1]*2 + h[2]*2 + h[3]*2
    return h


def normalize_color(raw: str) -> ColorResult:
    """
    Normalize a single color value found in an SVG attribute.

    Steps:
    1. Strip whitespace, lowercase for comparison
    2. If 'none' or url() reference, return as-is
    3. If CSS keyword, map via KEYWORD_MAP
    4. Expand short hex (#abc -> #AABBCC)
    5. Uppercase the hex for canonical form
    6. If hex is in COLOR_MAP, return the mapped brand color
    7. If hex is already in BRAND_HEX_SET, return as-is
    8. Otherwise return the original (flagged as unknown in was_remapped=False)
    """
    original = raw
    cleaned = raw.strip()

    # Preserve functional references unchanged
    if cleaned.lower() == "none" or cleaned.startswith("url("):
        return ColorResult(cleaned, False, original)

    lower = cleaned.lower()

    # CSS keyword normalization
    if lower in KEYWORD_MAP:
        mapped = KEYWORD_MAP[lower]
        return ColorResult(mapped, mapped != cleaned, original)

    # Must be a hex color at this point
    if not HEX_RE.match(cleaned):
        # Unknown format — return unchanged, will be flagged by validation
        return ColorResult(cleaned, False, original)

    upper = _expand_short_hex(cleaned).upper()

    # Check deterministic remap table
    if upper in COLOR_MAP:
        return ColorResult(COLOR_MAP[upper], True, original)

    # Already a brand color
    if upper in BRAND_HEX_SET:
        return ColorResult(upper, upper != cleaned, original)

    # Unknown color — return uppercased, flag as unchanged
    # (validation step will catch these)
    return ColorResult(upper, False, original)


def is_brand_color(hex_str: str) -> bool:
    """Check if a hex color is in the permitted brand palette."""
    return hex_str.upper() in BRAND_HEX_SET


def color_name(hex_str: str) -> str:
    """Return human-readable token name for a brand hex, or 'UNKNOWN'."""
    return HEX_TO_NAME.get(hex_str.upper(), "UNKNOWN")
