# Building Assets & Floor Plan

Browse the inventory alongside the floor plan. Search for a person, room,
cube or asset tag; select a map label to view linked assets. The Assets tab
shows each asset's type and assignee or storage status.

Run locally with `python3 -m http.server 8000`, then open
<http://localhost:8000>. The app also works on GitHub Pages.

## Editing and saving

Turn on **Edit mode** to move, add, remove or change map labels and edit
assets. To link a person to a room or cube, set their location note to the
same text as that location's label. If the person's name differs between
the map and inventory, set their asset assignee name explicitly. Matches
otherwise require the same name; nearby labels are only suggestions.

Edits are stored **only in the current browser**, not shared automatically
with other users or published to GitHub Pages. Use **Export** to back them up
and **Import** to load them in another browser. Reset restores the original
data. Export regularly: clearing browser storage removes local edits.

The floor plan's labels are editable, but its underlying walls and cubicle
layout are a fixed background from the PDF; click a label rather than a wall
or empty room to select it. Labels extracted from the PDF may need correction.

## Regenerating source data

`data/` is generated from the source CSV and PDF. To regenerate it, install
PyMuPDF and run `python tools/build_data.py`. This replaces the generated files;
export browser edits first.
