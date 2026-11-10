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
The numbered external table is linked to BP-01 through BP-26, including
vacant seats. Searching a listed person highlights their BP seat.

Use **Expand map** and the zoom controls for more room on screen. **Label
size** changes the size of the text relative to the building.

Turn on **Layout edit** to select, move or delete traced fragments, or use
the drawing tools to add walls and rectangular rooms or cubicles. Undo
reverses up to 20 layout edits in the current session. Turn layout editing
off to select names and other labels again. Drawn shapes are linework, not
linked room records; add or move a room label separately to show details.

The building is an **approximate automatic trace**, not the original Visio
drawing: walls and cubicles can be split into fragments or merged together,
and details may be missing or misplaced. Turn on **Original reference** to
compare and correct it before relying on the layout.

The mechanical-area annotations were reconstructed as editable text from
the PDF image. Their background masks hide the original traced lettering;
these masks also cover any linework drawn directly behind them. Two details
are marked unclear rather than guessed. Verify the annotations against the
original PDF before relying on them.

**Export SVG** downloads the traced paths and labels as a vector SVG for
import into Visio via **Insert > Pictures**. It is not a native `.vsdx` file;
whether individual paths can be ungrouped or edited depends on the Visio
version. The SVG does not include the reference image or asset inventory.
It does include the map labels, including names.
Use **Export** (JSON) for a complete backup that can be imported into the app.

Edits are stored **only in the current browser**, not shared automatically
with other users or published to GitHub Pages. Use **Export** to back them up
and **Import** to load them in another browser. Reset restores the original
data. Export regularly: clearing browser storage removes local edits.

Click a label rather than a wall or empty room to see its details. Labels
extracted from the PDF may need correction.

## Regenerating source data

`data/` is generated from the source CSV and PDF. To regenerate it, install
PyMuPDF, NumPy and opencv-python-headless, then run `python tools/build_data.py`
followed by `python tools/trace_floorplan.py`. This replaces the generated files;
export browser edits first.
