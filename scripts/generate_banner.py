#!/usr/bin/env python3
"""
Phase 3: FAI Banner Generator

Generates on-brand 6x3 grid banner compositions from simplified shape tiles.
The generator now works as a small generate-and-score pipeline:

  - choose a template and family focus
  - limit each banner to a small reusable tile palette
  - place tiles with exact rotation patterns for motif templates
  - select short continuity chains from genuine edge matches
  - assign colors jointly across continuity groups
  - score several candidates and keep the best one

Single-banner usage:
  python scripts/generate_banner.py --list-options
  python scripts/generate_banner.py --write-spec-template banner-request.json
  python scripts/generate_banner.py --spec banner-request.json --name policy-launch
"""

import argparse
import json
import math
import random
import re
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fai_colors import BRAND_COLORS, WARM_COLORS, COOL_COLORS

# - Constants ---------------------------------------------------------------
SVG_NS = "http://www.w3.org/2000/svg"
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = BASE_DIR / "tiles-manifest-v2.json"
DEFAULT_TILES_DIR = BASE_DIR / "output" / "shapes-simplified"
DEFAULT_OUTPUT_DIR = BASE_DIR / "output" / "banners-generated"

GRID_COLS = 6
GRID_ROWS = 3
TOTAL_SLOTS = GRID_COLS * GRID_ROWS
TILE_VB_W = 200
TILE_VB_H = 200
CELL_W = 320
CELL_H = 320
CELL_SCALE = CELL_W / TILE_VB_W

ROTATIONS = [0, 90, 180, 270]
POWER_POSITIONS = {(0, 1), (0, 4), (1, 3), (2, 0), (2, 5)}

ALL_COLOR_TOKENS = list(BRAND_COLORS.keys())
COLOR_TOKEN_TO_HEX = BRAND_COLORS.copy()

MOTIF_TEMPLATES = {
    "pinwheel",
    "spiral",
    "mirror",
    "symmetric",
    "flow",
    "river",
    "checkerboard",
}
MIRROR_TEMPLATES = {"mirror", "symmetric"}

FLOW_FAMILIES = {"wave", "curve", "lines", "cascade", "ramp", "angle", "open"}
GEOMETRIC_FAMILIES = {"square", "rectangle", "circle", "mirror", "float", "composition", "centric"}

COLOR_IMPACT = {
    "international_orange": 1.0,
    "celestial_blue": 0.95,
    "chrome_yellow": 0.9,
    "cod_gray": 0.8,
    "timberwolf": 0.55,
    "smoke_white": 0.45,
    "white": 0.4,
}

GRADIENT_COLOR_ORDER = [
    "cod_gray",
    "celestial_blue",
    "international_orange",
    "chrome_yellow",
    "timberwolf",
    "smoke_white",
    "white",
]

