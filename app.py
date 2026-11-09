#!/usr/bin/env python3
import argparse
import base64
import binascii
from collections import Counter
from contextlib import closing
import csv
import io
import json
import mimetypes
import re
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
MAX_REQUEST = 14 * 1024 * 1024
STATUSES = ("unverified", "available", "in use", "repair", "retired")
FIELDS = ("tag", "name", "description", "serial", "person", "location", "status")


def connect(path):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def initialize(path):
    with closing(connect(path)) as db, db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS locations (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS people (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                location_id INTEGER REFERENCES locations(id) ON DELETE RESTRICT
            );
            CREATE TABLE IF NOT EXISTS assets (
                id INTEGER PRIMARY KEY, tag TEXT NOT NULL UNIQUE COLLATE NOCASE,
                name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
                serial TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
                person_id INTEGER REFERENCES people(id) ON DELETE RESTRICT,
                location_id INTEGER REFERENCES locations(id) ON DELETE RESTRICT
            );
        """)


def state(db):
    return {
        "floorplan": (db.execute("SELECT value FROM settings WHERE key='floorplan'").fetchone() or [""])[0],
        "locations": [dict(row) for row in db.execute("SELECT * FROM locations ORDER BY name")],
        "people": [dict(row) for row in db.execute("SELECT * FROM people ORDER BY name")],
        "assets": [dict(row) for row in db.execute("""
            SELECT a.*, p.name AS person, COALESCE(pl.name, l.name, '') AS location
            FROM assets a LEFT JOIN people p ON a.person_id=p.id
            LEFT JOIN locations pl ON p.location_id=pl.id
            LEFT JOIN locations l ON a.location_id=l.id ORDER BY a.tag
        """)],
    }


def text(value, required=False):
    value = str(value or "").strip()
    if len(value) > 500 or (required and not value):
        raise ValueError("Required fields must be filled and text must be at most 500 characters.")
    return value


def optional_id(value):
    return int(value) if value not in (None, "") else None


def save(db, kind, data):
    ident = optional_id(data.get("id"))
    if kind == "locations":
        name = text(data.get("name"), True)
        try:
            x, y, width, height = (float(data.get(k)) for k in ("x", "y", "width", "height"))
        except (TypeError, ValueError):
            raise ValueError("Location coordinates must be numbers.")
        if not (0 <= x <= 100 and 0 <= y <= 100 and 0 < width <= 100 - x and 0 < height <= 100 - y):
            raise ValueError("Location rectangles must fit within the floorplan.")
        columns, values = ("name", "x", "y", "width", "height"), (name, x, y, width, height)
    elif kind == "people":
        columns = ("name", "location_id")
        values = (text(data.get("name"), True), optional_id(data.get("location_id")))
    elif kind == "assets":
        status = text(data.get("status"), True)
        person_id = optional_id(data.get("person_id"))
        location_id = optional_id(data.get("location_id"))
        if status not in STATUSES:
            raise ValueError("Invalid asset status.")
        if person_id and status == "available":
            raise ValueError("An assigned asset cannot be marked available.")
        if person_id:
            location_id = None
        columns = ("tag", "name", "description", "serial", "status", "person_id", "location_id")
        values = (text(data.get("tag"), True), text(data.get("name"), True),
                  text(data.get("description")), text(data.get("serial")), status, person_id, location_id)
    else:
        raise ValueError("Unknown record type.")
    if ident:
        result = db.execute(f"UPDATE {kind} SET " + ", ".join(f"{c}=?" for c in columns) + " WHERE id=?", (*values, ident))
        if not result.rowcount:
            raise ValueError("Record no longer exists.")
    else:
        db.execute(f"INSERT INTO {kind} (" + ", ".join(columns) + ") VALUES (" + ", ".join("?" for _ in columns) + ")", values)


def read_wasp(data):
    mapping = data.get("mapping")
    if not isinstance(mapping, dict) or not mapping.get("tag"):
        raise ValueError("Select the WASP asset tag column.")
    content = data.get("csv", "")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("Choose a non-empty CSV file.")
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff"), newline=""), strict=True)
    headers = reader.fieldnames or []
    if not headers or any(not h for h in headers) or len(headers) != len(set(headers)):
        raise ValueError("CSV column names must be non-empty and unique.")
    for column in mapping.values():
        if column and column not in headers:
            raise ValueError("A selected column is not present in the CSV.")
    rows = []
    for row in reader:
        if None in row:
            raise ValueError("A CSV row has more values than headers.")
        item = {field: text(row.get(mapping.get(field), "")) for field in FIELDS}
        if any(item.values()):
            rows.append(item)
    return rows, mapping


def compare_wasp(db, data, do_import=False):
    rows, mapping = read_wasp(data)
    local = {a["tag"].casefold(): a for a in state(db)["assets"]}
    people = {r["name"].casefold(): dict(r) for r in db.execute("SELECT id, name, location_id FROM people")}
    locations = {r["name"].casefold(): r["id"] for r in db.execute("SELECT id, name FROM locations")}
    counts = Counter(row["tag"].casefold() for row in rows if row["tag"])
    seen = set()
    results = []
    imported = 0
    for row in rows:
        tag = row["tag"].casefold()
        if not tag or counts[tag] > 1:
            results.append({"tag": row["tag"], "result": "Missing or duplicate tag", "differences": []})
            if tag:
                seen.add(tag)
            continue
        seen.add(tag)
        asset = local.get(tag)
        if asset:
            differences = []
            for field in FIELDS[1:]:
                if mapping.get(field) and str(asset.get(field) or "").strip().casefold() != row[field].casefold():
                    differences.append({"field": field, "local": asset.get(field) or "", "wasp": row[field]})
            results.append({"tag": row["tag"], "result": "Different" if differences else "Match", "differences": differences})
        else:
            result = "Only in WASP"
            if do_import:
                person = people.get(row["person"].casefold()) if row["person"] else None
                person_id = person["id"] if person else None
                location_id = locations.get(row["location"].casefold()) if row["location"] else None
                status = row["status"].lower() if row["status"] else "unverified"
                if ((row["person"] and not person_id) or (row["location"] and not location_id)
                        or (person and location_id and person["location_id"] != location_id)
                        or status not in STATUSES or (person_id and status == "available")):
                    result = "Not imported: unknown or conflicting person, location, or status"
                else:
                    save(db, "assets", {"tag": row["tag"], "name": row["name"] or row["tag"],
                                         "description": row["description"], "serial": row["serial"],
                                         "status": status, "person_id": person_id, "location_id": location_id})
                    imported += 1
                    result = "Imported"
            results.append({"tag": row["tag"], "result": result, "differences": []})
    for tag, asset in local.items():
        if tag not in seen:
            results.append({"tag": asset["tag"], "result": "Only in local inventory", "differences": []})
    return {"results": results, "imported": imported}


class Handler(BaseHTTPRequestHandler):
    def json_response(self, value, status=200):
        body = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def valid_host(self):
        return self.headers.get("Host", "") in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")

    def do_GET(self):
        if not self.valid_host():
            return self.json_response({"error": "Invalid host."}, 403)
        path = urlsplit(self.path).path
        if path == "/api/state":
            with closing(connect(self.server.db_path)) as db:
                return self.json_response(state(db))
        files = {"/": "index.html", "/app.js": "app.js", "/style.css": "style.css"}
        if path not in files:
            return self.json_response({"error": "Not found."}, 404)
        file = ROOT / files[path]
        body = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self.valid_host() or self.headers.get("Origin") != f"http://{self.headers.get('Host')}":
            return self.json_response({"error": "Invalid origin."}, 403)
        if self.headers.get_content_type() != "application/json":
            return self.json_response({"error": "Expected JSON."}, 400)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_REQUEST:
                raise ValueError("Request is empty or too large.")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object.")
            path = urlsplit(self.path).path
            with closing(connect(self.server.db_path)) as db, db:
                if path in ("/api/locations", "/api/people", "/api/assets"):
                    save(db, path.rsplit("/", 1)[1], data)
                    result = {"ok": True}
                elif path == "/api/delete":
                    kind = data.get("kind")
                    if kind not in ("locations", "people", "assets"):
                        raise ValueError("Unknown record type.")
                    if not db.execute(f"DELETE FROM {kind} WHERE id=?", (optional_id(data.get("id")),)).rowcount:
                        raise ValueError("Record no longer exists.")
                    result = {"ok": True}
                elif path == "/api/floorplan":
                    image = data.get("image", "")
                    if image:
                        if not isinstance(image, str) or not re.fullmatch(r"data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+", image):
                            raise ValueError("Use a PNG, JPEG, GIF, or WebP image.")
                        try:
                            if len(base64.b64decode(image.split(",", 1)[1], validate=True)) > 10 * 1024 * 1024:
                                raise ValueError("Image must be 10 MB or smaller.")
                        except binascii.Error:
                            raise ValueError("Invalid image data.")
                    db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('floorplan', ?)", (image,))
                    result = {"ok": True}
                elif path == "/api/wasp/headers":
                    content = data.get("csv", "")
                    if not isinstance(content, str) or not content.strip():
                        raise ValueError("Choose a non-empty CSV file.")
                    headers = next(csv.reader(io.StringIO(content.lstrip("\ufeff"), newline=""), strict=True), [])
                    if not headers or any(not h for h in headers) or len(headers) != len(set(headers)):
                        raise ValueError("CSV column names must be non-empty and unique.")
                    result = {"headers": headers}
                elif path in ("/api/wasp/compare", "/api/wasp/import"):
                    result = compare_wasp(db, data, path.endswith("/import"))
                else:
                    return self.json_response({"error": "Not found."}, 404)
            self.json_response(result)
        except (ValueError, TypeError, json.JSONDecodeError, csv.Error, sqlite3.IntegrityError) as error:
            self.json_response({"error": str(error)}, 400)


def main():
    parser = argparse.ArgumentParser(description="Local floorplan and asset inventory")
    parser.add_argument("--db", default="inventory.db", help="SQLite database path")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    initialize(args.db)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.db_path = args.db
    print(f"Open http://127.0.0.1:{server.server_port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
