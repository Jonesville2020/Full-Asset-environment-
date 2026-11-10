# Building Assets & Floor Plan

A small, dependency-free browser application for browsing the asset inventory
alongside the completed building floor plan.

## Run locally

From this directory, start a local web server:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000> in a browser. Keep the CSV and PDF files in
this directory so the app can load them.

Use the search field to find assets by tag, description, serial number, type,
manufacturer, model, location, and other inventory details. The location
selector filters assets by the `Location` value in the CSV. The floor plan is
displayed in the same page and can also be opened separately.

The inventory does not include coordinates linking individual assets to spots
on the floor plan, so assets are not plotted on the PDF.