TOPIC_STYLE_PROFILES = {
    # ── AI / Compute ──────────────────────────────────────────────────
    # Metaphor: data streaming through parallel layers of a network.
    # Lines evoke data paths and model layers; joints are the connection
    # points where information converges.  High continuity for end-to-end
    # flow, low symmetry because networks are directional not balanced,
    # steady rhythm for the regular pulse of compute cycles.
    # Celestial blue = digital, precise, technical depth.
    "ai_compute_policy": {
        "label": "AI / Compute Policy",
        "description": "Parallel data streams converging through network layers.",
        "keywords": {
            "ai": 3.0,
            "artificial intelligence": 5.0,
            "machine learning": 4.0,
            "model": 2.0,
            "models": 2.0,
            "compute": 3.5,
            "inference": 3.0,
            "training": 2.5,
            "gpu": 3.0,
            "chip": 2.5,
            "chips": 2.5,
            "semiconductor": 1.5,
            "open weight": 4.0,
            "open source": 2.5,
            "algorithm": 2.5,
            "neural": 3.0,
            "data center": 3.0,
            "frontier model": 5.0,
            "llm": 4.0,
            "generative": 3.0,
            "alignment": 3.0,
            "safety": 1.0,
            "foundation model": 5.0,
            "large language model": 5.0,
            "autonomous": 2.5,
            "agent": 2.0,
            "agents": 2.0,
            "benchmark": 2.5,
            "evaluation": 2.0,
            "capability": 2.0,
            "capabilities": 2.5,
            "scale": 2.0,
            "scaling": 2.5,
            "reasoning": 2.5,
            "deployment": 2.0,
            "regulation": 1.5,
            "export control": 3.5,
            "chip export": 4.0,
            "parameter": 2.0,
            "weights": 2.5,
            "diffusion": 2.5,
            "multimodal": 3.0,
            "deepseek": 4.0,
            "openai": 3.5,
            "anthropic": 3.5,
            "gemini": 3.0,
        },
        "energy": "medium",
        "template": "flow",
        "color_bias": "celestial_blue",
        "primary_families": ["lines", "joint"],
        "accent_families": ["circle"],
        "continuity_strength": 0.92,
        "symmetry_strength": 0.42,
        "rhythm_strength": 0.82,
    },

    # ── Energy / Infrastructure ───────────────────────────────────────
    # Metaphor: scaffolding and transmission towers under construction.
    # Ramps are the inclines and load-bearing slopes of a buildout;
    # angles are the structural joints of power lines and pylons.
    # High continuity for connected infrastructure, very low symmetry
    # because buildout is directional momentum not balance, high rhythm
    # for the repetitive structural cadence of a grid being assembled.
    # International orange = high-vis safety, urgency, construction.
    "energy_infrastructure": {
        "label": "Energy / Infrastructure",
        "description": "Structural ramps and angles assembling like a grid under construction.",
        "keywords": {
            "energy": 3.0,
            "grid": 4.0,
            "power": 3.0,
            "electricity": 3.5,
            "transmission": 3.0,
            "permitting": 3.0,
            "load": 2.0,
            "baseload": 3.5,
            "demand surge": 4.0,
            "nuclear": 3.0,
            "infrastructure": 3.0,
            "buildout": 2.5,
            "solar": 2.5,
            "wind": 2.0,
            "renewable": 2.5,
            "utility": 2.5,
            "pipeline": 2.5,
            "interconnection": 3.0,
            "capacity": 2.0,
            "megawatt": 3.0,
            "generation": 2.0,
            "clean energy": 3.5,
            "battery": 3.0,
            "battery storage": 4.0,
            "storage": 2.5,
            "ev": 2.5,
            "electric vehicle": 3.5,
            "hydrogen": 3.0,
            "lng": 3.0,
            "natural gas": 3.0,
            "coal": 2.5,
            "carbon capture": 3.5,
            "offshore wind": 3.5,
            "data center": 2.5,
            "cooling": 2.0,
            "substation": 3.5,
            "transformer": 2.5,
            "reliability": 2.5,
            "blackout": 3.0,
            "grid modernization": 4.0,
        },
        "energy": "high",
        "template": "river",
        "color_bias": "international_orange",
        "primary_families": ["ramp", "angle"],
        "accent_families": ["open"],
        "continuity_strength": 0.95,
        "symmetry_strength": 0.35,
        "rhythm_strength": 0.88,
    },

    # ── Industry / Supply Chains ──────────────────────────────────────
    # Metaphor: shipping containers and factory modules on a pallet.
    # Rectangles and squares are the standardized, interchangeable units
    # of manufactured goods; composition tiles are assembled multi-part
    # products.  Low continuity because modules are discrete (not
    # flowing), very high symmetry for the regularity of standardized
    # parts, very high rhythm for the repetitive cadence of a factory
    # line.  Chrome yellow = industrial machinery, caution, manufacturing.
    "industrial_supply_chain": {
        "label": "Industry / Supply Chains",
        "description": "Standardized blocks arrayed like containers on a factory floor.",
        "keywords": {
            "manufacturing": 3.5,
            "industrial": 3.0,
            "trade": 2.5,
            "tariff": 3.0,
            "tariffs": 3.0,
            "supply chain": 4.0,
            "supply chains": 4.0,
            "rare earth": 4.5,
            "rare earths": 4.5,
            "minerals": 3.0,
            "critical minerals": 4.0,
            "china": 2.5,
            "factory": 2.5,
            "exports": 2.0,
            "imports": 2.0,
            "border adjustment": 3.5,
            "reshoring": 3.5,
            "onshoring": 3.5,
            "logistics": 2.5,
            "warehouse": 2.0,
            "procurement": 2.5,
            "inventory": 2.0,
            "nearshoring": 3.5,
            "friendshoring": 3.5,
            "IRA": 3.0,
            "chips act": 4.0,
            "domestic production": 3.5,
            "bottleneck": 2.5,
            "resilience": 2.5,
            "diversification": 2.5,
            "semiconductor supply": 4.0,
            "fab": 3.0,
            "foundry": 3.0,
            "export restriction": 3.5,
            "battery materials": 4.0,
            "cobalt": 3.0,
            "lithium": 3.0,
            "nickel": 2.5,
        },
        "energy": "medium",
        "template": "checkerboard",
        "color_bias": "chrome_yellow",
        "primary_families": ["rectangle", "square"],
        "accent_families": ["composition"],
        "continuity_strength": 0.38,
        "symmetry_strength": 0.94,
        "rhythm_strength": 0.92,
    },

    # ── Governance / Institutions ─────────────────────────────────────
    # Metaphor: the bilateral facade of a government building.
    # Compositions are the complex institutional structures (agencies,
    # branches); rectangles are the formal architectural blocks.
    # Mirror-family accent tiles reinforce the idea of checks and
    # balances.  Maximum symmetry for balance of power, low continuity
    # (institutions are discrete bodies), low rhythm (measured, not
    # dynamic).  Cod gray = authority, stone, formality.
    # Low energy: governance is restrained and deliberate.
    "governance_institutions": {
        "label": "Governance / Institutions",
        "description": "Formal bilateral arrangement evoking checks, balances, and institutional architecture.",
        "keywords": {
            "governance": 4.0,
            "institution": 3.0,
            "institutions": 3.0,
            "state capacity": 4.5,
            "reform": 2.5,
            "regulation": 2.5,
            "regulatory": 2.5,
            "agency": 2.5,
            "agencies": 2.5,
            "federal": 2.5,
            "congress": 2.5,
            "commission": 2.5,
            "bureaucracy": 3.0,
            "oversight": 3.0,
            "executive order": 3.5,
            "legislation": 3.0,
            "statute": 2.5,
            "rulemaking": 3.0,
            "appropriation": 2.5,
            "bipartisan": 2.5,
            "judiciary": 3.0,
            "court": 2.0,
            "supreme court": 3.5,
            "regulatory capture": 4.0,
            "administrative state": 4.0,
            "civil service": 3.0,
            "accountability": 2.5,
            "transparency": 2.5,
            "doge": 3.5,
            "federalism": 3.5,
            "checks and balances": 4.5,
            "separation of powers": 4.0,
            "veto": 2.5,
            "filibuster": 3.0,
            "permitting reform": 3.5,
        },
        "energy": "low",
        "template": "symmetric",
        "color_bias": "cod_gray",
        "primary_families": ["composition", "rectangle"],
        "accent_families": ["mirror"],
        "continuity_strength": 0.48,
        "symmetry_strength": 0.98,
        "rhythm_strength": 0.52,
    },

    # ── Frontier Science / Deep Tech ──────────────────────────────────
    # Metaphor: particle tracks spiraling outward from a collision point.
    # Centric tiles are atomic nuclei and focal points of discovery;
    # circles are orbits and cellular forms.  Cascade accents evoke
    # chain reactions and experimental cascades.  Medium continuity for
    # connected experimental pathways, moderate symmetry (natural symmetry
    # in physics), low rhythm (irregular discovery, not factory cadence).
    # Celestial blue = deep space, precision instrumentation, clarity.
    "frontier_science": {
        "label": "Frontier Science / Deep Tech",
        "description": "Concentric forms spiraling outward like particle tracks from a collision.",
        "keywords": {
            "science": 3.0,
            "research": 2.5,
            "lab": 2.5,
            "labs": 2.5,
            "innovation": 2.0,
            "quantum": 4.5,
            "deep tech": 4.5,
            "frontier": 2.0,
            "materials": 2.0,
            "biotech": 3.0,
            "semiconductor": 2.5,
            "advanced technology": 3.0,
            "nanotechnology": 4.0,
            "fusion": 3.5,
            "particle": 3.0,
            "genome": 3.0,
            "crispr": 4.0,
            "synthetic biology": 4.0,
            "photonics": 3.5,
            "superconductor": 4.0,
            "space": 2.5,
            "satellite": 3.0,
            "rocket": 3.0,
            "protein folding": 4.5,
            "alphafold": 4.5,
            "drug discovery": 4.0,
            "materials science": 3.5,
            "battery technology": 3.5,
            "nuclear fusion": 4.5,
            "darpa": 3.5,
            "arpa": 3.0,
            "r&d": 2.5,
            "telescope": 3.0,
            "climate model": 4.0,
            "exascale": 4.5,
            "computing": 2.0,
        },
        "energy": "medium",
        "template": "spiral",
        "color_bias": "celestial_blue",
        "primary_families": ["centric", "circle"],
        "accent_families": ["cascade"],
        "continuity_strength": 0.68,
        "symmetry_strength": 0.72,
        "rhythm_strength": 0.55,
    },

    # ── Speech / Creativity ───────────────────────────────────────────
    # Metaphor: sound waves and brushstrokes radiating from bright focal
    # points.  Curves are the organic arcs of a voice or a pen; waves
    # are cultural movements and sound propagation.  Float accents are
    # free-floating individual expression.  Low continuity (expression
    # is diverse, not uniform), low symmetry (creativity breaks
    # convention), very high rhythm (dynamic variation, call-and-
    # response).  Chrome yellow = warmth, optimism, creative brightness.
    # High energy: creativity is exuberant and colorful.
    "speech_creativity": {
        "label": "Speech / Creativity",
        "description": "Organic curves and waves radiating from bright focal accents, like a voice carrying outward.",
        "keywords": {
            "speech": 3.5,
            "first amendment": 4.5,
            "creator": 2.5,
            "creators": 2.5,
            "creative": 2.5,
            "copyright": 3.0,
            "media": 2.0,
            "culture": 2.5,
            "expression": 3.0,
            "publishing": 2.5,
            "story": 1.5,
            "storytelling": 2.5,
            "art": 2.0,
            "artist": 2.5,
            "music": 2.5,
            "journalism": 2.5,
            "platform": 1.5,
            "content moderation": 3.5,
            "free speech": 4.0,
            "censorship": 3.5,
            "social media": 3.0,
            "misinformation": 3.5,
            "disinformation": 3.5,
            "algorithm": 2.0,
            "recommendation": 2.0,
            "news": 1.5,
            "broadcast": 2.0,
            "hollywood": 2.5,
            "film": 2.0,
            "book": 1.5,
            "library": 2.0,
            "academic freedom": 3.5,
            "deepfake": 3.5,
            "synthetic media": 4.0,
            "ai content": 3.5,
        },
        "energy": "high",
        "template": "focal",
        "color_bias": "chrome_yellow",
        "primary_families": ["curve", "wave"],
        "accent_families": ["float"],
        "continuity_strength": 0.42,
        "symmetry_strength": 0.48,
        "rhythm_strength": 0.95,
    },

    # ── Defense / National Security ───────────────────────────────────
    # Metaphor: chevrons in strict bilateral formation — a defensive
    # perimeter.  Angles are directional force and chevron insignia;
    # merge tiles are converging alliance formations.  Joint accents are
    # structural reinforcement nodes.  High continuity for coordinated
    # forces, very high symmetry (military formation), very low rhythm
    # (disciplined uniformity, not variation).  Cod gray = steel,
    # discipline, authority.  Low energy: restrained and controlled.
    "national_security": {
        "label": "Defense / National Security",
        "description": "Angular chevrons in strict bilateral formation, evoking a defensive perimeter.",
        "keywords": {
            "defense": 4.0,
            "military": 3.5,
            "deterrence": 3.5,
            "arsenal": 3.0,
            "war": 2.5,
            "weapon": 2.5,
            "weapons": 2.5,
            "alliance": 2.5,
            "national security": 5.0,
            "nato": 3.0,
            "pentagon": 3.5,
            "intelligence": 2.5,
            "cyber": 2.5,
            "missile": 3.0,
            "nuclear weapon": 4.0,
            "drone": 2.5,
            "surveillance": 2.5,
            "espionage": 3.0,
            "threat": 2.0,
            "adversary": 2.5,
            "space": 2.5,
            "satellite": 2.5,
            "hypersonic": 4.0,
            "autonomous weapon": 4.5,
            "lethal autonomous": 5.0,
            "election security": 3.5,
            "critical infrastructure": 4.0,
            "counterterrorism": 3.5,
            "homeland": 3.0,
            "nuclear deterrence": 5.0,
            "submarine": 3.0,
            "aukus": 4.0,
            "force posture": 3.5,
            "battlefield": 3.0,
        },
        "energy": "low",
        "template": "mirror",
        "color_bias": "cod_gray",
        "primary_families": ["angle", "merge"],
        "accent_families": ["joint"],
        "continuity_strength": 0.8,
        "symmetry_strength": 0.96,
        "rhythm_strength": 0.42,
    },

    # ── Economics / Fiscal Policy ─────────────────────────────────────
    # Metaphor: a capital ledger — columnar bars of revenue and outlay
    # connected by trend lines of obligation.  Rectangles are budget
    # line items and balance-sheet columns; lines are the flows of debt,
    # interest, and spending; joints are the nodes where capital
    # allocates across programs.  High continuity for capital flowing
    # through a system, moderate symmetry (balance sheets balance),
    # high rhythm for the regular cadence of fiscal cycles.
    # Chrome yellow = gold, value, markets.
    "economics_fiscal": {
        "label": "Economics / Fiscal Policy",
        "description": "Columnar budget lines and capital flows connected through allocation nodes.",
        "keywords": {
            "budget": 3.5,
            "deficit": 3.5,
            "surplus": 3.0,
            "debt": 3.0,
            "fiscal": 4.0,
            "monetary": 3.5,
            "federal reserve": 4.0,
            "fed": 2.5,
            "inflation": 3.5,
            "interest rate": 3.5,
            "bond": 2.5,
            "treasury": 3.0,
            "gdp": 3.0,
            "recession": 3.5,
            "stimulus": 3.0,
            "tax": 2.5,
            "revenue": 2.5,
            "spending": 2.5,
            "appropriation": 3.0,
            "appropriations": 3.0,
            "subsidy": 2.5,
            "market": 2.0,
            "markets": 2.0,
            "economic growth": 3.5,
            "productivity": 2.5,
            "austerity": 3.0,
            "quantitative easing": 4.0,
            "tariff revenue": 3.0,
        },
        "energy": "medium",
        "template": "flow",
        "color_bias": "chrome_yellow",
        "primary_families": ["rectangle", "lines"],
        "accent_families": ["joint"],
        "continuity_strength": 0.78,
        "symmetry_strength": 0.68,
        "rhythm_strength": 0.82,
    },

    # ── Healthcare / Life Sciences ────────────────────────────────────
    # Metaphor: cellular diagnostics — concentric cell forms with
    # biometric waveforms reading vital signs.  Circles are cells, pills,
    # and petri-dish cross-sections; centric tiles are nuclear targets
    # and diagnostic bulls-eyes; waves are EKG traces and epidemiological
    # curves.  Moderate continuity (connected biological pathways),
    # moderate-high symmetry (bilateral biological symmetry), moderate
    # rhythm (clinical regularity with natural variation).
    # Celestial blue = clinical precision, care, calm authority.
    "healthcare_life_sciences": {
        "label": "Healthcare / Life Sciences",
        "description": "Concentric cellular forms and biometric wave traces, like a diagnostic field.",
        "keywords": {
            "health": 2.5,
            "healthcare": 3.5,
            "public health": 4.0,
            "fda": 4.0,
            "drug": 2.5,
            "drugs": 2.5,
            "vaccine": 3.5,
            "medicine": 3.0,
            "clinical": 3.0,
            "clinical trial": 4.5,
            "biomedical": 3.5,
            "pandemic": 3.5,
            "epidemic": 3.0,
            "hospital": 2.5,
            "pharma": 3.0,
            "pharmaceutical": 3.5,
            "medicare": 3.5,
            "medicaid": 3.5,
            "insurance": 2.0,
            "coverage": 2.0,
            "biosimilar": 4.0,
            "patient": 2.5,
            "disease": 2.5,
            "diagnosis": 3.0,
            "treatment": 2.5,
            "therapy": 2.5,
            "drug pricing": 4.5,
            "prescription": 3.0,
            "NIH": 3.5,
            "CDC": 3.5,
        },
        "energy": "medium",
        "template": "focal",
        "color_bias": "celestial_blue",
        "primary_families": ["circle", "centric"],
        "accent_families": ["wave"],
        "continuity_strength": 0.65,
        "symmetry_strength": 0.75,
        "rhythm_strength": 0.70,
    },

    # ── Climate / Environment ─────────────────────────────────────────
    # Metaphor: atmospheric and oceanic circulation — cascading feedback
    # loops cycling heat through the planetary system.  Waves are
    # atmospheric and oceanic current layers; cascades are tipping-point
    # chain reactions and runoff sequences; curves are warming arcs and
    # carbon-concentration trajectories.  High continuity (interconnected
    # planetary cycles), low symmetry (dynamic, non-equilibrium system),
    # very high rhythm (seasonal/annual cycles driving the pattern).
    # Celestial blue = sky, ocean, atmosphere, cryosphere.
    # High energy: the urgency of a destabilizing system.
    "climate_environment": {
        "label": "Climate / Environment",
        "description": "Cascading wave cycles and atmospheric arcs, like a planetary feedback loop.",
        "keywords": {
            "climate": 4.0,
            "climate change": 5.0,
            "carbon": 3.5,
            "emissions": 3.5,
            "decarbonization": 4.5,
            "net zero": 4.5,
            "greenhouse": 3.5,
            "greenhouse gas": 4.5,
            "methane": 3.5,
            "co2": 3.5,
            "paris agreement": 5.0,
            "paris accord": 4.5,
            "adaptation": 3.0,
            "mitigation": 3.0,
            "sea level": 4.0,
            "temperature": 2.5,
            "wildfire": 3.5,
            "drought": 3.0,
            "flood": 2.5,
            "ipcc": 4.0,
            "warming": 3.5,
            "carbon capture": 4.0,
            "carbon tax": 4.0,
            "cap and trade": 4.5,
            "deforestation": 3.5,
            "biodiversity": 3.5,
            "ecosystem": 3.0,
            "epa": 3.5,
            "environmental": 2.5,
        },
        "energy": "high",
        "template": "spiral",
        "color_bias": "celestial_blue",
        "primary_families": ["wave", "cascade"],
        "accent_families": ["curve"],
        "continuity_strength": 0.85,
        "symmetry_strength": 0.52,
        "rhythm_strength": 0.90,
    },

    # ── Geopolitics / Economic Security ──────────────────────────────
    # Metaphor: converging vectors of great-power competition — alliance
    # formations meeting at contested boundaries.  Merge tiles are
    # converging forces and multilateral coalitions; angles are vectors
    # of geopolitical pressure and strategic direction; compositions are
    # the multi-party arrangements that govern international order.
    # Moderate continuity (alliance webs connect), high symmetry
    # (bilateral dynamics, balance of power), moderate rhythm (cycles
    # of tension and negotiation).
    # International orange = contested zones, urgency, active competition.
    "geopolitics_trade": {
        "label": "Geopolitics / Economic Security",
        "description": "Converging angular vectors and alliance formations under great-power pressure.",
        "keywords": {
            "geopolitics": 4.5,
            "geopolitical": 4.0,
            "diplomacy": 3.5,
            "diplomatic": 3.0,
            "sanctions": 4.0,
            "export control": 4.5,
            "export controls": 4.5,
            "trade war": 4.5,
            "de-risking": 4.5,
            "decoupling": 4.0,
            "indo-pacific": 4.5,
            "g7": 3.5,
            "g20": 3.0,
            "bilateral": 3.0,
            "multilateral": 3.0,
            "foreign policy": 4.0,
            "allies": 3.0,
            "alliance": 3.0,
            "statecraft": 4.0,
            "strategic competition": 5.0,
            "great power": 4.5,
            "influence": 2.5,
            "belt and road": 4.5,
            "bri": 3.5,
            "chip war": 4.5,
            "technology competition": 4.0,
            "economic coercion": 4.5,
            "supply chain security": 4.0,
        },
        "energy": "medium",
        "template": "mirror",
        "color_bias": "international_orange",
        "primary_families": ["merge", "angle"],
        "accent_families": ["composition"],
        "continuity_strength": 0.68,
        "symmetry_strength": 0.85,
        "rhythm_strength": 0.62,
    },

    # ── Hiring / Talent & Fellowship ─────────────────────────────────
    # Metaphor: orbiting circles drawn toward a focal center — diverse
    # individual contributors finding their place in a growing
    # organization.  Circles are people: distinct, complete, movable.
    # Float tiles are candidates in motion, talent not yet placed.
    # Centric tiles are the role itself — the nucleus that organizes
    # everything around it.  High energy: opportunity is exciting.
    # Low continuity (people arrive from different directions, not a
    # pipeline), moderate symmetry (a good team is balanced, not
    # uniform), very high rhythm (each new hire is a new beat).
    # International orange = invitation, warmth, forward momentum.
    "hiring_talent": {
        "label": "Hiring / Talent & Fellowship",
        "description": "Orbiting circles and floating forms converging on a focal center — diverse contributors joining a growing organization.",
        "keywords": {
            "hiring": 5.0,
            "hire": 4.0,
            "we're hiring": 5.0,
            "job": 3.0,
            "jobs": 3.0,
            "career": 3.5,
            "careers": 3.5,
            "talent": 3.5,
            "recruit": 3.5,
            "recruitment": 4.0,
            "open role": 5.0,
            "open position": 5.0,
            "job posting": 5.0,
            "fellowship": 4.5,
            "fellow": 3.5,
            "fellows": 3.5,
            "intern": 3.0,
            "internship": 4.0,
            "staff": 2.5,
            "team": 2.0,
            "join": 3.0,
            "join us": 4.5,
            "join the team": 5.0,
            "onboarding": 4.0,
            "culture": 2.5,
            "employee": 2.5,
            "employees": 2.5,
            "interview": 3.5,
            "apply": 3.0,
            "application": 3.0,
            "associate": 2.5,
            "analyst": 2.5,
            "researcher": 2.5,
            "research fellow": 5.0,
            "policy analyst": 4.5,
            "policy fellow": 5.0,
        },
        "energy": "high",
        "template": "focal",
        "color_bias": "international_orange",
        "primary_families": ["circle", "float"],
        "accent_families": ["centric"],
        "continuity_strength": 0.48,
        "symmetry_strength": 0.62,
        "rhythm_strength": 0.92,
    },

    # ── General FAI ───────────────────────────────────────────────────
    # Metaphor: an open, welcoming composition — broad engagement with
    # no single axis of intensity.  Pinwheel rotation keeps it dynamic
    # without privileging a direction.
    "general_fai": {
        "label": "General FAI",
        "description": "Balanced, dynamic composition for broad policy engagement.",
        "keywords": {},
        "energy": "medium",
        "template": "pinwheel",
        "color_bias": "international_orange",
        "primary_families": ["composition", "circle"],
        "accent_families": ["float"],
        "continuity_strength": 0.72,
        "symmetry_strength": 0.78,
        "rhythm_strength": 0.78,
    },
}

# After rotation R, new edge P comes from original edge SOURCE[R][P].
EDGE_ROTATION_SOURCE = {
    0: {"top": "top", "right": "right", "bottom": "bottom", "left": "left"},
    90: {"top": "right", "right": "bottom", "bottom": "left", "left": "top"},
    180: {"top": "bottom", "right": "left", "bottom": "top", "left": "right"},
    270: {"top": "left", "right": "top", "bottom": "right", "left": "bottom"},
}

ROTATION_PATTERN_FNS = {
    "pinwheel": lambda r, c: (r * 2 + c) % 4,
    "spiral": lambda r, c: c % 4,
    "mirror": lambda r, c: c % 4 if c < GRID_COLS // 2 else (GRID_COLS - 1 - c) % 4,
    "flow": lambda r, c: (r + c) % 2 * 2,
    "checker90": lambda r, c: (r + c) % 2 * 2,
    "diagonal": lambda r, c: (r + c) % 4,
    "free": None,
}

TEMPLATES = [
    "pinwheel",
    "spiral",
    "mirror",
    "symmetric",
    "flow",
    "river",
    "checkerboard",
    "focal",
    "scatter",
    "gradient",
]

TEMPLATE_CONFIG = {
    "pinwheel": {
        "primary_fam": (1, 2),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "pinwheel",
        "motif": True,
        "rotation_strict": True,
    },
    "spiral": {
        "primary_fam": (1, 2),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "spiral",
        "motif": True,
        "rotation_strict": True,
    },
    "mirror": {
        "primary_fam": (1, 2),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "mirror",
        "motif": True,
        "rotation_strict": True,
    },
    "symmetric": {
        "primary_fam": (1, 2),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "mirror",
        "motif": True,
        "rotation_strict": True,
    },
    "flow": {
        "primary_fam": (1, 1),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "flow",
        "motif": True,
        "rotation_strict": True,
    },
    "river": {
        "primary_fam": (1, 1),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "flow",
        "motif": True,
        "rotation_strict": True,
    },
    "checkerboard": {
        "primary_fam": (1, 2),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "checker90",
        "motif": True,
        "rotation_strict": True,
    },
    "focal": {
        "primary_fam": (2, 3),
        "accent_fam": (1, 2),
        "primary_tiles": (4, 5),
        "accent_tiles": (1, 2),
        "rotation": "free",
        "motif": False,
        "rotation_strict": False,
    },
    "scatter": {
        "primary_fam": (2, 4),
        "accent_fam": (0, 2),
        "primary_tiles": (4, 6),
        "accent_tiles": (0, 2),
        "rotation": "free",
        "motif": False,
        "rotation_strict": False,
    },
    "gradient": {
        "primary_fam": (2, 3),
        "accent_fam": (0, 1),
        "primary_tiles": (4, 5),
        "accent_tiles": (0, 1),
        "rotation": "diagonal",
        "motif": False,
        "rotation_strict": False,
    },
}

