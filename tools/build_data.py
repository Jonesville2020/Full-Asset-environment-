"""Convert the source CSV and floor-plan PDF into the files the web app loads.

Usage (needs PyMuPDF):  pip install pymupdf && python tools/build_data.py

Writes:
  data/assets.json    simplified asset list (tag, type, assigned to)
  data/floorplan.json editable map labels with positions
  data/floorplan.svg  vector floor plan with all text removed
"""
import csv
import json
import math
import re
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data"

TYPE_OVERRIDES = {
    "Desktop All-In-One": "Desktop",
    "Desktop Computer": "Desktop",
    "Wireless router": "Router",
    "Remote flip phone": "Phone",
    "Emergency Radio": "Radio",
}
TYPE_BY_MODEL = {
    "OptiPlex 7420 (AIO)": "Desktop",
    "Mobile Precision Workstation": "Laptop",
    "HP LaserJet Pro 4001dn": "Printer",
    "Samsung Galaxy S10+ 5G": "Phone",
    "Samsung Galaxy Tab S9+": "Tablet",
    "OpticBook Flatbed Scanner": "Scanner",
    "Surface Pro": "Tablet",
    "Dell Pro Thunderbolt 5 Dock WD25TB5": "Dock",
}
STORAGE_LOCATION = re.compile(r"^(tech storage|surplus)", re.I)


def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


def build_assets():
    csv_path = sorted(ROOT.glob("Assets_*.csv"))[-1]
    with open(csv_path, newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))

    assets = []
    for index, row in enumerate(rows, 1):
        model = clean(row["Asset Type"])
        kind = clean(row["Category Name"]) or TYPE_BY_MODEL.get(model, model)
        kind = TYPE_OVERRIDES.get(kind, kind)
        assignee = clean(row["Assignee"])
        location = clean(row["Location"])
        if assignee.lower() == "tech storage" or (
            not assignee and STORAGE_LOCATION.match(location)
        ):
            assignee = "Storage"
        elif assignee.lower() == "vacant vacant":
            assignee = ""
        assets.append(
            {
                "id": f"a{index}",
                "tag": clean(row["Asset Tag"]),
                "type": kind,
                "assignee": assignee,
                "model": model,
                "serial": clean(row["Serial Number"]),
                "location": location,
            }
        )
    return assets


RED = {0xE52136, 0xFF0000}
PRINTER_COLORS = {0x69D929, 0x6AD928, 0x40AA55}
LEGEND = {
    "LEGEND", "Staff / Computers", "Conference Rooms", "Printers",
    "Q-Matic Kiosk", "Access Points", "Data Closets", "Network Ports",
    "Time Clocks (TC)",
}


def classify(text, color, size):
    if text in LEGEND and size >= 12:
        return "legend"
    if color in RED:
        if re.match(r"vacant\b", text, re.I):
            return "vacant"
        if re.match(r"(#\d+$|BP-\d+|Cub\.?\s*[\d-]+|Cubicle)", text, re.I):
            return "seat"
        return "person"
    if color in PRINTER_COLORS or re.match(r"(BD|DS)[A-Z0-9]+( - .*)?$", text):
        return "printer"
    if color == 0x80FF:
        return "ap"
    if color == 0x3CB8:
        return "kiosk"
    if color == 0xFF00FF:
        return "clock"
    if color in {0xFF, 0xAF50, 0xAA00, 0x6F2F9F, 0xAA4000}:
        return "label"
    return "room"


def extract_lines(page):
    matrix = page.rotation_matrix
    items = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            raw = "".join(span["text"] for span in line["spans"])
            text = raw.strip()
            if not text:
                continue
            span = line["spans"][0]
            rect = fitz.Rect(line["bbox"]) * matrix
            dx, dy = line["dir"]
            ex = dx * matrix.a + dy * matrix.c
            ey = dx * matrix.b + dy * matrix.d
            angle = round(math.degrees(math.atan2(ey, ex)) / 90) * 90
            items.append(
                {
                    "k": classify(text, span["color"], span["size"]),
                    "t": re.sub(r"\s+", " ", text),
                    "x": round((rect.x0 + rect.x1) / 2, 1),
                    "y": round((rect.y0 + rect.y1) / 2, 1),
                    "s": round(span["size"], 1),
                    "r": int(angle) % 360,
                    "wrap": raw.endswith(" ") and " " not in text,
                }
            )
    return items


