# Building Assets & Floor Plan

Browse the inventory alongside the floor plan. Search for a person, room,
cube or asset tag; select a map label to view linked assets. The Assets tab
shows each asset's type and assignee or storage status.

Run locally with `python3 -m http.server 8000`, then open
<http://localhost:8000>. The app also works on GitHub Pages.

## Editing and saving

In **Assets**, choose **Add asset** to enter a device, or **Edit** beside an
existing asset to change it. Select an assignment status and enter the
employee, room or seat when assigned; choose Storage for stored equipment.
Save the form to apply the change. Enter the employee's name as it appears
on the map to link their assets to their map label.

Turn on **Edit mode** to move, add, remove or change map labels. To link a
person to a room or cube, set their location note to the
same text as that location's label. If the person's name differs between
the map and inventory, set their asset assignee name explicitly. Matches
otherwise require the same name; nearby labels are only suggestions.
The numbered external table is linked to BP-01 through BP-26, including
vacant seats. Searching a listed person highlights their BP seat.

Use **Expand map** and the zoom controls for more room on screen. **Label
size** changes the size of the text relative to the building.

**Print map / PDF** prints the entire current map with all labels and layout
edits, regardless of the visible map layers or zoom. In the print dialog,
choose **Save as PDF** to create a PDF. Select a map paper size before printing:
11 × 17 inches by default, or 18 × 24 / 24 × 36 inches for larger prints.
Make sure the print dialog or printer uses the same paper size; actual printer
paper options depend on the printer and browser.

The Assets tab has two print-ready reports, also available as PDFs through
the print dialog. **Assigned asset report** groups every assigned asset by its
recorded assignee (including seats and rooms), then sorts by type and tag.
**Unassigned / storage report** includes both unassigned and storage assets.
Reports use all current inventory, not just the visible filters.

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