TEMPLATE_ENERGY_WEIGHTS = {
    "low": {
        "flow": 3,
        "river": 3,
        "mirror": 3,
        "symmetric": 3,
        "focal": 1,
        "gradient": 1,
        "checkerboard": 1,
        "pinwheel": 1,
        "spiral": 1,
        "scatter": 0,
    },
    "medium": {
        "pinwheel": 2,
        "spiral": 2,
        "mirror": 3,
        "symmetric": 3,
        "flow": 3,
        "river": 3,
        "checkerboard": 2,
        "focal": 1.5,
        "gradient": 1.5,
        "scatter": 0.35,
    },
    "high": {
        "pinwheel": 2.5,
        "spiral": 2.5,
        "checkerboard": 2,
        "scatter": 0.75,
        "gradient": 2,
        "focal": 2,
        "mirror": 1.5,
        "symmetric": 1.5,
        "flow": 1.5,
        "river": 1.5,
    },
}


# - Data classes ------------------------------------------------------------
@dataclass
class RotatedTile:
    tile: dict
    rotation: int
    edges: dict
    coverage: dict


@dataclass
class CellAssignment:
    col: int
    row: int
    tile_id: str
    tile_filename: str
    rotation: int
    fg_color: str
    bg_color: str
    fg_name: str
    bg_name: str


@dataclass
class CandidateBanner:
    template: str
    primary_families: list[str]
    accent_families: list[str]
    placement: list[dict]
    continuity_pairs: list[tuple[tuple[int, int], tuple[int, int]]]
    cells: list[CellAssignment]
    score: float
    score_breakdown: dict[str, float] = field(default_factory=dict)


@dataclass
class BannerRequest:
    energy: str = "medium"
    seed: Optional[int] = None
    dimensions: tuple[int, int] = (1920, 960)
    color_bias: Optional[str] = None
    topic_description: Optional[str] = None
    continuity_strength: float = 0.7
    symmetry_strength: float = 0.85
    rhythm_strength: float = 0.75
    template: Optional[str] = None
    candidate_count: int = 24
    primary_families: list[str] = field(default_factory=list)
    accent_families: list[str] = field(default_factory=list)
    tile_ids: list[str] = field(default_factory=list)
    name: Optional[str] = None
    restrict_colors: Optional[list[str]] = None

    def normalized(self) -> "BannerRequest":
        rc = None
        if self.restrict_colors:
            rc = [c.lower() for c in self.restrict_colors if c]
        return BannerRequest(
            energy=str(self.energy).lower(),
            seed=int(self.seed) if self.seed is not None else None,
            dimensions=normalize_dimensions(self.dimensions),
            color_bias=self.color_bias.lower() if self.color_bias else None,
            topic_description=normalize_topic_description(self.topic_description),
            continuity_strength=float(self.continuity_strength),
            symmetry_strength=float(self.symmetry_strength),
            rhythm_strength=float(self.rhythm_strength),
            template=self.template.lower() if self.template else None,
            candidate_count=max(1, int(self.candidate_count)),
            primary_families=normalize_name_list(self.primary_families),
            accent_families=normalize_name_list(self.accent_families),
            tile_ids=normalize_name_list(self.tile_ids),
            name=normalize_banner_name(self.name),
            restrict_colors=rc,
        )


@dataclass
class BannerResult:
    output_path: Optional[str]
    seed: int
    energy: str
    template: str
    primary_families: list[str]
    accent_families: list[str]
    rotation_pattern: str
    continuity_strength: float
    symmetry_strength: float
    rhythm_strength: float
    candidate_count: int
    dimensions: tuple[int, int]
    color_bias: Optional[str]
    score: float
    score_breakdown: dict[str, float]
    cells: list
    request: dict
    generated_at: str


