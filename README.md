# Floorplan & Inventory

A browser-based floorplan and asset inventory. To use it, open `index.html` in a current browser such as Microsoft Edge or Chrome. No Python, installation, or server is required. The same files can also be published on an internal static website for convenient access.

Inventory data is saved in the browser's local storage on that computer. It is not automatically shared between computers or browsers. Use **Download backup** to save a JSON backup and **Restore backup** on another computer to transfer it. Restoring replaces the inventory currently saved in that browser, so export a backup first if you need to keep those records.

## Use

1. Choose a PNG, JPEG, GIF, or WebP floorplan image (up to 10 MB). PDF or CAD plans must first be exported to an image. The original drawing itself is not edited; spaces are editable rectangles overlaid on it.
2. Add named spaces, drag them on the plan, or edit their position and size as percentages. Add people and assign each person to a space.
3. Add assets by unique tag, with descriptions, serial numbers, status, and either an assigned person or a space. An assigned asset follows that person's space; an unassigned asset can have its own space. Use inventory search to find available assets, people, tags, or locations.
4. To compare or import an asset CSV, choose it under WASP comparison and map its columns (asset tag is required). Comparison reports matches, differences, and records missing from either side. It does not modify existing assets.
5. Import adds only new tags. Create referenced people and spaces first; rows with unknown people or spaces, conflicting person/space assignments, or unsupported statuses are skipped. Unmapped status is imported as unverified, and a missing name defaults to the tag.

Deleting a person or space referenced by another record is blocked; reassign related records first. Replacing or removing the background image retains the space overlays.

## Tests

The existing Python API tests can be run with:

```sh
python3 -m unittest discover -s tests
```
