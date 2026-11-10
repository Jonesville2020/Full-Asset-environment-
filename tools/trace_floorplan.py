"""Trace the generated floor-plan image into editable SVG path fragments.

Requires PyMuPDF, NumPy and opencv-python-headless. Run after build_data.py.
The trace is approximate and must be checked against the original plan.
"""
import json
from pathlib import Path

import cv2
import numpy as np
import pymupdf

ROOT = Path(__file__).resolve().parent.parent
SCALE = 3
TILE = 144


def path_for(contour, x, y):
    contour = cv2.approxPolyDP(contour, 0.45, True).reshape(-1, 2)
    if len(contour) < 3:
        return ""
    points = [f"{(px + x) / SCALE:g} {(py + y) / SCALE:g}" for px, py in contour]
    return f"M{'L'.join(points)}Z"


def main():
    with pymupdf.open(ROOT / "data" / "floorplan.svg") as document:
        pixmap = document[0].get_pixmap(matrix=pymupdf.Matrix(SCALE, SCALE), alpha=False)
    image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
        pixmap.height, pixmap.width, pixmap.n
    )
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    mask = np.uint8(gray < 205) * 255
    mask = cv2.dilate(mask, np.ones((2, 2), dtype=np.uint8))
    shapes = []

    for y in range(0, pixmap.height, TILE):
        for x in range(0, pixmap.width, TILE):
            tile = mask[y:y + TILE, x:x + TILE]
            contours, hierarchy = cv2.findContours(tile, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
            if hierarchy is None:
                continue
            for index, contour in enumerate(contours):
                if hierarchy[0, index, 3] != -1 or cv2.contourArea(contour) < 1:
                    continue
                path = path_for(contour, x, y)
                child = hierarchy[0, index, 2]
                while child != -1:
                    path += path_for(contours[child], x, y)
                    child = hierarchy[0, child, 0]
                if path:
                    shapes.append({"id": f"g{len(shapes) + 1}", "d": path, "x": 0, "y": 0, "kind": "trace"})

    (ROOT / "data" / "floorplan-geometry.json").write_text(
        json.dumps(shapes, separators=(",", ":")), encoding="utf-8"
    )
    print(f"Generated {len(shapes)} approximate editable path fragments.")


if __name__ == "__main__":
    main()