# - Small helpers -----------------------------------------------------------
def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def normalize_banner_name(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def normalize_topic_description(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = " ".join(value.strip().split())
    return cleaned or None


def dedupe_preserving_order(values: list[str]) -> list[str]:
    seen = set()
    ordered = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def normalize_name_list(values: Optional[list[str]]) -> list[str]:
    if not values:
        return []
    return dedupe_preserving_order([value.strip().lower() for value in values if value and value.strip()])


def request_payload(request: BannerRequest) -> dict:
    return {
        "name": request.name,
        "energy": request.energy,
        "seed": request.seed,
        "dimensions": list(request.dimensions),
        "color_bias": request.color_bias,
        "topic_description": request.topic_description,
        "continuity_strength": request.continuity_strength,
        "symmetry_strength": request.symmetry_strength,
        "rhythm_strength": request.rhythm_strength,
        "template": request.template,
        "candidate_count": request.candidate_count,
        "primary_families": normalize_name_list(request.primary_families),
        "accent_families": normalize_name_list(request.accent_families),
        "tile_ids": normalize_name_list(request.tile_ids),
        "restrict_colors": request.restrict_colors,
    }


def pair_key(a: tuple[int, int], b: tuple[int, int]) -> tuple[tuple[int, int], tuple[int, int]]:
    return (a, b) if a <= b else (b, a)


def color_temperature(color_name: str) -> str:
    color_hex = COLOR_TOKEN_TO_HEX[color_name]
    if color_hex in WARM_COLORS or color_name in ("international_orange", "chrome_yellow"):
        return "warm"
    if color_hex in COOL_COLORS or color_name == "celestial_blue":
        return "cool"
    return "neutral"


def rotate_edges(edge_type: dict, coverage: dict, rotation: int) -> tuple[dict, dict]:
    src = EDGE_ROTATION_SOURCE[rotation]
    new_type = {edge: edge_type[src[edge]] for edge in ("top", "right", "bottom", "left")}
    new_cov = {edge: coverage[src[edge]] for edge in ("top", "right", "bottom", "left")}
    return new_type, new_cov


def weighted_sample_without_replacement(items, weights, k: int, rng: random.Random):
    pool = list(zip(items, weights))
    chosen = []
    for _ in range(min(k, len(pool))):
        idx = rng.choices(
            range(len(pool)),
            weights=[max(weight, 0.001) for _, weight in pool],
            k=1,
        )[0]
        item, _ = pool.pop(idx)
        chosen.append(item)
    return chosen


class UnionFind:
    def __init__(self, items):
        self.parent = {item: item for item in items}
        self.sizes = {item: 1 for item in items}

    def find(self, item):
        parent = self.parent[item]
        if parent != item:
            self.parent[item] = self.find(parent)
        return self.parent[item]

    def union(self, a, b):
        ra = self.find(a)
        rb = self.find(b)
        if ra == rb:
            return ra
        if self.sizes[ra] < self.sizes[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.sizes[ra] += self.sizes[rb]
        return ra

    def size(self, item) -> int:
        return self.sizes[self.find(item)]


def available_families(tiles: list[dict]) -> list[str]:
    return sorted(
        {
            tile.get("shape_family", "")
            for tile in tiles
            if tile.get("shape_family") and not (tile.get("shape_family") == "lines" and "clear" in tile.get("id", ""))
        }
    )


def tile_lookup(tiles: list[dict]) -> dict[str, dict]:
    return {
        tile["id"]: tile
        for tile in tiles
    }


# - Manifest ----------------------------------------------------------------
def load_manifest(path: Path) -> dict:
    with open(path) as handle:
        return json.load(handle)


def load_request_spec(path: Optional[Path]) -> dict:
    if path is None:
        return {}
    with open(path) as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("Request spec must be a JSON object")
    return data


def merged_value(cli_value, spec_data: dict, key: str, default):
    if cli_value not in (None, []):
        return cli_value
    if key in spec_data and spec_data[key] is not None:
        return spec_data[key]
    return default


def normalize_dimensions(value) -> tuple[int, int]:
    if value is None:
        return (1920, 960)
    if len(value) != 2:
        raise ValueError("dimensions must contain exactly two integers")
    return (int(value[0]), int(value[1]))


def build_banner_request(
    *,
    energy=None,
    seed=None,
    dimensions=None,
    color_bias=None,
    topic_description=None,
    continuity_strength=None,
    symmetry_strength=None,
    rhythm_strength=None,
    template=None,
    candidate_count=None,
    primary_families=None,
    accent_families=None,
    tile_ids=None,
    name=None,
    spec_data: Optional[dict] = None,
) -> BannerRequest:
    spec_data = spec_data or {}
    request = BannerRequest(
        energy=merged_value(energy, spec_data, "energy", "medium"),
        seed=merged_value(seed, spec_data, "seed", None),
        dimensions=normalize_dimensions(merged_value(dimensions, spec_data, "dimensions", [1920, 960])),
        color_bias=merged_value(color_bias, spec_data, "color_bias", None),
        topic_description=merged_value(topic_description, spec_data, "topic_description", None),
        continuity_strength=float(merged_value(continuity_strength, spec_data, "continuity_strength", 0.7)),
        symmetry_strength=float(merged_value(symmetry_strength, spec_data, "symmetry_strength", 0.85)),
        rhythm_strength=float(merged_value(rhythm_strength, spec_data, "rhythm_strength", 0.75)),
        template=merged_value(template, spec_data, "template", None),
        candidate_count=int(merged_value(candidate_count, spec_data, "candidate_count", 24)),
        primary_families=normalize_name_list(merged_value(primary_families, spec_data, "primary_families", [])),
        accent_families=normalize_name_list(merged_value(accent_families, spec_data, "accent_families", [])),
        tile_ids=normalize_name_list(merged_value(tile_ids, spec_data, "tile_ids", [])),
        name=merged_value(name, spec_data, "name", None),
    )
    return request.normalized()


def validate_request(manifest: dict, request: BannerRequest):
    if request.energy not in {"low", "medium", "high"}:
        raise ValueError(f"Unknown energy level: {request.energy}")
    if request.dimensions[0] <= 0 or request.dimensions[1] <= 0:
        raise ValueError("dimensions must contain positive integers")
    if request.candidate_count < 1:
        raise ValueError("candidate_count must be at least 1")
    if not 0.0 <= request.continuity_strength <= 1.0:
        raise ValueError("continuity_strength must be between 0.0 and 1.0")
    if not 0.0 <= request.symmetry_strength <= 1.0:
        raise ValueError("symmetry_strength must be between 0.0 and 1.0")
    if not 0.0 <= request.rhythm_strength <= 1.0:
        raise ValueError("rhythm_strength must be between 0.0 and 1.0")

    validate_overrides(
        manifest,
        primary_families=request.primary_families,
        accent_families=request.accent_families,
        tile_ids=request.tile_ids,
        template=request.template,
        color_bias=request.color_bias,
    )


def request_template() -> dict:
    return {
        "name": "policy-launch",
        "energy": "medium",
        "seed": 42,
        "dimensions": [1920, 960],
        "color_bias": None,
        "topic_description": None,
        "continuity_strength": 0.7,
        "symmetry_strength": 0.85,
        "rhythm_strength": 0.75,
        "template": "mirror",
        "candidate_count": 24,
        "primary_families": ["circle"],
        "accent_families": ["wave"],
        "tile_ids": [],
    }


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "banner"


def next_banner_index(output_dir: Path) -> int:
    highest = 0
    for svg_path in output_dir.glob("banner-*.svg"):
        match = re.match(r"banner-(\d+)", svg_path.stem)
        if match:
            highest = max(highest, int(match.group(1)))
    return highest + 1


def default_single_output_path(output_dir: Path, request: BannerRequest, result: BannerResult) -> Path:
    index = next_banner_index(output_dir)
    parts = [f"banner-{index:03d}", result.energy, result.template, f"s{result.seed}"]
    if request.name:
        parts.append(slugify(request.name))
    return output_dir / f"{'-'.join(parts)}.svg"


def write_banner_artifacts(result: BannerResult, banner_root: etree._Element, svg_path: Path):
    svg_path.parent.mkdir(parents=True, exist_ok=True)
    svg_path.write_bytes(etree.tostring(banner_root, xml_declaration=True, encoding="UTF-8", pretty_print=True))
    result.output_path = str(svg_path)

    with open(svg_path.with_suffix(".json"), "w") as handle:
        json.dump(asdict(result), handle, indent=2)


def validate_overrides(
    manifest: dict,
    primary_families: Optional[list[str]] = None,
    accent_families: Optional[list[str]] = None,
    tile_ids: Optional[list[str]] = None,
    template: Optional[str] = None,
    color_bias: Optional[str] = None,
):
    tiles = manifest["tiles"]
    families = set(available_families(tiles))
    ids = set(tile_lookup(tiles))

    bad_families = [
        family
        for family in normalize_name_list(primary_families) + normalize_name_list(accent_families)
        if family not in families
    ]
    if bad_families:
        raise ValueError(f"Unknown families: {', '.join(sorted(set(bad_families)))}")

    bad_tiles = [tile_id for tile_id in normalize_name_list(tile_ids) if tile_id not in ids]
    if bad_tiles:
        raise ValueError(f"Unknown tile ids: {', '.join(bad_tiles)}")

    if template is not None and template.lower() not in TEMPLATES:
        raise ValueError(f"Unknown template: {template}")

    if color_bias is not None and color_bias.lower() not in COLOR_TOKEN_TO_HEX:
        raise ValueError(f"Unknown color bias: {color_bias}")


def print_generator_options(manifest: dict):
    options = generator_options(manifest)
    print("Templates:")
    print("  " + ", ".join(options["templates"]))
    print("\nColors:")
    print("  " + ", ".join(options["colors"]))
    print("\nFamilies:")
    for family in options["families"]:
        examples = ", ".join(options["family_tile_ids"][family][:4])
        print(f"  {family}: {examples}")


def generator_options(manifest: dict) -> dict:
    tiles = manifest["tiles"]
    families = available_families(tiles)
    ids_by_family = defaultdict(list)
    for tile in tiles:
        family = tile.get("shape_family", "")
        if not family:
            continue
        ids_by_family[family].append(tile["id"])

    return {
        "templates": list(TEMPLATES),
        "colors": sorted(COLOR_TOKEN_TO_HEX),
        "color_hex": COLOR_TOKEN_TO_HEX.copy(),
        "families": families,
        "family_tile_ids": {family: ids_by_family[family] for family in families},
        "topic_profiles": [
            {
                "key": key,
                "label": profile["label"],
                "description": profile["description"],
            }
            for key, profile in TOPIC_STYLE_PROFILES.items()
            if key != "general_fai"
        ],
        "defaults": {
            "energy": "medium",
            "dimensions": [1920, 960],
            "continuity_strength": 0.7,
            "symmetry_strength": 0.85,
            "rhythm_strength": 0.75,
            "candidate_count": 24,
        },
    }


def topic_keyword_hits(description: str, keywords: dict[str, float]) -> tuple[float, list[str]]:
    normalized = re.sub(r"[^a-z0-9]+", " ", description.lower()).strip()
    if not normalized:
        return 0.0, []

    score = 0.0
    hits = []
    for keyword, weight in keywords.items():
        if not keyword:
            continue
        pattern = r"\b" + re.escape(keyword.lower()) + r"\b"
        if re.search(pattern, normalized):
            score += weight
            hits.append(keyword)

    # Bonus for multi-word keyword matches (more specific = more signal)
    multi_word_hits = [h for h in hits if " " in h]
    if multi_word_hits:
        score += len(multi_word_hits) * 1.5

    # Density bonus: reward profiles where a higher fraction of their
    # keywords appear in the description (signals a tighter topic fit)
    if keywords and hits:
        hit_fraction = len(hits) / len(keywords)
        score *= 1.0 + hit_fraction * 0.4

    return score, hits


def _blend_profiles(dominant: dict, secondary: dict, blend_weight: float) -> dict:
    """Return a parameter dict that interpolates two profiles.

    blend_weight is the secondary profile's fractional contribution (0.0–0.5).
    The dominant profile always contributes at least 50%, so it determines
    template, color_bias, and energy.  Numeric strength parameters are
    interpolated.  Tile families are merged: dominant families lead, then
    secondary families that don't duplicate the dominant are appended.
    """
    w_sec = blend_weight       # secondary weight  (0.0 – 0.5)
    w_dom = 1.0 - blend_weight # dominant weight   (0.5 – 1.0)

    def lerp(a: float, b: float) -> float:
        return round(a * w_dom + b * w_sec, 3)

    # Merge tile families without duplicates; dominant families first.
    def merge_families(dom_fams: list, sec_fams: list) -> list:
        seen: set = set()
        merged = []
        for f in dom_fams + sec_fams:
            if f not in seen:
                seen.add(f)
                merged.append(f)
        return merged

    return {
        # Non-numeric params: dominant profile wins
        "energy": dominant["energy"],
        "template": dominant["template"],
        "color_bias": dominant["color_bias"],
        # Numeric strengths: weighted interpolation
        "continuity_strength": lerp(dominant["continuity_strength"], secondary["continuity_strength"]),
        "symmetry_strength": lerp(dominant["symmetry_strength"], secondary["symmetry_strength"]),
        "rhythm_strength": lerp(dominant["rhythm_strength"], secondary["rhythm_strength"]),
        # Families: dominant first, then non-overlapping secondary families
        "primary_families": merge_families(dominant["primary_families"], secondary["primary_families"]),
        "accent_families": merge_families(dominant["accent_families"], secondary["accent_families"]),
    }


def suggest_topic_style(description: Optional[str], manifest: dict) -> Optional[dict]:
    description = normalize_topic_description(description)
    if not description:
        return None

    available = set(available_families(manifest["tiles"]))
    scored = []
    for key, profile in TOPIC_STYLE_PROFILES.items():
        score, hits = topic_keyword_hits(description, profile["keywords"])
        if key == "general_fai":
            score = max(score, 0.1)
        scored.append((score, key, hits, profile))

    scored.sort(key=lambda item: item[0], reverse=True)
    best_score, best_key, best_hits, best_profile = scored[0]

    # If the best real topic scored below a meaningful threshold and only
    # general_fai won by its floor, skip topic styling entirely so the
    # user's original request parameters are preserved.
    if best_key == "general_fai" and best_score <= 0.1:
        return None

    # ── Cross-domain blending ─────────────────────────────────────────
    # When a description meaningfully spans two policy domains, blend
    # the visual parameters rather than snapping hard to one profile.
    # Conditions:
    #   • Second-place score is at least 55% of the top score
    #   • Second-place score exceeds an absolute minimum (not noise)
    #   • Neither profile is general_fai (that profile intentionally
    #     has no domain signal and should not contribute to a blend)
    blend_info = None
    blended_params: dict = {}
    if len(scored) >= 2:
        second_score, second_key, second_hits, second_profile = scored[1]
        blend_eligible = (
            second_key != "general_fai"
            and best_key != "general_fai"
            and best_score > 0
            and second_score >= best_score * 0.55
            and second_score >= 2.5
        )
        if blend_eligible:
            # Blend weight: how much the secondary profile contributes.
            # Ranges from just above 0 up to 0.45 (never a full 50/50).
            raw_ratio = second_score / (best_score + second_score)  # 0.0 – 0.5
            blend_weight = min(0.45, raw_ratio)
            blended_params = _blend_profiles(best_profile, second_profile, blend_weight)
            blend_info = {
                "secondary_key": second_key,
                "secondary_label": second_profile["label"],
                "secondary_score": second_score,
                "blend_weight": round(blend_weight, 3),
            }

    # Resolve families from whichever param source wins
    param_source = blended_params if blended_params else best_profile
    primary_families = [f for f in param_source["primary_families"] if f in available]
    accent_families = [
        f for f in param_source["accent_families"]
        if f in available and f not in primary_families
    ]
    keyword_hits = best_hits[:5]

    result = {
        "key": best_key,
        "label": best_profile["label"],
        "description": best_profile["description"],
        "keyword_hits": keyword_hits,
        "match_score": best_score,
        "energy": param_source["energy"],
        "template": param_source["template"],
        "color_bias": param_source["color_bias"],
        "continuity_strength": param_source["continuity_strength"],
        "symmetry_strength": param_source["symmetry_strength"],
        "rhythm_strength": param_source["rhythm_strength"],
        "primary_families": primary_families,
        "accent_families": accent_families,
    }
    if blend_info:
        result["blend"] = blend_info
    return result


def apply_topic_style_to_request(request: BannerRequest, manifest: dict) -> tuple[BannerRequest, Optional[dict]]:
    suggestion = suggest_topic_style(request.topic_description, manifest)
    if suggestion is None:
        return request, None

    styled_request = replace(
        request,
        energy=suggestion["energy"],
        template=suggestion["template"],
        color_bias=suggestion["color_bias"],
        continuity_strength=suggestion["continuity_strength"],
        symmetry_strength=suggestion["symmetry_strength"],
        rhythm_strength=suggestion["rhythm_strength"],
        primary_families=suggestion["primary_families"],
        accent_families=suggestion["accent_families"],
    ).normalized()
    return styled_request, suggestion


def choose_template(energy: str, rng: random.Random, override: Optional[str]) -> str:
    if override:
        return override
    weights_map = TEMPLATE_ENERGY_WEIGHTS[energy]
    templates = [name for name in TEMPLATES if weights_map.get(name, 0) > 0]
    weights = [weights_map[name] for name in templates]
    return rng.choices(templates, weights=weights, k=1)[0]


# - Rotated tile pool -------------------------------------------------------
def build_rotated_pool(tiles: list[dict]) -> list[RotatedTile]:
    pool = []
    for tile in tiles:
        if tile.get("shape_family") == "lines" and "clear" in tile.get("id", ""):
            continue

        symmetry = tile.get("symmetry", "none")
        edge_type = tile.get("edge_type", {edge: False for edge in ("top", "right", "bottom", "left")})
        edge_cov = tile.get("edge_coverage", {edge: 0.0 for edge in ("top", "right", "bottom", "left")})

        if symmetry == "both":
            rotations = [0]
        elif symmetry in ("horizontal", "vertical", "rotational"):
            rotations = [0, 90]
        else:
            rotations = ROTATIONS

        for rotation in rotations:
            rotated_type, rotated_cov = rotate_edges(edge_type, edge_cov, rotation)
            pool.append(
                RotatedTile(
                    tile=tile,
                    rotation=rotation,
                    edges=rotated_type,
                    coverage=rotated_cov,
                )
            )
    return pool


# - Family and tile palette selection ---------------------------------------
def target_rotation_for_position(template: str, row: int, col: int) -> Optional[int]:
    rotation_fn = ROTATION_PATTERN_FNS[TEMPLATE_CONFIG[template]["rotation"]]
    if rotation_fn is None:
        return None
    return ROTATIONS[rotation_fn(row, col)]


def candidate_pool_for_target_rotation(
    rotated_pool: list[RotatedTile],
    target_rotation: Optional[int],
    rotation_strict: bool,
) -> list[RotatedTile]:
    if rotation_strict and target_rotation is not None:
        exact = [candidate for candidate in rotated_pool if candidate.rotation == target_rotation]
        if exact:
            return exact
    return rotated_pool


def pair_structure_bonus(left: RotatedTile, right: RotatedTile, template: str) -> float:
    score = 0.0
    left_family = left.tile.get("shape_family", "")
    right_family = right.tile.get("shape_family", "")

    if left.tile.get("id") == right.tile.get("id"):
        score += 5.2 if template == "mirror" else 4.4
    elif left_family and left_family == right_family:
        score += 2.8

    left_weight = left.tile.get("visual_weight", 0.0)
    right_weight = right.tile.get("visual_weight", 0.0)
    score += max(0.0, 1.5 - abs(left_weight - right_weight) * 14.0)

    if left.tile.get("symmetry") in ("horizontal", "vertical", "rotational", "both"):
        score += 0.35
    if right.tile.get("symmetry") in ("horizontal", "vertical", "rotational", "both"):
        score += 0.25

    center_match = (left.coverage["right"] + right.coverage["left"]) / 2
    if left.edges["right"] == right.edges["left"]:
        score += 0.3 + 0.2 * center_match

    return score


def family_weight_for_template(template: str, family: str, family_size: int) -> float:
    weight = float(family_size)
    if template in {"flow", "river"} and family in FLOW_FAMILIES:
        weight *= 2.2
    elif template in {"pinwheel", "spiral", "mirror", "symmetric", "checkerboard"} and family in GEOMETRIC_FAMILIES:
        weight *= 1.9
    elif template in {"focal", "gradient"} and family in GEOMETRIC_FAMILIES | FLOW_FAMILIES:
        weight *= 1.2
    elif template == "scatter":
        weight *= 1.0
    return max(weight, 0.1)


def pick_family_focus(
    tiles: list[dict],
    template: str,
    rng: random.Random,
) -> tuple[list[str], list[str]]:
    cfg = TEMPLATE_CONFIG[template]
    family_tiles = defaultdict(list)

    for tile in tiles:
        family = tile.get("shape_family", "")
        if not family or (family == "lines" and "clear" in tile.get("id", "")):
            continue
        family_tiles[family].append(tile)

    families = list(family_tiles)
    weights = [family_weight_for_template(template, family, len(family_tiles[family])) for family in families]

    n_primary = rng.randint(*cfg["primary_fam"])
    primary = weighted_sample_without_replacement(families, weights, n_primary, rng)

    accent_candidates = [family for family in families if family not in primary]
    accent_weights = [len(family_tiles[family]) for family in accent_candidates]
    n_accent = rng.randint(*cfg["accent_fam"])
    accent = weighted_sample_without_replacement(accent_candidates, accent_weights, n_accent, rng)
    return primary, accent


def resolve_family_focus(
    tiles: list[dict],
    template: str,
    rng: random.Random,
    primary_override: Optional[list[str]] = None,
    accent_override: Optional[list[str]] = None,
    tile_ids_override: Optional[list[str]] = None,
) -> tuple[list[str], list[str]]:
    primary = normalize_name_list(primary_override)
    accent = [family for family in normalize_name_list(accent_override) if family not in primary]

    if tile_ids_override and not primary and not accent:
        lookup = tile_lookup(tiles)
        families = dedupe_preserving_order([
            lookup[tile_id]["shape_family"]
            for tile_id in normalize_name_list(tile_ids_override)
            if tile_id in lookup
        ])
        if families:
            return families, []

    if primary and accent:
        return primary, accent

    picked_primary, picked_accent = pick_family_focus(tiles, template, rng)
    if primary:
        picked_primary = primary
    if accent:
        picked_accent = accent

    picked_accent = [family for family in picked_accent if family not in picked_primary]
    return picked_primary, picked_accent


def tile_palette_weight(tile: dict, template: str, role: str) -> float:
    weight = 1.0 + tile.get("visual_weight", 0.0) * 2.0
    edges = tile.get("edge_type", {})
    active_edges = sum(1 for edge in ("top", "right", "bottom", "left") if edges.get(edge))

    if role == "primary":
        weight += 0.8
    else:
        weight += 0.2

    if template in {"flow", "river"}:
        if edges.get("left") and edges.get("right"):
            weight += 2.0
        if edges.get("top") and edges.get("bottom"):
            weight += 1.0

    if template in {"mirror", "symmetric"} and tile.get("symmetry") in ("vertical", "horizontal", "both"):
        weight += 1.2

    if template in {"pinwheel", "spiral", "checkerboard"}:
        if active_edges >= 2:
            weight += 0.8
        if tile.get("shape_family") in GEOMETRIC_FAMILIES:
            weight += 0.6

    if template == "focal":
        weight += tile.get("visual_weight", 0.0) * 2.5

    if template == "scatter":
        weight += max(0.0, 0.35 - abs(tile.get("visual_weight", 0.0) - 0.18))

    if template == "gradient":
        weight += max(0.0, 0.4 - abs(tile.get("visual_weight", 0.0) - 0.22))

    if tile.get("complexity") == "complex" and template in MOTIF_TEMPLATES:
        weight -= 0.4

    if active_edges == 0:
        weight -= 0.8

    return max(weight, 0.05)


def pick_tile_palette(
    tiles: list[dict],
    template: str,
    primary_families: list[str],
    accent_families: list[str],
    rng: random.Random,
) -> list[dict]:
    cfg = TEMPLATE_CONFIG[template]
    n_primary_tiles = rng.randint(*cfg["primary_tiles"])
    n_accent_tiles = rng.randint(*cfg["accent_tiles"])

    primary_pool = [tile for tile in tiles if tile.get("shape_family") in primary_families]
    accent_pool = [tile for tile in tiles if tile.get("shape_family") in accent_families]

    chosen = []
    if primary_pool:
        chosen.extend(
            weighted_sample_without_replacement(
                primary_pool,
                [tile_palette_weight(tile, template, "primary") for tile in primary_pool],
                n_primary_tiles,
                rng,
            )
        )

    accent_pool = [tile for tile in accent_pool if tile["id"] not in {item["id"] for item in chosen}]
    if accent_pool and n_accent_tiles:
        chosen.extend(
            weighted_sample_without_replacement(
                accent_pool,
                [tile_palette_weight(tile, template, "accent") for tile in accent_pool],
                n_accent_tiles,
                rng,
            )
        )

    if len(chosen) < 3:
        remainder = [tile for tile in primary_pool if tile["id"] not in {item["id"] for item in chosen}]
        chosen.extend(
            weighted_sample_without_replacement(
                remainder,
                [tile_palette_weight(tile, template, "primary") for tile in remainder],
                3 - len(chosen),
                rng,
            )
        )

    return chosen or tiles


def resolve_tile_palette(
    tiles: list[dict],
    template: str,
    primary_families: list[str],
    accent_families: list[str],
    rng: random.Random,
    tile_ids_override: Optional[list[str]] = None,
) -> list[dict]:
    tile_ids = normalize_name_list(tile_ids_override)
    if tile_ids:
        lookup = tile_lookup(tiles)
        return [lookup[tile_id] for tile_id in tile_ids if tile_id in lookup]

    return pick_tile_palette(tiles, template, primary_families, accent_families, rng)


# - Tile placement ----------------------------------------------------------
def make_position_weights(template: str) -> list[float]:
    weights = [1.0] * TOTAL_SLOTS
    if template == "focal":
        for pos in range(TOTAL_SLOTS):
            row, col = divmod(pos, GRID_COLS)
            dist = math.sqrt((col - 2.5) ** 2 + (row - 1.0) ** 2)
            weights[pos] = max(0.3, 2.5 - dist * 0.55)
    elif template == "river":
        for pos in range(TOTAL_SLOTS):
            row, col = divmod(pos, GRID_COLS)
            weights[pos] = 1.75 if row == 1 else 0.85
            if col in (2, 3):
                weights[pos] += 0.2
    elif template == "gradient":
        for pos in range(TOTAL_SLOTS):
            row, col = divmod(pos, GRID_COLS)
            weights[pos] = 0.9 + col * 0.08 + row * 0.04
    return weights


def placement_order(template: str, position_weights: list[float]) -> list[int]:
    order = list(range(TOTAL_SLOTS))
    if template in {"focal", "gradient"}:
        order.sort(key=lambda pos: position_weights[pos], reverse=True)
    elif template == "river":
        order.sort(key=lambda pos: (position_weights[pos], -(pos % GRID_COLS)), reverse=True)
    return order


def score_candidate(
    candidate: RotatedTile,
    placed: dict,
    row: int,
    col: int,
    primary_families: list[str],
    accent_families: list[str],
    target_rotation: Optional[int],
    rotation_counts: Counter,
    tile_counts: Counter,
    template: str,
    pos_weight: float,
) -> float:
    family = candidate.tile.get("shape_family", "")
    tile_id = candidate.tile.get("id", "")

    if family in primary_families:
        score = 9.0
    elif family in accent_families:
        score = 3.0
    else:
        score = -20.0

    if target_rotation is not None:
        score += 4.0 if candidate.rotation == target_rotation else -6.0
    else:
        score += max(0.0, 1.5 - rotation_counts.get(candidate.rotation, 0) * 0.25)

    uses = tile_counts.get(tile_id, 0)
    reuse_soft_limit = 4 if template in MOTIF_TEMPLATES else 3
    if uses == 0:
        score += 1.4
    elif uses <= reuse_soft_limit:
        score += 0.8 if template in MOTIF_TEMPLATES else 0.6
    else:
        penalty_scale = 0.55 if template in MOTIF_TEMPLATES else 0.9
        score -= penalty_scale * (uses - reuse_soft_limit + 1)

    for neighbor_offset, our_edge, their_edge in [
        ((0, -1), "left", "right"),
        ((-1, 0), "top", "bottom"),
    ]:
        nr = row + neighbor_offset[0]
        nc = col + neighbor_offset[1]
        if (nr, nc) not in placed:
            continue
        neighbor = placed[(nr, nc)]
        our_active = candidate.edges[our_edge]
        their_active = neighbor.edges[their_edge]
        if our_active and their_active:
            match = (candidate.coverage[our_edge] + neighbor.coverage[their_edge]) / 2
            score += 2.2 * match
            if template == "river" and our_edge in ("left", "right"):
                score += 0.35 * match
        elif not our_active and not their_active:
            score += 0.15
        else:
            score -= 0.8

        if neighbor.tile.get("id") == tile_id:
            score -= 0.4 if template in MOTIF_TEMPLATES else 1.0

    score += candidate.tile.get("visual_weight", 0.0) * pos_weight
    return max(score, 0.01)


def paired_symmetric_tile_placement(
    rotated_pool: list[RotatedTile],
    template: str,
    primary_families: list[str],
    accent_families: list[str],
    rng: random.Random,
    top_k: int = 10,
) -> list[dict]:
    cfg = TEMPLATE_CONFIG[template]
    position_weights = make_position_weights(template)
    order = [pos for pos in placement_order(template, position_weights) if divmod(pos, GRID_COLS)[1] < GRID_COLS // 2]

    placed = {}
    rotation_counts = Counter()
    tile_counts = Counter()

    for pos in order:
        row, col = divmod(pos, GRID_COLS)
        partner_col = GRID_COLS - 1 - col

        left_target = target_rotation_for_position(template, row, col)
        right_target = target_rotation_for_position(template, row, partner_col)
        left_candidates = candidate_pool_for_target_rotation(rotated_pool, left_target, cfg["rotation_strict"])
        right_pool = candidate_pool_for_target_rotation(rotated_pool, right_target, cfg["rotation_strict"])

        left_scored = []
        for candidate in left_candidates:
            left_scored.append(
                (
                    candidate,
                    score_candidate(
                        candidate,
                        placed,
                        row,
                        col,
                        primary_families,
                        accent_families,
                        left_target,
                        rotation_counts,
                        tile_counts,
                        template,
                        position_weights[pos],
                    ),
                )
            )

        left_top = sorted(left_scored, key=lambda item: item[1], reverse=True)[: max(4, min(top_k, len(left_scored)))]
        pair_scored = []

        for left_candidate, left_score in left_top:
            preferred_right = [candidate for candidate in right_pool if candidate.tile.get("id") == left_candidate.tile.get("id")]
            if not preferred_right:
                preferred_right = [
                    candidate
                    for candidate in right_pool
                    if candidate.tile.get("shape_family") == left_candidate.tile.get("shape_family")
                ]
            if not preferred_right:
                preferred_right = right_pool

            placed_with_left = dict(placed)
            placed_with_left[(row, col)] = left_candidate
            right_scored = []
            for right_candidate in preferred_right:
                bonus = pair_structure_bonus(left_candidate, right_candidate, template)
                right_scored.append(
                    (
                        right_candidate,
                        score_candidate(
                            right_candidate,
                            placed_with_left,
                            row,
                            partner_col,
                            primary_families,
                            accent_families,
                            right_target,
                            rotation_counts,
                            tile_counts,
                            template,
                            position_weights[row * GRID_COLS + partner_col],
                        )
                        + bonus,
                    )
                )

            right_top = sorted(right_scored, key=lambda item: item[1], reverse=True)[: max(3, min(6, len(right_scored)))]
            for right_candidate, right_score in right_top:
                pair_scored.append((left_candidate, right_candidate, left_score + right_score))

        if not pair_scored:
            raise ValueError(f"Could not build a symmetric placement pair for template {template}")

        top_pairs = sorted(pair_scored, key=lambda item: item[2], reverse=True)[:8]
        left_choice, right_choice, _ = rng.choices(
            top_pairs,
            weights=[score for _, _, score in top_pairs],
            k=1,
        )[0]

        placed[(row, col)] = left_choice
        placed[(row, partner_col)] = right_choice
        rotation_counts[left_choice.rotation] += 1
        rotation_counts[right_choice.rotation] += 1
        tile_counts[left_choice.tile["id"]] += 1
        tile_counts[right_choice.tile["id"]] += 1

    result = []
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            chosen = placed[(row, col)]
            result.append(
                {
                    "row": row,
                    "col": col,
                    "tile": chosen.tile,
                    "rotation": chosen.rotation,
                    "edges": chosen.edges,
                    "coverage": chosen.coverage,
                }
            )
    return result


def scored_tile_placement(
    rotated_pool: list[RotatedTile],
    template: str,
    primary_families: list[str],
    accent_families: list[str],
    rng: random.Random,
    top_k: int = 10,
) -> list[dict]:
    if template in MIRROR_TEMPLATES:
        return paired_symmetric_tile_placement(rotated_pool, template, primary_families, accent_families, rng, top_k=top_k)

    cfg = TEMPLATE_CONFIG[template]
    position_weights = make_position_weights(template)
    order = placement_order(template, position_weights)

    placed = {}
    rotation_counts = Counter()
    tile_counts = Counter()

    for pos in order:
        row, col = divmod(pos, GRID_COLS)
        target_rotation = target_rotation_for_position(template, row, col)
        candidates = candidate_pool_for_target_rotation(rotated_pool, target_rotation, cfg["rotation_strict"])

        scored = []
        for candidate in candidates:
            score = score_candidate(
                candidate,
                placed,
                row,
                col,
                primary_families,
                accent_families,
                target_rotation,
                rotation_counts,
                tile_counts,
                template,
                position_weights[pos],
            )
            scored.append((candidate, score))

        top = sorted(scored, key=lambda item: item[1], reverse=True)[: max(4, min(top_k, len(scored)))]
        choice = rng.choices([candidate for candidate, _ in top], weights=[score for _, score in top], k=1)[0]
        placed[(row, col)] = choice
        rotation_counts[choice.rotation] += 1
        tile_counts[choice.tile["id"]] += 1

    result = []
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            chosen = placed[(row, col)]
            result.append(
                {
                    "row": row,
                    "col": col,
                    "tile": chosen.tile,
                    "rotation": chosen.rotation,
                    "edges": chosen.edges,
                    "coverage": chosen.coverage,
                }
            )
    return result


# - Continuity grouping -----------------------------------------------------
def matched_edge_candidates(placement: list[dict], template: str, rng: random.Random):
    grid = {(item["row"], item["col"]): item for item in placement}
    candidates = []

    for item in placement:
        row = item["row"]
        col = item["col"]

        if col + 1 < GRID_COLS:
            neighbor = grid[(row, col + 1)]
            if item["edges"]["right"] and neighbor["edges"]["left"]:
                coverage = (item["coverage"]["right"] + neighbor["coverage"]["left"]) / 2
                score = coverage
                if template in {"flow", "river"}:
                    score += 0.25
                if template == "river" and row == 1:
                    score += 0.35
                candidates.append((score + rng.random() * 0.05, (row, col), (row, col + 1), "h"))

        if row + 1 < GRID_ROWS:
            neighbor = grid[(row + 1, col)]
            if item["edges"]["bottom"] and neighbor["edges"]["top"]:
                coverage = (item["coverage"]["bottom"] + neighbor["coverage"]["top"]) / 2
                score = coverage
                if template in {"mirror", "symmetric", "focal"}:
                    score += 0.15
                candidates.append((score + rng.random() * 0.05, (row, col), (row + 1, col), "v"))

    return candidates


def build_continuity_pairs(
    placement: list[dict],
    template: str,
    continuity_strength: float,
    rng: random.Random,
) -> list[tuple[tuple[int, int], tuple[int, int]]]:
    candidates = sorted(matched_edge_candidates(placement, template, rng), reverse=True)
    if not candidates:
        return []

    all_positions = [(row, col) for row in range(GRID_ROWS) for col in range(GRID_COLS)]
    union_find = UnionFind(all_positions)
    degree = Counter()

    base_target = round(len(candidates) * (0.10 + continuity_strength * 0.35))
    target_pairs = max(1, min(7, base_target))
    max_degree = 2 if template in MOTIF_TEMPLATES else 1
    max_group_size = 4 if template in {"flow", "river"} else 3 if template in MOTIF_TEMPLATES else 2

    selected = []
    for _, a, b, _ in candidates:
        if len(selected) >= target_pairs:
            break
        if degree[a] >= max_degree or degree[b] >= max_degree:
            continue
        if union_find.find(a) != union_find.find(b) and union_find.size(a) + union_find.size(b) > max_group_size:
            continue
        union_find.union(a, b)
        degree[a] += 1
        degree[b] += 1
        selected.append((a, b))

    return selected


def build_continuity_groups(
    continuity_pairs: list[tuple[tuple[int, int], tuple[int, int]]]
) -> tuple[dict, dict]:
    positions = [(row, col) for row in range(GRID_ROWS) for col in range(GRID_COLS)]
    union_find = UnionFind(positions)
    for a, b in continuity_pairs:
        union_find.union(a, b)

    groups = defaultdict(list)
    pos_to_group = {}
    for pos in positions:
        group_id = union_find.find(pos)
        groups[group_id].append(pos)
        pos_to_group[pos] = group_id
    return dict(groups), pos_to_group


def build_group_adjacency(pos_to_group: dict) -> dict:
    adjacency = Counter()
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            current = (row, col)
            g1 = pos_to_group[current]
            for neighbor in ((row, col + 1), (row + 1, col)):
                nr, nc = neighbor
                if nr >= GRID_ROWS or nc >= GRID_COLS:
                    continue
                g2 = pos_to_group[neighbor]
                if g1 == g2:
                    continue
                adjacency[pair_key(g1, g2)] += 1
    return dict(adjacency)


# - Color assignment --------------------------------------------------------
def build_color_targets(
    energy: str,
    rng: random.Random,
    color_bias: Optional[str] = None,
    restrict_colors: Optional[list[str]] = None,
) -> dict[str, int]:
    # Hard restriction: only use exactly these colors
    if restrict_colors and len(restrict_colors) >= 2:
        allowed = [c for c in restrict_colors if c in COLOR_TOKEN_TO_HEX]
        if len(allowed) >= 2:
            targets = {}
            per_color = TOTAL_SLOTS // len(allowed)
            remainder = TOTAL_SLOTS % len(allowed)
            for i, color in enumerate(allowed):
                targets[color] = per_color + (1 if i < remainder else 0)
            return targets

    if energy == "low":
        if color_bias in {"cod_gray", "white", "smoke_white", "timberwolf"}:
            dominant = color_bias
        else:
            dominant = rng.choice(["cod_gray", "white", "smoke_white"])

        targets = {}
        accent_color = "international_orange"
        if color_bias in {"international_orange", "celestial_blue", "chrome_yellow"}:
            accent_color = color_bias

        accent_count = rng.randint(1, 2)
        if accent_color != "international_orange":
            accent_count = rng.randint(3, 4)
        elif color_bias == "international_orange":
            accent_count = rng.randint(3, 4)
        max_secondary = max(0, TOTAL_SLOTS - accent_count - 12)
        secondary_count = rng.randint(0, min(3, max_secondary))

        targets[dominant] = TOTAL_SLOTS - accent_count - secondary_count
        targets[accent_color] = accent_count

        if secondary_count:
            allowed = [color for color in ["cod_gray", "white", "smoke_white", "timberwolf"] if color != dominant]
            secondary = color_bias if color_bias in allowed else rng.choice(allowed)
            targets[secondary] = secondary_count

        if color_bias in {"international_orange", "celestial_blue", "chrome_yellow"}:
            desired = 6 if color_bias == "international_orange" else 4
            targets.setdefault(color_bias, targets.get(color_bias, 0))
            while targets[color_bias] < desired:
                donors = [
                    color
                    for color, count in sorted(targets.items(), key=lambda item: item[1], reverse=True)
                    if color != color_bias and count > 2
                ]
                if not donors:
                    break
                donor = donors[0]
                targets[donor] -= 1
                targets[color_bias] += 1
        return targets

    if energy == "medium":
        num_colors = rng.randint(4, 5)
        palette = ["international_orange", "cod_gray"]
        others = [color for color in ALL_COLOR_TOKENS if color not in palette]
        if color_bias and color_bias not in palette and color_bias in others:
            palette.append(color_bias)
            others.remove(color_bias)
        palette.extend(
            weighted_sample_without_replacement(
                others,
                [1.0] * len(others),
                num_colors - len(palette),
                rng,
            )
        )

        targets = {color: 1 for color in palette}
        targets["international_orange"] = rng.randint(2, 4)
        remaining = TOTAL_SLOTS - sum(targets.values())
        while remaining > 0:
            candidates = [color for color in palette if targets[color] < 6]
            chosen = rng.choice(candidates)
            targets[chosen] += 1
            remaining -= 1
        if color_bias:
            desired = 8 if color_bias in {"international_orange", "cod_gray"} else 7
            current = targets.get(color_bias, 0)
            targets.setdefault(color_bias, current)
            while targets[color_bias] < desired:
                donors = [color for color, count in sorted(targets.items(), key=lambda item: item[1], reverse=True) if color != color_bias and count > 2]
                if not donors:
                    break
                donor = donors[0]
                targets[donor] -= 1
                targets[color_bias] += 1
        return targets

    num_colors = rng.randint(6, 7)
    palette = ["international_orange", "celestial_blue", "chrome_yellow"]
    others = [color for color in ALL_COLOR_TOKENS if color not in palette]
    if color_bias and color_bias not in palette and color_bias in others:
        palette.append(color_bias)
        others.remove(color_bias)
    palette.extend(
        weighted_sample_without_replacement(
            others,
            [1.0] * len(others),
            num_colors - len(palette),
            rng,
        )
    )

    targets = {color: 1 for color in palette}
    targets["international_orange"] = rng.randint(3, 5)
    remaining = TOTAL_SLOTS - sum(targets.values())
    while remaining > 0:
        candidates = [color for color in palette if targets[color] < 5]
        chosen = rng.choice(candidates)
        targets[chosen] += 1
        remaining -= 1
    if color_bias:
        desired = 6 if color_bias in {"international_orange", "celestial_blue", "chrome_yellow"} else 5
        current = targets.get(color_bias, 0)
        targets.setdefault(color_bias, current)
        while targets[color_bias] < desired:
            donors = [color for color, count in sorted(targets.items(), key=lambda item: item[1], reverse=True) if color != color_bias and count > 2]
            if not donors:
                break
            donor = donors[0]
            targets[donor] -= 1
            targets[color_bias] += 1
    return targets


def group_info(groups: dict, adjacency: dict) -> dict:
    neighbor_map = defaultdict(list)
    for (g1, g2), weight in adjacency.items():
        neighbor_map[g1].append((g2, weight))
        neighbor_map[g2].append((g1, weight))

    info = {}
    for group_id, positions in groups.items():
        rows = [row for row, _ in positions]
        cols = [col for _, col in positions]
        anchor = sum(1 for pos in positions if pos in POWER_POSITIONS) / max(1, len(positions))
        middle_row_weight = sum(1 for row in rows if row == 1) / max(1, len(rows))
        info[group_id] = {
            "size": len(positions),
            "avg_row": sum(rows) / len(rows),
            "avg_col": sum(cols) / len(cols),
            "anchor": anchor,
            "middle_row_weight": middle_row_weight,
            "degree": sum(weight for _, weight in neighbor_map[group_id]),
        }
    return info


def group_color_choice_score(
    group_id,
    color_name: str,
    info: dict,
    assigned: dict,
    used_counts: Counter,
    target_counts: dict[str, int],
    adjacency: dict,
    template: str,
    energy: str,
    color_bias: Optional[str] = None,
) -> float:
    size = info[group_id]["size"]
    remaining = target_counts.get(color_name, 0) - used_counts[color_name]
    score = min(size, max(remaining, 0)) * 1.6
    score -= max(0, size - max(remaining, 0)) * 1.1

    for (g1, g2), weight in adjacency.items():
        if group_id not in (g1, g2):
            continue
        other = g2 if group_id == g1 else g1
        other_color = assigned.get(other)
        if other_color is None:
            continue
        if other_color == color_name:
            same_penalty = 1.6 if energy == "low" else 2.5
            score -= same_penalty * weight
        else:
            our_temp = color_temperature(color_name)
            other_temp = color_temperature(other_color)
            if our_temp != other_temp and "neutral" not in (our_temp, other_temp):
                bonus = 0.2
                if template == "checkerboard":
                    bonus = 0.35
                score += bonus * weight

    score += info[group_id]["anchor"] * COLOR_IMPACT.get(color_name, 0.5) * 0.8

    if template == "gradient":
        ordered_palette = [color for color in GRADIENT_COLOR_ORDER if color in target_counts]
        rank = ordered_palette.index(color_name)
        goal = round(info[group_id]["avg_col"] / max(1, GRID_COLS - 1) * (len(ordered_palette) - 1))
        score -= abs(rank - goal) * 0.8

    if template == "river" and color_name in ("international_orange", "celestial_blue"):
        score += info[group_id]["middle_row_weight"] * 0.5

    if color_bias:
        bias_gap = max(0, target_counts.get(color_bias, 0) - used_counts[color_bias])
        if color_name == color_bias:
            score += 1.2 + info[group_id]["anchor"] * 0.6 + min(size, bias_gap) * 0.22
        elif bias_gap > 0:
            score -= min(size, bias_gap) * 0.16

    return score


def group_coloring_objective(
    assignments: dict,
    groups: dict,
    adjacency: dict,
    target_counts: dict[str, int],
    template: str,
    energy: str,
    color_bias: Optional[str] = None,
) -> float:
    used = Counter()
    for group_id, color_name in assignments.items():
        used[color_name] += len(groups[group_id])

    score = 0.0
    for color_name, target in target_counts.items():
        score -= abs(used[color_name] - target) * 0.65

    for (g1, g2), weight in adjacency.items():
        c1 = assignments[g1]
        c2 = assignments[g2]
        if c1 == c2:
            same_penalty = 1.6 if energy == "low" else 2.4
            score -= same_penalty * weight
        else:
            temp1 = color_temperature(c1)
            temp2 = color_temperature(c2)
            if temp1 != temp2 and "neutral" not in (temp1, temp2):
                bonus = 0.15 if template != "checkerboard" else 0.3
                score += bonus * weight

    if template == "gradient":
        ordered_palette = [color for color in GRADIENT_COLOR_ORDER if color in target_counts]
        for group_id, color_name in assignments.items():
            avg_col = sum(col for _, col in groups[group_id]) / len(groups[group_id])
            goal = round(avg_col / max(1, GRID_COLS - 1) * (len(ordered_palette) - 1))
            score -= abs(ordered_palette.index(color_name) - goal) * 0.6

    if color_bias:
        bias_cells = sum(len(groups[group_id]) for group_id, color_name in assignments.items() if color_name == color_bias)
        bias_target = max(1, target_counts.get(color_bias, 0))
        bias_fit = 1.0 - abs(bias_cells - bias_target) / bias_target
        score += bias_cells * 0.22
        score += clamp01(bias_fit) * 1.4

    return score


def assign_group_colors(
    groups: dict,
    adjacency: dict,
    target_counts: dict[str, int],
    template: str,
    energy: str,
    rng: random.Random,
    color_bias: Optional[str] = None,
) -> dict:
    info = group_info(groups, adjacency)
    group_ids = sorted(
        groups,
        key=lambda group_id: (info[group_id]["size"], info[group_id]["degree"], info[group_id]["anchor"]),
        reverse=True,
    )

    assignments = {}
    used_counts = Counter()
    palette = list(target_counts)

    for group_id in group_ids:
        scored = []
        for color_name in palette:
            score = group_color_choice_score(
                group_id,
                color_name,
                info,
                assignments,
                used_counts,
                target_counts,
                adjacency,
                template,
                energy,
                color_bias,
            )
            scored.append((color_name, score))

        top = sorted(scored, key=lambda item: item[1], reverse=True)[: max(2, min(3, len(scored)))]
        chosen = rng.choices([color for color, _ in top], weights=[max(score, 0.01) for _, score in top], k=1)[0]
        assignments[group_id] = chosen
        used_counts[chosen] += len(groups[group_id])

    current_score = group_coloring_objective(assignments, groups, adjacency, target_counts, template, energy, color_bias)
    for _ in range(120):
        trial = dict(assignments)
        if rng.random() < 0.65:
            group_id = rng.choice(group_ids)
            trial[group_id] = rng.choice(palette)
        else:
            g1, g2 = rng.sample(group_ids, 2)
            trial[g1], trial[g2] = trial[g2], trial[g1]
        trial_score = group_coloring_objective(trial, groups, adjacency, target_counts, template, energy, color_bias)
        if trial_score > current_score:
            assignments = trial
            current_score = trial_score

    return assignments


def preferred_backgrounds(fg_name: str) -> list[str]:
    fg_hex = COLOR_TOKEN_TO_HEX[fg_name]
    if fg_hex in WARM_COLORS or fg_name in ("international_orange", "chrome_yellow"):
        return ["cod_gray", "white", "smoke_white", "timberwolf", "celestial_blue"]
    if fg_hex in COOL_COLORS or fg_name == "celestial_blue":
        return ["cod_gray", "white", "smoke_white", "international_orange", "timberwolf"]
    if fg_name == "cod_gray":
        return ["white", "smoke_white", "timberwolf", "international_orange", "celestial_blue"]
    return ["cod_gray", "international_orange", "celestial_blue", "chrome_yellow", "timberwolf"]


def background_palette_limit(template: str) -> int:
    if template in MIRROR_TEMPLATES | {"flow", "river"}:
        return 3
    if template in {"focal", "gradient"}:
        return 4
    return 5


def background_candidate_score(
    bg_name: str,
    positions: list[tuple[int, int]],
    backgrounds: dict,
    fg_by_pos: dict,
    template: str,
) -> float:
    used_backgrounds = set(backgrounds.values())
    score = 0.0

    for row, col in positions:
        fg_name = fg_by_pos[(row, col)]
        if bg_name == fg_name:
            return -999.0

        preferred = [color for color in preferred_backgrounds(fg_name) if color != fg_name]
        if bg_name in preferred:
            score += float(len(preferred) - preferred.index(bg_name))
        else:
            score -= 1.25

        for neighbor in ((row, col - 1), (row, col + 1), (row - 1, col), (row + 1, col)):
            if neighbor not in backgrounds:
                continue
            if backgrounds[neighbor] == bg_name:
                bonus = 0.12
                if template in {"flow", "river"} and neighbor[0] == row:
                    bonus = 0.55
                elif template in MIRROR_TEMPLATES and neighbor[0] == row:
                    bonus = 0.32
                score += bonus
            if fg_by_pos.get(neighbor) == bg_name:
                score -= 0.2

        if template == "checkerboard" and (row + col) % 2 == 0 and color_temperature(bg_name) == "neutral":
            score += 0.25

    if bg_name not in used_backgrounds and len(used_backgrounds) >= background_palette_limit(template):
        score -= 1.4

    if template in MIRROR_TEMPLATES and len(positions) == 2:
        score += 0.9

    return score


def assign_backgrounds(
    fg_by_pos: dict,
    template: str,
    rng: random.Random,
    restrict_colors: Optional[list[str]] = None,
) -> dict:
    backgrounds = {}
    positions = [(row, col) for row in range(GRID_ROWS) for col in range(GRID_COLS)]
    color_pool = restrict_colors if restrict_colors else ALL_COLOR_TOKENS

    if template in MIRROR_TEMPLATES:
        paired_positions = [
            [(row, col), (row, GRID_COLS - 1 - col)]
            for row in range(GRID_ROWS)
            for col in range(GRID_COLS // 2)
        ]
        paired_positions.sort(key=lambda pair: (abs(pair[0][1] - 2.5), abs(pair[0][0] - 1)))

        for pair in paired_positions:
            candidates = [color for color in color_pool if all(fg_by_pos[pos] != color for pos in pair)]
            if not candidates:
                candidates = list(color_pool)
            scored = [(bg_name, background_candidate_score(bg_name, pair, backgrounds, fg_by_pos, template)) for bg_name in candidates]
            top = sorted(scored, key=lambda item: item[1], reverse=True)[:3]
            chosen = rng.choices([name for name, _ in top], weights=[max(score, 0.01) for _, score in top], k=1)[0]
            for pos in pair:
                backgrounds[pos] = chosen
        return backgrounds

    if template == "focal":
        positions.sort(key=lambda pos: abs(pos[0] - 1) + abs(pos[1] - 2.5))
    elif template == "river":
        positions.sort(key=lambda pos: (abs(pos[0] - 1), pos[1]))
    elif template == "flow":
        positions.sort(key=lambda pos: (pos[0], abs(pos[1] - 2.5)))

    for row, col in positions:
        candidates = [color for color in color_pool if fg_by_pos[(row, col)] != color]
        if not candidates:
            candidates = list(color_pool)
        scored = [(bg_name, background_candidate_score(bg_name, [(row, col)], backgrounds, fg_by_pos, template)) for bg_name in candidates]

        top = sorted(scored, key=lambda item: item[1], reverse=True)[:3]
        chosen = rng.choices([name for name, _ in top], weights=[max(score, 0.01) for _, score in top], k=1)[0]
        backgrounds[(row, col)] = chosen

    return backgrounds


# - Candidate scoring -------------------------------------------------------
def score_rotation_pattern(placement: list[dict], template: str) -> float:
    rotation_fn = ROTATION_PATTERN_FNS[TEMPLATE_CONFIG[template]["rotation"]]
    if rotation_fn is None:
        return 0.7
    matches = 0
    for item in placement:
        expected = ROTATIONS[rotation_fn(item["row"], item["col"])]
        if item["rotation"] == expected:
            matches += 1
    return matches / TOTAL_SLOTS


def score_repetition(placement: list[dict], template: str) -> float:
    counts = Counter(item["tile"]["id"] for item in placement)
    unique_count = len(counts)
    ideal_low, ideal_high = (3, 5) if TEMPLATE_CONFIG[template]["motif"] else (4, 6)
    if ideal_low <= unique_count <= ideal_high:
        unique_score = 1.0
    else:
        midpoint = (ideal_low + ideal_high) / 2
        unique_score = max(0.0, 1.0 - abs(unique_count - midpoint) * 0.18)

    singletons = sum(1 for value in counts.values() if value == 1)
    singleton_penalty = max(0, singletons - 2) * 0.18
    dominant_penalty = max(0, max(counts.values()) - 6) * 0.10
    return clamp01(unique_score - singleton_penalty - dominant_penalty)


def score_weight_balance(placement: list[dict]) -> float:
    row_weights = [0.0] * GRID_ROWS
    left_weight = 0.0
    right_weight = 0.0

    for item in placement:
        weight = item["tile"].get("visual_weight", 0.0)
        row_weights[item["row"]] += weight
        if item["col"] < GRID_COLS / 2:
            left_weight += weight
        else:
            right_weight += weight

    max_row = max(row_weights)
    min_row = min(row_weights)
    row_ratio = min_row / max_row if max_row > 0 else 1.0

    side_ratio = min(left_weight, right_weight) / max(left_weight, right_weight) if max(left_weight, right_weight) > 0 else 1.0
    return clamp01((row_ratio / 0.65 + side_ratio / 0.65) / 2)


def transition_signature(values: list[str]) -> tuple[int, ...]:
    return tuple(int(values[index] != values[index + 1]) for index in range(len(values) - 1))


def signature_similarity(left: tuple[int, ...], right: tuple[int, ...]) -> float:
    if not left or not right:
        return 1.0
    matches = sum(1 for a, b in zip(left, right) if a == b)
    return matches / min(len(left), len(right))


def score_symmetry(cells: list[CellAssignment], placement: list[dict], template: str) -> float:
    placement_map = {(item["row"], item["col"]): item for item in placement}
    cell_map = {(cell.row, cell.col): cell for cell in cells}
    pair_scores = []
    column_intensity = [0.0] * GRID_COLS

    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            item = placement_map[(row, col)]
            cell = cell_map[(row, col)]
            column_intensity[col] += item["tile"].get("visual_weight", 0.0) * COLOR_IMPACT.get(cell.fg_name, 0.5)

    for row in range(GRID_ROWS):
        for col in range(GRID_COLS // 2):
            left_pos = (row, col)
            right_pos = (row, GRID_COLS - 1 - col)
            left_item = placement_map[left_pos]
            right_item = placement_map[right_pos]
            left_cell = cell_map[left_pos]
            right_cell = cell_map[right_pos]

            pair_score = 0.0
            if left_item["tile"]["id"] == right_item["tile"]["id"]:
                pair_score += 0.45
            elif left_item["tile"].get("shape_family") == right_item["tile"].get("shape_family"):
                pair_score += 0.26

            pair_score += max(
                0.0,
                0.22 - abs(left_item["tile"].get("visual_weight", 0.0) - right_item["tile"].get("visual_weight", 0.0)) * 10.0,
            )

            if left_cell.fg_name == right_cell.fg_name:
                pair_score += 0.18
            elif color_temperature(left_cell.fg_name) == color_temperature(right_cell.fg_name):
                pair_score += 0.08

            if left_cell.bg_name == right_cell.bg_name:
                pair_score += 0.15
            elif color_temperature(left_cell.bg_name) == color_temperature(right_cell.bg_name):
                pair_score += 0.06

            pair_scores.append(clamp01(pair_score))

    mirror_balance = []
    for col in range(GRID_COLS // 2):
        left_value = column_intensity[col]
        right_value = column_intensity[GRID_COLS - 1 - col]
        mirror_balance.append(1.0 - abs(left_value - right_value) / max(left_value, right_value, 0.001))

    pair_score = sum(pair_scores) / max(1, len(pair_scores))
    balance_score = sum(mirror_balance) / max(1, len(mirror_balance))
    pair_weight = 0.7 if template in MIRROR_TEMPLATES else 0.58
    return clamp01(pair_weight * pair_score + (1.0 - pair_weight) * balance_score)


def score_rhythm(cells: list[CellAssignment], placement: list[dict], template: str) -> float:
    placement_map = {(item["row"], item["col"]): item for item in placement}
    cell_map = {(cell.row, cell.col): cell for cell in cells}
    target_changes = {
        "mirror": 2.0,
        "symmetric": 2.0,
        "flow": 2.6,
        "river": 2.4,
        "spiral": 3.0,
        "pinwheel": 3.2,
        "checkerboard": 4.0,
        "gradient": 3.4,
        "focal": 3.0,
        "scatter": 4.2,
    }.get(template, 3.0)

    change_scores = []
    repeat_scores = []
    signatures = []

    for row in range(GRID_ROWS):
        families = [placement_map[(row, col)]["tile"].get("shape_family", "") for col in range(GRID_COLS)]
        fg_names = [cell_map[(row, col)].fg_name for col in range(GRID_COLS)]
        bg_names = [cell_map[(row, col)].bg_name for col in range(GRID_COLS)]

        family_changes = sum(1 for index in range(GRID_COLS - 1) if families[index] != families[index + 1])
        fg_changes = sum(1 for index in range(GRID_COLS - 1) if fg_names[index] != fg_names[index + 1])
        bg_changes = sum(1 for index in range(GRID_COLS - 1) if bg_names[index] != bg_names[index + 1])
        weighted_changes = (1.2 * family_changes + fg_changes + 0.7 * bg_changes) / 2.9
        change_scores.append(clamp01(1.0 - abs(weighted_changes - target_changes) / max(1.0, target_changes)))

        two_step_family = sum(1 for index in range(GRID_COLS - 2) if families[index] == families[index + 2]) / max(1, GRID_COLS - 2)
        two_step_color = sum(1 for index in range(GRID_COLS - 2) if fg_names[index] == fg_names[index + 2]) / max(1, GRID_COLS - 2)
        repeat_scores.append(0.65 * two_step_family + 0.35 * two_step_color)
        signatures.append((transition_signature(families), transition_signature(fg_names)))

    signature_scores = []
    for index in range(len(signatures)):
        for other_index in range(index + 1, len(signatures)):
            family_similarity = signature_similarity(signatures[index][0], signatures[other_index][0])
            color_similarity = signature_similarity(signatures[index][1], signatures[other_index][1])
            signature_scores.append(0.6 * family_similarity + 0.4 * color_similarity)

    return clamp01(
        0.45 * (sum(change_scores) / max(1, len(change_scores)))
        + 0.30 * (sum(repeat_scores) / max(1, len(repeat_scores)))
        + 0.25 * (sum(signature_scores) / max(1, len(signature_scores)))
    )


def score_background_discipline(cells: list[CellAssignment], template: str) -> float:
    grid = {(cell.row, cell.col): cell for cell in cells}
    counts = Counter(cell.bg_name for cell in cells)
    unique_count = len(counts)
    ideal_unique = 3 if template in MIRROR_TEMPLATES | {"flow", "river"} else 4
    unique_score = 1.0 if unique_count <= ideal_unique else clamp01(1.0 - (unique_count - ideal_unique) * 0.3)

    row_change_target = 1.0 if template in MIRROR_TEMPLATES else 1.8 if template in {"flow", "river"} else 2.6
    row_scores = []
    for row in range(GRID_ROWS):
        backgrounds = [grid[(row, col)].bg_name for col in range(GRID_COLS)]
        changes = sum(1 for index in range(GRID_COLS - 1) if backgrounds[index] != backgrounds[index + 1])
        row_scores.append(clamp01(1.0 - abs(changes - row_change_target) / max(1.0, row_change_target)))

    mirror_scores = []
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS // 2):
            left = grid[(row, col)].bg_name
            right = grid[(row, GRID_COLS - 1 - col)].bg_name
            if left == right:
                mirror_scores.append(1.0)
            elif color_temperature(left) == color_temperature(right):
                mirror_scores.append(0.55)
            else:
                mirror_scores.append(0.0)

    return clamp01(
        0.35 * unique_score
        + 0.35 * (sum(row_scores) / max(1, len(row_scores)))
        + 0.30 * (sum(mirror_scores) / max(1, len(mirror_scores)))
    )


def score_continuity(placement: list[dict], continuity_pairs: list[tuple[tuple[int, int], tuple[int, int]]]) -> float:
    possible = matched_edge_candidates(placement, "flow", random.Random(0))
    if not possible:
        return 0.5

    possible_target = max(1, min(7, round(len(possible) * 0.35)))
    count_score = 1.0 - abs(len(continuity_pairs) - possible_target) / max(1, possible_target)

    pair_lookup = {pair_key(a, b) for a, b in continuity_pairs}
    grid = {(item["row"], item["col"]): item for item in placement}
    selected_coverages = []
    for a, b in pair_lookup:
        if a[0] == b[0]:
            left, right = (a, b) if a[1] < b[1] else (b, a)
            selected_coverages.append((grid[left]["coverage"]["right"] + grid[right]["coverage"]["left"]) / 2)
        else:
            top, bottom = (a, b) if a[0] < b[0] else (b, a)
            selected_coverages.append((grid[top]["coverage"]["bottom"] + grid[bottom]["coverage"]["top"]) / 2)

    coverage_score = sum(selected_coverages) / max(1, len(selected_coverages)) if selected_coverages else 0.0
    return clamp01(0.55 * count_score + 0.45 * coverage_score)


def score_color_adjacency(
    cells: list[CellAssignment],
    continuity_pairs: list[tuple[tuple[int, int], tuple[int, int]]],
) -> float:
    grid = {(cell.row, cell.col): cell for cell in cells}
    continuity_lookup = {pair_key(a, b) for a, b in continuity_pairs}
    raw = 0.0
    pair_count = 0

    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            current = grid[(row, col)]
            for neighbor in ((row, col + 1), (row + 1, col)):
                nr, nc = neighbor
                if nr >= GRID_ROWS or nc >= GRID_COLS:
                    continue
                other = grid[neighbor]
                pair_count += 1
                if current.fg_name == other.fg_name:
                    if pair_key((row, col), neighbor) in continuity_lookup:
                        raw += 0.9
                    else:
                        raw -= 1.4
                else:
                    raw += 0.4
                    if color_temperature(current.fg_name) != color_temperature(other.fg_name):
                        raw += 0.08
                    if current.bg_name != other.bg_name:
                        raw += 0.12

    min_raw = -1.4 * pair_count
    max_raw = 0.6 * pair_count
    return clamp01((raw - min_raw) / (max_raw - min_raw)) if pair_count else 1.0


def score_anchor_distribution(cells: list[CellAssignment], placement: list[dict]) -> float:
    placement_map = {(item["row"], item["col"]): item for item in placement}
    ranked = []
    for cell in cells:
        tile = placement_map[(cell.row, cell.col)]["tile"]
        intensity = tile.get("visual_weight", 0.0) * COLOR_IMPACT.get(cell.fg_name, 0.5)
        ranked.append(((cell.row, cell.col), intensity))

    top = [pos for pos, _ in sorted(ranked, key=lambda item: item[1], reverse=True)[:3]]
    third_count = len({min(2, col // 2) for _, col in top})
    row_count = len({row for row, _ in top})
    power_hits = sum(1 for pos in top if pos in POWER_POSITIONS)
    return clamp01(0.45 * (third_count / 3) + 0.30 * (row_count / 3) + 0.25 * (power_hits / 3))


def score_target_fit(cells: list[CellAssignment], target_counts: dict[str, int]) -> float:
    used = Counter(cell.fg_name for cell in cells)
    delta = sum(abs(used[color] - target_counts.get(color, 0)) for color in target_counts)
    return clamp01(1.0 - delta / (TOTAL_SLOTS * 1.6))


def score_energy_adherence(
    cells: list[CellAssignment],
    energy: str,
    color_bias: Optional[str] = None,
) -> float:
    counts = Counter(cell.fg_name for cell in cells)
    unique_colors = len(counts)
    orange = counts.get("international_orange", 0)

    if energy == "low":
        dominant = max(counts.values())
        excluded = 0
        for accent_color in ("chrome_yellow", "celestial_blue"):
            if accent_color != color_bias:
                excluded += counts.get(accent_color, 0)
        score = 1.0
        if unique_colors > 3:
            score -= 0.35
        if dominant < 12:
            score -= 0.35
        if color_bias == "international_orange":
            if not 4 <= orange <= 6:
                score -= 0.2
        elif color_bias in {"celestial_blue", "chrome_yellow"}:
            if orange > 1:
                score -= 0.2
        elif orange not in (1, 2):
            score -= 0.2
        if excluded:
            score -= 0.3
        return clamp01(score)

    if energy == "medium":
        score = 1.0
        if not 4 <= unique_colors <= 5:
            score -= 0.35
        if not 2 <= orange <= 4:
            score -= 0.25
        if max(counts.values()) > 6:
            score -= 0.25
        return clamp01(score)

    score = 1.0
    if not 6 <= unique_colors <= 7:
        score -= 0.35
    if not 3 <= orange <= 5:
        score -= 0.2
    if counts.get("celestial_blue", 0) == 0 or counts.get("chrome_yellow", 0) == 0:
        score -= 0.3
    return clamp01(score)


def score_color_bias_expression(
    cells: list[CellAssignment],
    target_counts: dict[str, int],
    color_bias: Optional[str],
) -> float:
    if not color_bias:
        return 1.0

    bias_cells = [cell for cell in cells if cell.fg_name == color_bias]
    if not bias_cells:
        return 0.0

    target = max(1, target_counts.get(color_bias, 0))
    count_score = clamp01(1.0 - abs(len(bias_cells) - target) / target)
    power_hits = sum(1 for cell in bias_cells if (cell.row, cell.col) in POWER_POSITIONS)
    power_score = clamp01(power_hits / max(1, min(2, len(bias_cells))))
    row_spread = len({cell.row for cell in bias_cells}) / min(GRID_ROWS, len(bias_cells))
    col_spread = len({cell.col for cell in bias_cells}) / min(GRID_COLS, len(bias_cells))
    spread_score = 0.45 * row_spread + 0.55 * col_spread
    return clamp01(0.55 * count_score + 0.2 * power_score + 0.25 * spread_score)


def score_candidate_banner(
    cells: list[CellAssignment],
    placement: list[dict],
    continuity_pairs: list[tuple[tuple[int, int], tuple[int, int]]],
    target_counts: dict[str, int],
    template: str,
    energy: str,
    symmetry_strength: float,
    rhythm_strength: float,
    color_bias: Optional[str] = None,
) -> tuple[float, dict[str, float]]:
    breakdown = {
        "color_adjacency": score_color_adjacency(cells, continuity_pairs),
        "continuity": score_continuity(placement, continuity_pairs),
        "repetition": score_repetition(placement, template),
        "weight_balance": score_weight_balance(placement),
        "rotation": score_rotation_pattern(placement, template),
        "anchors": score_anchor_distribution(cells, placement),
        "target_fit": score_target_fit(cells, target_counts),
        "energy": score_energy_adherence(cells, energy, color_bias=color_bias),
        "symmetry": score_symmetry(cells, placement, template),
        "rhythm": score_rhythm(cells, placement, template),
        "background_discipline": score_background_discipline(cells, template),
    }
    if color_bias:
        breakdown["color_bias"] = score_color_bias_expression(cells, target_counts, color_bias)

    weights = {
        "color_adjacency": 0.11,
        "continuity": 0.12,
        "repetition": 0.11,
        "weight_balance": 0.10,
        "rotation": 0.08,
        "anchors": 0.07,
        "target_fit": 0.06,
        "energy": 0.05,
        "background_discipline": 0.10,
        "symmetry": 0.11 + 0.09 * symmetry_strength,
        "rhythm": 0.09 + 0.08 * rhythm_strength,
    }
    if color_bias:
        weights["color_bias"] = 0.09
    total_weight = sum(weights.values())
    score = sum((weights[key] / total_weight) * breakdown[key] for key in weights)
    return score, breakdown


# - SVG assembly ------------------------------------------------------------
def parse_tile_svg(path: Path) -> etree._Element:
    return etree.parse(str(path), etree.XMLParser(remove_comments=True)).getroot()


def assemble_banner_svg(
    cells: list[CellAssignment],
    tiles_dir: Path,
    dimensions: tuple[int, int],
) -> etree._Element:
    banner_w, banner_h = dimensions
    root = etree.Element(
        "svg",
        attrib={
            "xmlns": SVG_NS,
            "version": "1.1",
            "width": str(banner_w),
            "height": str(banner_h),
            "viewBox": f"0 0 {banner_w} {banner_h}",
        },
    )

    tile_cache: dict[str, Optional[etree._Element]] = {}
    for cell in sorted(cells, key=lambda item: item.row * GRID_COLS + item.col):
        x = cell.col * CELL_W
        y = cell.row * CELL_H

        etree.SubElement(
            root,
            "rect",
            attrib={
                "x": str(x),
                "y": str(y),
                "width": str(CELL_W),
                "height": str(CELL_H),
                "fill": cell.bg_color,
            },
        )

        if cell.tile_filename not in tile_cache:
            try:
                tile_cache[cell.tile_filename] = parse_tile_svg(tiles_dir / cell.tile_filename)
            except Exception:
                tile_cache[cell.tile_filename] = None

        tile_root = tile_cache[cell.tile_filename]
        if tile_root is None:
            continue

        path_elem = tile_root.find(f"{{{SVG_NS}}}path")
        if path_elem is None:
            continue

        transform = f"translate({x},{y}) scale({CELL_SCALE})"
        if cell.rotation:
            transform += f" rotate({cell.rotation},100,100)"
        group = etree.SubElement(root, "g", attrib={"transform": transform})

        attrib = dict(path_elem.attrib)
        attrib["fill"] = cell.fg_color
        etree.SubElement(group, "path", attrib=attrib)

    return root


# - Candidate generation ----------------------------------------------------
def generate_candidate(
    manifest: dict,
    energy: str,
    continuity_strength: float,
    symmetry_strength: float,
    rhythm_strength: float,
    color_bias: Optional[str],
    template_override: Optional[str],
    rng: random.Random,
    primary_families_override: Optional[list[str]] = None,
    accent_families_override: Optional[list[str]] = None,
    tile_ids_override: Optional[list[str]] = None,
    restrict_colors: Optional[list[str]] = None,
) -> CandidateBanner:
    template = choose_template(energy, rng, template_override)
    tiles = manifest["tiles"]

    primary_families, accent_families = resolve_family_focus(
        tiles,
        template,
        rng,
        primary_override=primary_families_override,
        accent_override=accent_families_override,
        tile_ids_override=tile_ids_override,
    )
    tile_palette = resolve_tile_palette(
        tiles,
        template,
        primary_families,
        accent_families,
        rng,
        tile_ids_override=tile_ids_override,
    )
    rotated_pool = build_rotated_pool(tile_palette)
    placement = scored_tile_placement(rotated_pool, template, primary_families, accent_families, rng)

    continuity_pairs = build_continuity_pairs(placement, template, continuity_strength, rng)
    groups, pos_to_group = build_continuity_groups(continuity_pairs)
    adjacency = build_group_adjacency(pos_to_group)

    target_counts = build_color_targets(energy, rng, color_bias, restrict_colors=restrict_colors)
    group_colors = assign_group_colors(groups, adjacency, target_counts, template, energy, rng, color_bias=color_bias)

    fg_by_pos = {}
    for pos, group_id in pos_to_group.items():
        fg_by_pos[pos] = group_colors[group_id]
    backgrounds = assign_backgrounds(fg_by_pos, template, rng, restrict_colors=restrict_colors)

    placement_map = {(item["row"], item["col"]): item for item in placement}
    cells = []
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            item = placement_map[(row, col)]
            fg_name = fg_by_pos[(row, col)]
            bg_name = backgrounds[(row, col)]
            cells.append(
                CellAssignment(
                    col=col,
                    row=row,
                    tile_id=item["tile"]["id"],
                    tile_filename=item["tile"]["filename"],
                    rotation=item["rotation"],
                    fg_color=COLOR_TOKEN_TO_HEX[fg_name],
                    bg_color=COLOR_TOKEN_TO_HEX[bg_name],
                    fg_name=fg_name,
                    bg_name=bg_name,
                )
            )

    score, score_breakdown = score_candidate_banner(
        cells,
        placement,
        continuity_pairs,
        target_counts,
        template,
        energy,
        symmetry_strength,
        rhythm_strength,
        color_bias=color_bias,
    )

    return CandidateBanner(
        template=template,
        primary_families=primary_families,
        accent_families=accent_families,
        placement=placement,
        continuity_pairs=continuity_pairs,
        cells=cells,
        score=score,
        score_breakdown=score_breakdown,
    )


# - Public API --------------------------------------------------------------
def generate_banner(
    manifest_path: Path = DEFAULT_MANIFEST,
    tiles_dir: Path = DEFAULT_TILES_DIR,
    energy: str = "medium",
    seed: Optional[int] = None,
    dimensions: tuple[int, int] = (1920, 960),
    color_bias: Optional[str] = None,
    topic_description: Optional[str] = None,
    continuity_strength: float = 0.7,
    symmetry_strength: float = 0.85,
    rhythm_strength: float = 0.75,
    template: Optional[str] = None,
    candidate_count: int = 24,
    primary_families: Optional[list[str]] = None,
    accent_families: Optional[list[str]] = None,
    tile_ids: Optional[list[str]] = None,
    request: Optional[BannerRequest] = None,
) -> tuple[BannerResult, etree._Element]:
    if request is None:
        request = BannerRequest(
            energy=energy,
            seed=seed,
            dimensions=dimensions,
            color_bias=color_bias,
            topic_description=topic_description,
            continuity_strength=continuity_strength,
            symmetry_strength=symmetry_strength,
            rhythm_strength=rhythm_strength,
            template=template,
            candidate_count=candidate_count,
            primary_families=primary_families or [],
            accent_families=accent_families or [],
            tile_ids=tile_ids or [],
        ).normalized()
    else:
        request = request.normalized()

    manifest = load_manifest(manifest_path)
    validate_request(manifest, request)

    if request.seed is None:
        request = replace(request, seed=random.randint(0, 2**31 - 1))
    master_rng = random.Random(request.seed)

    best_candidate = None
    for _ in range(request.candidate_count):
        candidate_rng = random.Random(master_rng.randint(0, 2**31 - 1))
        candidate = generate_candidate(
            manifest=manifest,
            energy=request.energy,
            continuity_strength=request.continuity_strength,
            symmetry_strength=request.symmetry_strength,
            rhythm_strength=request.rhythm_strength,
            color_bias=request.color_bias,
            template_override=request.template,
            rng=candidate_rng,
            primary_families_override=request.primary_families,
            accent_families_override=request.accent_families,
            tile_ids_override=request.tile_ids,
            restrict_colors=request.restrict_colors,
        )
        if best_candidate is None or candidate.score > best_candidate.score:
            best_candidate = candidate

    assert best_candidate is not None
    rotation_pattern = TEMPLATE_CONFIG[best_candidate.template]["rotation"]
    banner_root = assemble_banner_svg(best_candidate.cells, tiles_dir, request.dimensions)

    result = BannerResult(
        output_path=None,
        seed=request.seed,
        energy=request.energy,
        template=best_candidate.template,
        primary_families=best_candidate.primary_families,
        accent_families=best_candidate.accent_families,
        rotation_pattern=rotation_pattern,
        continuity_strength=request.continuity_strength,
        symmetry_strength=request.symmetry_strength,
        rhythm_strength=request.rhythm_strength,
        candidate_count=request.candidate_count,
        dimensions=request.dimensions,
        color_bias=request.color_bias,
        score=best_candidate.score,
        score_breakdown=best_candidate.score_breakdown,
        cells=[asdict(cell) for cell in best_candidate.cells],
        request=request_payload(request),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
    return result, banner_root


def generate_batch(
    n: int = 20,
    manifest_path: Path = DEFAULT_MANIFEST,
    tiles_dir: Path = DEFAULT_TILES_DIR,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    energy_mix: Optional[dict] = None,
    dimensions: tuple[int, int] = (1920, 960),
    starting_seed: Optional[int] = None,
    continuity_strength: float = 0.7,
    symmetry_strength: float = 0.85,
    rhythm_strength: float = 0.75,
    template: Optional[str] = None,
    candidate_count: int = 24,
) -> list[BannerResult]:
    if energy_mix is None:
        energy_mix = {"low": 0.3, "medium": 0.5, "high": 0.2}

    output_dir.mkdir(parents=True, exist_ok=True)

    allocations = []
    for energy_level, fraction in energy_mix.items():
        allocations.extend([energy_level] * round(n * fraction))
    while len(allocations) < n:
        allocations.append("medium")
    allocations = allocations[:n]
    random.Random(starting_seed or 0).shuffle(allocations)

    results = []
    for index, energy_level in enumerate(allocations):
        seed = (starting_seed or 1000) + index
        result, banner_root = generate_banner(
            request=BannerRequest(
                energy=energy_level,
                seed=seed,
                dimensions=dimensions,
                continuity_strength=continuity_strength,
                symmetry_strength=symmetry_strength,
                rhythm_strength=rhythm_strength,
                template=template,
                candidate_count=candidate_count,
            ),
            manifest_path=manifest_path,
            tiles_dir=tiles_dir,
        )

        filename = f"banner-{index + 1:03d}-{energy_level}-{result.template}-s{seed}"
        svg_path = output_dir / f"{filename}.svg"
        write_banner_artifacts(result, banner_root, svg_path)

        results.append(result)
        if (index + 1) % 10 == 0 or (index + 1) == n:
            print(f"  Generated {index + 1}/{n}")

    return results


# - CLI ---------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="FAI Banner Generator")
    parser.add_argument("--energy", choices=["low", "medium", "high"], default=None)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--dimensions", type=int, nargs=2, default=None)
    parser.add_argument("--color-bias", type=str, default=None)
    parser.add_argument("--topic-description", type=str, default=None)
    parser.add_argument("--output", type=str, default=None)
    parser.add_argument("--name", type=str, default=None, help="Optional label stored in the request metadata and appended to the filename")
    parser.add_argument("--template", choices=TEMPLATES, default=None)
    parser.add_argument("--continuity-strength", type=float, default=None)
    parser.add_argument("--symmetry-strength", type=float, default=None)
    parser.add_argument("--rhythm-strength", type=float, default=None)
    parser.add_argument("--candidate-count", type=int, default=None)
    parser.add_argument("--primary-family", action="append", dest="primary_families", default=None)
    parser.add_argument("--accent-family", action="append", dest="accent_families", default=None)
    parser.add_argument("--tile-id", action="append", dest="tile_ids", default=None)
    parser.add_argument("--spec", type=Path, default=None, help="JSON file with single-banner parameter overrides")
    parser.add_argument("--write-spec-template", type=Path, default=None, help="Write an example single-banner request JSON and exit")
    parser.add_argument("--print-request", action="store_true", help="Print the resolved single-banner request before generating")
    parser.add_argument("--list-options", action="store_true", help="Print templates, colors, families, and example tile ids")

    parser.add_argument("--batch", type=int, default=None)
    parser.add_argument("--energy-mix", type=str, default=None)
    parser.add_argument("--starting-seed", type=int, default=None)

    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--tiles-dir", type=Path, default=DEFAULT_TILES_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)

    args = parser.parse_args()

    if args.write_spec_template:
        args.write_spec_template.parent.mkdir(parents=True, exist_ok=True)
        with open(args.write_spec_template, "w") as handle:
            json.dump(request_template(), handle, indent=2)
        print(f"Spec template written to: {args.write_spec_template}")
        return

    manifest = load_manifest(args.manifest)

    if args.list_options:
        print_generator_options(manifest)
        return

    if args.batch and args.spec:
        parser.error("--spec is only supported for single-banner generation")
    if args.batch and args.name:
        parser.error("--name is only supported for single-banner generation")

    if args.batch:
        try:
            energy_mix = json.loads(args.energy_mix) if args.energy_mix else None
        except json.JSONDecodeError as exc:
            parser.error(f"Invalid --energy-mix JSON: {exc}")
        dimensions = normalize_dimensions(args.dimensions or [1920, 960])
        continuity_strength = 0.7 if args.continuity_strength is None else float(args.continuity_strength)
        symmetry_strength = 0.85 if args.symmetry_strength is None else float(args.symmetry_strength)
        rhythm_strength = 0.75 if args.rhythm_strength is None else float(args.rhythm_strength)
        candidate_count = 24 if args.candidate_count is None else int(args.candidate_count)
        print(f"Generating {args.batch} banners...")
        results = generate_batch(
            n=args.batch,
            manifest_path=args.manifest,
            tiles_dir=args.tiles_dir,
            output_dir=args.output_dir,
            energy_mix=energy_mix,
            dimensions=dimensions,
            starting_seed=args.starting_seed,
            continuity_strength=continuity_strength,
            symmetry_strength=symmetry_strength,
            rhythm_strength=rhythm_strength,
            template=args.template,
            candidate_count=candidate_count,
        )
        print(f"\nBatch complete -> {args.output_dir}")
        template_counts = Counter(result.template for result in results)
        family_counts = Counter(family for result in results for family in result.primary_families)
        for template_name, count in sorted(template_counts.items(), key=lambda item: (-item[1], item[0])):
            print(f"  {template_name}: {count}")
        print("Primary families:", dict(sorted(family_counts.items(), key=lambda item: (-item[1], item[0]))[:8]))
        return

    try:
        spec_data = load_request_spec(args.spec)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        parser.error(str(exc))

    request = build_banner_request(
        energy=args.energy,
        seed=args.seed,
        dimensions=args.dimensions,
        color_bias=args.color_bias,
        topic_description=args.topic_description,
        continuity_strength=args.continuity_strength,
        symmetry_strength=args.symmetry_strength,
        rhythm_strength=args.rhythm_strength,
        template=args.template,
        candidate_count=args.candidate_count,
        primary_families=args.primary_families,
        accent_families=args.accent_families,
        tile_ids=args.tile_ids,
        name=args.name,
        spec_data=spec_data,
    )
    try:
        validate_request(manifest, request)
    except ValueError as exc:
        parser.error(str(exc))

    if args.print_request:
        print(json.dumps(request_payload(request), indent=2))

    print(f"Generating banner (energy={request.energy}, seed={request.seed})...")
    result, banner_root = generate_banner(
        request=request,
        manifest_path=args.manifest,
        tiles_dir=args.tiles_dir,
    )

    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    svg_path = Path(args.output) if args.output else default_single_output_path(output_dir, request, result)
    write_banner_artifacts(result, banner_root, svg_path)

    print(f"Banner:    {svg_path}")
    if result.request["name"]:
        print(f"Label:     {result.request['name']}")
    print(f"Template:  {result.template}  ({result.rotation_pattern} rotation)")
    print(f"Families:  primary={result.primary_families}  accent={result.accent_families}")
    print(f"Seed:      {result.seed}")
    print(f"Score:     {result.score:.3f}")
    if result.request["tile_ids"]:
        print(f"Tiles:     {result.request['tile_ids']}")
    rotation_counts = Counter(cell["rotation"] for cell in result.cells)
    print(f"Rotations: {dict(sorted(rotation_counts.items()))}")
    fg_counts = Counter(cell["fg_name"] for cell in result.cells)
    print("Fg colors:", dict(sorted(fg_counts.items(), key=lambda item: (-item[1], item[0]))))


if __name__ == "__main__":
    main()