def merge_wrapped_names(items):
    """Join first/last names that the PDF split across two stacked lines."""
    people = [i for i in items if i["k"] == "person"]
    used = set()
    for first in people:
        if not first["wrap"] or id(first) in used:
            continue
        best = None
        for other in people:
            if other is first or id(other) in used or " " in other["t"]:
                continue
            if abs(other["x"] - first["x"]) < 8 and 0 < other["y"] - first["y"] < 8:
                if best is None or other["y"] < best["y"]:
                    best = other
        if best:
            first["t"] = f"{first['t']} {best['t']}"
            used.add(id(best))
    return [i for i in items if id(i) not in used]


def add_floorplan_metadata(plan):
    # The PDF's numbered external table corresponds to BP-01 through BP-26.
    for item in plan["items"]:
        match = re.fullmatch(r".+?\s+(0[1-9]|1\d|2[0-6])", item["t"])
        if (match and item["k"] in {"person", "vacant"}
                and item["x"] < 130 and 280 < item["y"] < 510 and not item["loc"]):
            item["loc"] = f"BP-{match.group(1)}"

    # These notes are rasterized in the PDF, not extractable PDF text. The
    # original is the authority for the two portions marked unclear.
    groups = [
        (221, 200, [69, 89, 109, 129, 149, 169, 189], [
            "NEW BOILER", "LOCATION - SEE", "MECHANICAL DWGS.", "EXTEND",
            "HOUSEKEEPING PAD -", "SEE STRUCTURAL &", "MECHANICAL DWGS.",
        ]),
        (315, 120, [220, 237], ["(E) CENTRAL", "PLANT"]),
        (347, 120, [256, 273], ["(E) CENTRAL", "PLANT"]),
        (573, 155, [247, 267, 287], ["EXISTING", "HOUSEKEEPING", "PAD"]),
        (682, 92, [317, 335], ["SERVICE", "COURT"]),
        (217, 300, [387, 408, 428], [
            "CHILLER - SEE MECH.", '4" THICK HOUSEKEEPING PAD -', "SEE STRUCT.",
        ]),
        (557, 218, [528, 548, 568, 596, 616, 636, 656, 676, 696], [
            "COOLING TOWER SEE", "ARCH. SITE PLAN AND", "MECHANICAL DWGS.",
            "STEEL TUBE (WIDTH ?)", "AND METAL GRATE",
            "ELEVATED WALKWAYS", "ON ALL SIDES OF", "COOLING TOWER TYP.",
            "SEE DETAIL [UNCLEAR]",
        ]),
        (434, 82, [73], ["CUSTODIAN"]),
        (40, 100, [616, 633], ["FIRE", "RISER"]),
        (261, 96, [563, 580], ["EMER.", "ELEC."]),
        (462, 56, [568], ["ELEC."]),
    ]
    masks = []
    for group_index, (left, width, tops, lines) in enumerate(groups, 1):
        for line_index, (top, text) in enumerate(zip(tops, lines), 1):
            x = 384 + (left - 2) / 6
            y = 298 + (top - 2) / 6
            w, h = (width + 4) / 6, 19 / 6
            masks.append({"x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2)})
            plan["items"].append({
                "id": f"note-{group_index}-{line_index}", "k": "note", "t": text,
                "x": round(x + w / 2, 1), "y": round(y + h / 2, 1),
                "s": 3.4, "r": 0, "loc": "",
            })
    plan["noteMasks"] = masks
    return plan


def build_floorplan():
    page = fitz.open(next(ROOT.glob("Floor-Plan*.pdf")))[0]
    svg = page.get_svg_image(text_as_path=False)
    svg = re.sub(r"<text\b.*?</text>", "", svg, flags=re.S)
    (OUT / "floorplan.svg").write_text(svg, encoding="utf-8")

    items = merge_wrapped_names(extract_lines(page))
    items.sort(key=lambda i: (i["y"], i["x"]))
    for number, item in enumerate(items, 1):
        item.pop("wrap", None)
        item["id"] = f"m{number}"
        item["loc"] = ""
    return add_floorplan_metadata({"width": page.rect.width, "height": page.rect.height, "items": items})


def main():
    OUT.mkdir(exist_ok=True)
    assets = build_assets()
    plan = build_floorplan()
    (OUT / "assets.json").write_text(json.dumps(assets, separators=(",", ":")))
    (OUT / "floorplan.json").write_text(json.dumps(plan, separators=(",", ":")))
    print(f"{len(assets)} assets, {len(plan['items'])} map labels")


if __name__ == "__main__":
    main()
