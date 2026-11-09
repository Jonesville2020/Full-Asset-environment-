# Floorplan & Inventory

A local, single-building inventory and floorplan application. It runs on Python 3
using only the standard library and stores its data in a SQLite file.

## Run

```sh
python3 app.py
```

Open <http://127.0.0.1:8000>. To choose a database or port, use
`python3 app.py --db /path/to/inventory.db --port 8001`. The server listens only
on this computer; keep the database private and back it up regularly. Stop the
server before copying the database for a backup. This is a single-user local
tool, not a hosted or multi-user service.

## Use

1. Upload a PNG, JPEG, GIF, or WebP floorplan image (up to 10 MB). PDF or CAD
   plans must first be exported to an image. The original drawing itself is not
   edited: spaces are editable rectangles overlaid on it.
2. Add named spaces, drag them on the plan, or edit their position and size as
   percentages. Add people and assign each person to a space.
3. Add assets by unique tag, with descriptions, serial numbers, status, and
   either an assigned person or a space. An assigned asset follows its person's
   space; an unassigned asset can have its own space. Use the inventory search
   to find available assets, people, tags, or locations. Unverified means its
   availability has not been confirmed.
4. Export the WASP all-assets report as UTF-8 CSV. Choose it under WASP
   comparison and map its columns (asset tag is required). Compare to see
   matching tags, field differences, and records missing from either side.
   Only mapped fields are compared; differences do not modify either system.
   Tags and compared values are matched case-insensitively after trimming.
5. Optionally import new tags only. Existing assets are never overwritten.
   Create any referenced people and spaces first; rows with unknown people or
   spaces, conflicting person/space assignments, or statuses other than
   `unverified`, `available`, `in use`, `repair`, and `retired` are skipped.
   Map or correct those values in the CSV before retrying. Unmapped status is
   imported as unverified, and a missing name defaults to the tag. Duplicate or
   missing tags are reported, not imported.

Deleting a person or space referenced by another record is blocked; reassign
the related records first. Replacing or removing the background image retains
the space overlays.

## Tests

```sh
python3 -m unittest discover -s tests
```
