const STORAGE_KEY = "full-asset-environment.v1";
const KINDS = {
  person: { label: "Person", layer: "people" },
  vacant: { label: "Vacant seat", layer: "vacant" },
  seat: { label: "Cube / counter ID", layer: "seats" },
  room: { label: "Room", layer: "rooms" },
  printer: { label: "Printer", layer: "printers" },
  ap: { label: "Access point", layer: "aps" },
  kiosk: { label: "Kiosk", layer: "other" },
  clock: { label: "Time clock", layer: "other" },
  note: { label: "Building note", layer: "other" },
  label: { label: "Other label", layer: "other" },
  legend: { label: "Legend", layer: "other" },
};
const NEAR_RADIUS = { seat: 25, vacant: 25, room: 70 };
const PAGE_SIZE = 150;
const SVG_NS = "http://www.w3.org/2000/svg";

const $ = (selector) => document.querySelector(selector);
const svg = $("#map");
const itemLayer = $("#map-items");
const geometryLayer = $("#map-geometry");
const noteMasksLayer = $("#note-masks");
const drawingPreview = $("#drawing-preview");
const ring = $("#ring");

let plan = { width: 1224, height: 792 };
let items = [];
let assets = [];
let geometry = [];
let baseSnapshot = null;
let editMode = false;
let layoutEdit = false;
let selectedShape = null;
let layoutHistory = [];
let selection = null;
let view = { x: 0, y: 0, w: 1224, h: 792 };
let index = null;
let drag = null;
let saveTimer = null;
let assetPage = 1;
let assetSort = { key: "type", dir: 1 };
const nodes = new Map();
const geometryNodes = new Map();

function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") element.className = value;
    else if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) element.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) element.append(child);
  }
  return element;
}

function put(parent, ...children) {
  for (const child of children.flat(Infinity)) {
    if (child != null && child !== false) parent.append(child);
  }
  return parent;
}

/* ---------- matching names, seats and assets ---------- */

function nameKey(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[.,']/g, "")
    .replace(/\s+\d+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function locKey(text) {
  const t = (text || "").toLowerCase().replace(/\s+/g, " ").trim();
  let m = t.match(/^(?:#|counter)\s*(\d+)$/);
  if (m) return `counter${m[1]}`;
  m = t.match(/^(?:bp|bullpen)[-\s]*0*(\d+)$/);
  if (m) return `bp${m[1]}`;
  m = t.match(/^(?:cub|cubicle)\.?\s*([\d-]+)$/);
  if (m) return `cub${m[1].replace(/-/g, "")}`;
  return t.replace(/[^a-z0-9]/g, "");
}

function isSpecialAssignee(name) {
  return !name || name === "Storage";
}

function getIndex() {
  if (index) return index;
  index = {
    names: new Map(),
    assetsByAssignee: new Map(),
    locs: new Map(),
    itemsByAssignee: new Map(),
  };
  for (const asset of assets) {
    const name = asset.assignee;
    if (isSpecialAssignee(name)) continue;
    if (!index.assetsByAssignee.has(name)) index.assetsByAssignee.set(name, []);
    index.assetsByAssignee.get(name).push(asset);
    const lk = locKey(name);
    if (!index.locs.has(lk)) index.locs.set(lk, new Set());
    index.locs.get(lk).add(name);
    if (!/\d/.test(name)) {
      const key = nameKey(name);
      if (!index.names.has(key)) index.names.set(key, new Set());
      index.names.get(key).add(name);
    }
  }
  for (const item of items) {
    if (item.k !== "person") continue;
    const name = matchAssignee(item.assignee || item.t);
    if (!name) continue;
    if (!index.itemsByAssignee.has(name)) index.itemsByAssignee.set(name, []);
    index.itemsByAssignee.get(name).push(item);
  }
  return index;
}

function matchAssignee(text) {
  const key = nameKey(text);
  const matches = index.names.get(key);
  return matches?.size === 1 ? [...matches][0] : null;
}

function assigneeFor(item) {
  getIndex();
  return item.k === "person" ? matchAssignee(item.assignee || item.t) : null;
}

function assetsForItem(item) {
  const idx = getIndex();
  const found = new Map();
  const addAssignee = (name) => (idx.assetsByAssignee.get(name) || []).forEach((a) => found.set(a.id, a));
  const person = assigneeFor(item);
  if (person) addAssignee(person);
  const keys = [item.loc];
  if (item.k !== "person") keys.push(item.t);
  for (const key of keys) {
    if (!key) continue;
    (idx.locs.get(locKey(key)) || []).forEach(addAssignee);
  }
  return [...found.values()];
}

function peopleNear(item) {
  const radius = NEAR_RADIUS[item.k];
  if (!radius) return [];
  return items
    .filter((other) => other.k === "person" && Math.hypot(other.x - item.x, other.y - item.y) <= radius)
    .sort((a, b) => Math.hypot(a.x - item.x, a.y - item.y) - Math.hypot(b.x - item.x, b.y - item.y));
}

function peopleAt(item) {
  if (!["room", "seat"].includes(item.k)) return [];
  const keys = [item.t, item.loc].filter(Boolean).map(locKey);
  return items.filter((other) =>
    ["person", "vacant"].includes(other.k) && other.loc && keys.includes(locKey(other.loc)),
  );
}

function nearestPlace(item) {
  let best = null;
  let bestDistance = 30;
  for (const other of items) {
    if (other === item || (other.k !== "seat" && other.k !== "room")) continue;
    const distance = Math.hypot(other.x - item.x, other.y - item.y);
    if (distance < bestDistance) {
      best = other;
      bestDistance = distance;
    }
  }
  return best;
}

/* ---------- persistence ---------- */

function setStatus(message) {
  $("#status").textContent = message;
}

function saveNow() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, items, assets, geometry }));
    setStatus("Changes saved in this browser. Use Export to back them up or share them.");
    return true;
  } catch {
    setStatus("Could not save in this browser (storage is full or blocked). Use Export to keep your changes.");
    return false;
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

function exportJson() {
  const data = JSON.stringify({ version: 3, width: plan.width, height: plan.height, items, assets, geometry }, null, 1);
  download("floor-plan-and-assets.json", data, "application/json");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  const lines = ["Asset Tag,Type,Assigned To,Recorded Location,Model,Serial Number"];
  for (const asset of assets) {
    lines.push(
      [asset.tag, asset.type, asset.assignee || "Unassigned", asset.location, asset.model, asset.serial].map(csvEscape).join(","),
    );
  }
  download("assets.csv", lines.join("\n"), "text/csv");
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = h("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function validData(data) {
  if (!data || !Array.isArray(data.items) || !Array.isArray(data.assets)) return false;
  if (data.geometry != null) {
    if (!Array.isArray(data.geometry)) return false;
    const shapeIds = new Set();
    for (const shape of data.geometry) {
      if (!shape || typeof shape.id !== "string" || shapeIds.has(shape.id) ||
          typeof shape.d !== "string" || !/^[MmLlHhVvZz0-9.,\s+-]+$/.test(shape.d) ||
          !Number.isFinite(shape.x) || !Number.isFinite(shape.y) ||
          !["trace", "wall", "rectangle"].includes(shape.kind)) return false;
      shapeIds.add(shape.id);
    }
  }
  const ids = new Set();
  for (const item of data.items) {
    if (!item || typeof item.id !== "string" || ids.has(item.id) ||
        typeof item.t !== "string" || !KINDS[item.k] ||
        !Number.isFinite(item.x) || !Number.isFinite(item.y) ||
        !Number.isFinite(item.s) || item.s <= 0 ||
        (item.r != null && !Number.isFinite(item.r)) ||
        (item.loc != null && typeof item.loc !== "string") ||
        (item.assignee != null && typeof item.assignee !== "string")) return false;
    ids.add(item.id);
  }
  ids.clear();
  for (const asset of data.assets) {
    if (!asset || typeof asset.id !== "string" || ids.has(asset.id) ||
        ["tag", "type", "assignee", "model", "serial"].some((key) => typeof asset[key] !== "string")) return false;
    ids.add(asset.id);
  }
  return true;
}

function upgradeData(data) {
  if ((data.version ?? 0) >= 3) return data;
  const defaults = new Map(baseSnapshot.items.map((item) => [item.id, item]));
  const upgraded = data.items.map((item) => {
    const original = defaults.get(item.id);
    if (original?.loc?.startsWith("BP-") && ["person", "vacant"].includes(item.k) && !item.loc) {
      return { ...item, loc: original.loc };
    }
    return item;
  });
  const ids = new Set(upgraded.map((item) => item.id));
  for (const item of baseSnapshot.items) {
    if (item.k === "note" && !ids.has(item.id)) upgraded.push(structuredClone(item));
  }
  return { ...data, items: upgraded, version: 3 };
}

async function importJson(file) {
  try {
    let data = JSON.parse(await file.text());
    if (!validData(data)) throw new Error("invalid data");
    if (!confirm("Importing replaces the current map and assets in this browser. Continue?")) return;
    data = upgradeData(data);
    clearTimeout(saveTimer);
    items = data.items;
    assets = data.assets;
    geometry = data.geometry ?? structuredClone(baseSnapshot.geometry);
    afterDataReplaced();
    saveNow();
    setStatus(`Imported ${items.length} map labels and ${assets.length} assets. Saved in this browser.`);
  } catch {
    setStatus("That file isn't a valid export from this app.");
  }
}

function resetData() {
  if (!confirm("Discard all edits made in this browser and restore the original floor plan and assets?")) return;
  clearTimeout(saveTimer);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    setStatus("Could not clear saved edits in this browser.");
    return;
  }
  items = structuredClone(baseSnapshot.items);
  assets = structuredClone(baseSnapshot.assets);
  geometry = structuredClone(baseSnapshot.geometry);
  afterDataReplaced();
  setStatus("Restored the original data.");
}

function afterDataReplaced() {
  index = null;
  selection = null;
  selectedShape = null;
  layoutHistory = [];
  $("#undo-layout").disabled = true;
  renderGeometry();
  renderAllItems();
  updateRing();
  renderDetails();
  renderAssets();
}

/* ---------- map ---------- */

function renderShape(shape) {
  let node = geometryNodes.get(shape.id);
  if (!node) {
    node = document.createElementNS(SVG_NS, "path");
    node.dataset.id = shape.id;
    geometryNodes.set(shape.id, node);
    geometryLayer.append(node);
  }
  node.setAttribute("class", `geometry-shape${shape.id === selectedShape ? " selected" : ""}`);
  node.setAttribute("d", shape.d);
  node.setAttribute("transform", `translate(${shape.x} ${shape.y})`);
  node.setAttribute("fill", shape.kind === "trace" ? "#222" : "none");
  node.setAttribute("fill-rule", "evenodd");
  node.setAttribute("stroke", shape.kind === "trace" ? "none" : "#222");
  node.setAttribute("stroke-width", "0.8");
}

function renderGeometry() {
  geometryNodes.clear();
  geometryLayer.replaceChildren();
  for (const shape of geometry) renderShape(shape);
  $("#delete-shape").disabled = !selectedShape;
}

function renderNoteMasks() {
  noteMasksLayer.replaceChildren();
  for (const mask of plan.noteMasks) {
    const rect = document.createElementNS(SVG_NS, "rect");
    for (const key of ["x", "y", "w", "h"]) {
      rect.setAttribute({ w: "width", h: "height" }[key] || key, mask[key]);
    }
    noteMasksLayer.append(rect);
  }
}

function selectShape(id) {
  if (selectedShape && geometryNodes.has(selectedShape)) {
    geometryNodes.get(selectedShape).classList.remove("selected");
  }
  selectedShape = id;
  if (id && geometryNodes.has(id)) geometryNodes.get(id).classList.add("selected");
  $("#delete-shape").disabled = !id;
}

function deleteShape() {
  if (!selectedShape) return;
  rememberLayout();
  geometry = geometry.filter((shape) => shape.id !== selectedShape);
  geometryNodes.get(selectedShape)?.remove();
  geometryNodes.delete(selectedShape);
  selectShape(null);
  save();
}

function rememberLayout(snapshot = JSON.stringify(geometry)) {
  layoutHistory.push(snapshot);
  if (layoutHistory.length > 20) layoutHistory.shift();
  $("#undo-layout").disabled = false;
}

function undoLayout() {
  if (!layoutHistory.length) return;
  geometry = JSON.parse(layoutHistory.pop());
  selectedShape = null;
  renderGeometry();
  $("#undo-layout").disabled = !layoutHistory.length;
  save();
}

function pointOnMap(event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function drawingPath(kind, start, end) {
  const round = (value) => Math.round(value * 10) / 10;
  const x1 = round(start.x);
  const y1 = round(start.y);
  const x2 = round(end.x);
  const y2 = round(end.y);
  return kind === "wall" ? `M${x1} ${y1}L${x2} ${y2}` : `M${x1} ${y1}H${x2}V${y2}H${x1}Z`;
}

function exportSvg() {
  const output = document.createElementNS(SVG_NS, "svg");
  output.setAttribute("xmlns", SVG_NS);
  output.setAttribute("viewBox", `0 0 ${plan.width} ${plan.height}`);
  output.setAttribute("width", plan.width * 2);
  output.setAttribute("height", plan.height * 2);
  for (const shape of geometry) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", shape.d);
    path.setAttribute("transform", `translate(${shape.x} ${shape.y})`);
    path.setAttribute("fill", shape.kind === "trace" ? "#222" : "none");
    path.setAttribute("fill-rule", "evenodd");
    if (shape.kind !== "trace") {
      path.setAttribute("stroke", "#222");
      path.setAttribute("stroke-width", "0.8");
    }
    output.append(path);
  }
  for (const mask of plan.noteMasks) {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", mask.x);
    rect.setAttribute("y", mask.y);
    rect.setAttribute("width", mask.w);
    rect.setAttribute("height", mask.h);
    rect.setAttribute("fill", "#fff");
    output.append(rect);
  }
  const colors = {
    person: "#c1121f", vacant: "#9aa3ad", seat: "#b45309", room: "#111",
    printer: "#2f9e44", ap: "#1c7ed6", kiosk: "#0b5ed7", clock: "#c026d3", note: "#46505a",
  };
  const textScale = Number($("#text-scale").value);
  for (const item of items) {
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("transform", `translate(${item.x} ${item.y}) rotate(${item.r || 0})`);
    text.setAttribute("font-family", "Arial, sans-serif");
    text.setAttribute("font-size", item.s * textScale);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("fill", colors[item.k] || "#444");
    text.textContent = item.t;
    output.append(text);
  }
  download("editable-floor-plan.svg", new XMLSerializer().serializeToString(output), "image/svg+xml");
}

function itemSize(item) {
  const size = item.s * Number($("#text-scale").value);
  const width = Math.max(item.t.length * size * 0.56, size * 2) + 2;
  return { width, height: size * 1.6 + 1 };
}

function renderItem(item) {
  let group = nodes.get(item.id);
  if (!group) {
    group = document.createElementNS(SVG_NS, "g");
    group.dataset.id = item.id;
    group.append(document.createElementNS(SVG_NS, "rect"), document.createElementNS(SVG_NS, "text"));
    group.firstChild.setAttribute("class", "hit");
    nodes.set(item.id, group);
    itemLayer.append(group);
  }
  const kind = KINDS[item.k] ? item.k : "label";
  group.setAttribute("class", `item k-${kind} layer-${KINDS[kind].layer}${isSelected(item) ? " sel" : ""}`);
  group.setAttribute("transform", `translate(${item.x} ${item.y}) rotate(${item.r || 0})`);
  const { width, height } = itemSize(item);
  const rect = group.firstChild;
  rect.setAttribute("x", -width / 2);
  rect.setAttribute("y", -height / 2);
  rect.setAttribute("width", width);
  rect.setAttribute("height", height);
  const text = group.lastChild;
  text.style.fontSize = `calc(${item.s}px * var(--text-scale))`;
  text.textContent = item.t;
  return group;
}

function renderAllItems() {
  nodes.clear();
  itemLayer.replaceChildren();
  for (const item of items) renderItem(item);
}

function isSelected(item) {
  return selection?.type === "item" && selection.id === item.id;
}

function findItem(id) {
  return items.find((item) => item.id === id);
}

function applyView() {
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  updateRing();
}

function scale() {
  return svg.getScreenCTM()?.a || 1;
}

function mapTarget(item) {
  if (!["person", "vacant"].includes(item.k) || !item.loc) return item;
  const places = items.filter((other) =>
    ["seat", "room"].includes(other.k) && locKey(other.t) === locKey(item.loc),
  );
  return places.length === 1 ? places[0] : item;
}

function updateRing() {
  const item = selection?.type === "item" ? findItem(selection.id) : null;
  ring.toggleAttribute("hidden", !item);
  if (!item) return;
  const target = mapTarget(item);
  ring.setAttribute("cx", target.x);
  ring.setAttribute("cy", target.y);
  ring.setAttribute("r", 22 / scale());
}

function zoomAt(factor, clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const point = svg.createSVGPoint();
  point.x = clientX ?? rect.left + rect.width / 2;
  point.y = clientY ?? rect.top + rect.height / 2;
  const p = point.matrixTransform(svg.getScreenCTM().inverse());
  const width = Math.min(plan.width * 1.2, Math.max(25, view.w * factor));
  const ratio = width / view.w;
  view = {
    x: p.x - (p.x - view.x) * ratio,
    y: p.y - (p.y - view.y) * ratio,
    w: width,
    h: view.h * ratio,
  };
  applyView();
}

function zoomToItem(item) {
  item = mapTarget(item);
  const width = 150;
  const height = (width * plan.height) / plan.width;
  view = { x: item.x - width / 2, y: item.y - height / 2, w: width, h: height };
  applyView();
}

function fitView() {
  view = { x: 0, y: 0, w: plan.width, h: plan.height };
  applyView();
}

function viewCenter() {
  return { x: view.x + view.w / 2, y: view.y + view.h / 2 };
}

svg.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomAt(event.deltaY < 0 ? 0.8 : 1.25, event.clientX, event.clientY);
}, { passive: false });

svg.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (layoutEdit) {
    const tool = $("#layout-tool").value;
    const shapeNode = event.target.closest(".geometry-shape");
    const shape = shapeNode ? geometry.find((entry) => entry.id === shapeNode.dataset.id) : null;
    if (tool !== "select") {
      const start = pointOnMap(event);
      drag = { mode: "draw", tool, start, end: start, startX: event.clientX, startY: event.clientY, moved: false };
      selectShape(null);
      svg.setPointerCapture(event.pointerId);
      return;
    }
    if (shape) {
      selectShape(shape.id);
      drag = {
        mode: "shape", shape, origin: { x: shape.x, y: shape.y },
        startX: event.clientX, startY: event.clientY, moved: false,
        before: JSON.stringify(geometry),
      };
      svg.setPointerCapture(event.pointerId);
      return;
    }
    selectShape(null);
  }
  const group = event.target.closest(".item");
  const item = group ? findItem(group.dataset.id) : null;
  drag = {
    item,
    mode: item && editMode ? "item" : "pan",
    startX: event.clientX,
    startY: event.clientY,
    origin: item ? { x: item.x, y: item.y } : null,
    view: { ...view },
    moved: false,
  };
  svg.setPointerCapture(event.pointerId);
});

svg.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  const factor = scale();
  if (drag.mode === "draw") {
    drag.end = pointOnMap(event);
    drawingPreview.setAttribute("d", drawingPath(drag.tool, drag.start, drag.end));
    drawingPreview.removeAttribute("hidden");
  } else if (drag.mode === "shape") {
    drag.shape.x = Math.round((drag.origin.x + dx / factor) * 10) / 10;
    drag.shape.y = Math.round((drag.origin.y + dy / factor) * 10) / 10;
    renderShape(drag.shape);
  } else if (drag.mode === "item") {
    drag.item.x = Math.round((drag.origin.x + dx / factor) * 10) / 10;
    drag.item.y = Math.round((drag.origin.y + dy / factor) * 10) / 10;
    renderItem(drag.item);
    updateRing();
  } else {
    view = { ...drag.view, x: drag.view.x - dx / factor, y: drag.view.y - dy / factor };
    applyView();
  }
});

svg.addEventListener("pointerup", () => {
  if (!drag) return;
  const finished = drag;
  drag = null;
  if (finished.mode === "draw") {
    drawingPreview.setAttribute("hidden", "");
    if (!finished.moved) return;
    rememberLayout();
    const shape = {
      id: `g-${crypto.randomUUID()}`, kind: finished.tool,
      d: drawingPath(finished.tool, finished.start, finished.end), x: 0, y: 0,
    };
    geometry.push(shape);
    renderShape(shape);
    selectShape(shape.id);
    save();
  } else if (finished.mode === "shape") {
    if (finished.moved) {
      rememberLayout(finished.before);
      save();
    }
  } else if (!finished.moved && !layoutEdit) {
    selectItem(finished.item, false);
  } else if (finished.mode === "item") {
    index = null;
    save();
    selectItem(finished.item, false);
  }
});

svg.addEventListener("pointercancel", () => {
  if (drag?.mode === "shape") {
    Object.assign(drag.shape, drag.origin);
    renderShape(drag.shape);
  }
  drawingPreview.setAttribute("hidden", "");
  drag = null;
});

/* ---------- selection and details ---------- */

function refreshSelectionStyles() {
  for (const item of items) {
    const node = nodes.get(item.id);
    if (node) node.classList.toggle("sel", isSelected(item));
  }
  updateRing();
}

function selectItem(item, zoom) {
  selection = item ? { type: "item", id: item.id } : null;
  refreshSelectionStyles();
  if (item && zoom) zoomToItem(item);
  showTab("details");
  renderDetails();
}

function selectAssignee(name) {
  selection = { type: "assignee", name };
  refreshSelectionStyles();
  showTab("details");
  renderDetails();
}

function locateAssignee(name) {
  const placed = (getIndex().itemsByAssignee.get(name) || [])[0];
  if (placed) selectItem(placed, true);
  else selectAssignee(name);
}

function assetLine(asset) {
  return h(
    "li",
    {},
    h("span", {}, h("strong", {}, asset.type || "Unknown type")),
    h("button", { class: "link", type: "button", onclick: () => focusAsset(asset.tag) }, asset.tag || "(no tag)"),
  );
}

function assetSummary(list) {
  const counts = new Map();
  for (const asset of list) counts.set(asset.type, (counts.get(asset.type) || 0) + 1);
  return h(
    "div",
    { class: "chips" },
    [...counts].sort((a, b) => b[1] - a[1]).map(([type, count]) => h("span", { class: "badge" }, `${count} × ${type}`)),
  );
}

function assetSection(title, list) {
  return [
    h("h3", {}, title),
    list.length
      ? [assetSummary(list), h("ul", { class: "list" }, list.map(assetLine))]
      : h("p", { class: "empty" }, "No linked assets found."),
  ];
}

function renderDetails() {
  const panel = $("#panel-details");
  panel.replaceChildren();
  panel.className = "tab-panel details";

  if (!selection) {
    put(panel,
      h("h2", {}, "Nothing selected"),
      h("p", { class: "empty" }, "Click a name, cube or room on the floor plan, or search for a person above, to see who sits there and what assets they have."),
    );
    return;
  }

  if (selection.type === "assignee") {
    const name = selection.name;
    const list = getIndex().assetsByAssignee.get(name) || [];
    put(panel,
      h("h2", {}, name),
      h("p", { class: "warn" }, "This person isn't placed on the floor plan."),
      editMode
        ? h("button", { type: "button", onclick: () => addItem("person", name) }, "Place on the map")
        : null,
      assetSection("Assets", list),
    );
    return;
  }

  const item = findItem(selection.id);
  if (!item) return;
  const person = assigneeFor(item);
  const place = nearestPlace(item);
  const related = h("div", { id: "item-related" });

  put(panel,
    h("h2", {}, item.t),
    h("span", { class: "badge" }, KINDS[item.k]?.label || item.k),
    item.loc ? h("p", { class: "meta" }, `Location: ${item.loc}`) : null,
    !item.loc && place ? h("p", { class: "meta" }, `Near: ${place.t}`) : null,
    item.k === "note" ? h("p", { class: "warn" },
      "Reconstructed from the PDF image. Verify unclear details against the ",
      h("a", { href: "Floor-Plan-Completed-Labels-11-04-2026.pdf", target: "_blank", rel: "noopener" }, "original PDF"),
      ".",
    ) : null,
    h("p", {}, h("button", { type: "button", onclick: () => zoomToItem(item) }, "Zoom to this spot")),
  );

  if (editMode) put(panel, itemForm(item, related));
  put(panel, related);
  renderRelated(item, related, person);
}

function renderRelated(item, container, knownPerson) {
  container.replaceChildren();
  const person = knownPerson === undefined ? assigneeFor(item) : knownPerson;
  const linked = peopleAt(item);
  const nearby = peopleNear(item).filter((other) => other !== item && !linked.includes(other));

  if (item.k === "person" && !person) {
    put(container, h("p", { class: "warn" }, "No exact asset assignment found. In edit mode, set the asset assignee name to link this person."));
  }
  if (linked.length) {
    put(container,
      h("h3", {}, "People assigned to this location"),
      h("ul", { class: "list" }, linked.map((p) => h("li", {}, h("button", { class: "link", type: "button", onclick: () => selectItem(p, false) }, p.t)))),
    );
  }

  const directAssets = assetsForItem(item);
  const linkedAssets = linked.flatMap((p) => assetsForItem(p));
  const all = [...new Map([...directAssets, ...linkedAssets].map((a) => [a.id, a])).values()];
  if (item.k === "person" || all.length || item.k === "seat" || item.k === "room") {
    put(container, assetSection(item.k === "person" ? "Assets" : "Assets here", all));
  }
  if (item.k !== "person" && item.k !== "vacant" && nearby.length) {
    put(container,
      h("h3", {}, "Nearby labels (approximate)"),
      h("p", { class: "muted" }, "Proximity does not confirm an assignment."),
      h("ul", { class: "list" }, nearby.map((p) => h("li", {}, h("button", { class: "link", type: "button", onclick: () => selectItem(p, false) }, p.t)))),
    );
  }
}

function itemForm(item, related) {
  const onText = (event) => {
    item.t = event.target.value;
    index = null;
    renderItem(item);
    updateRing();
    renderRelated(item, related);
    save();
  };
  const kindSelect = h(
    "select",
    { id: "f-kind", onchange: (event) => { item.k = event.target.value; index = null; renderItem(item); save(); renderDetails(); } },
    Object.entries(KINDS).map(([value, kind]) => h("option", { value, selected: value === item.k }, kind.label)),
  );
  return h(
    "div",
    { class: "form-grid" },
    h("label", {}, "Text on the map", h("input", { value: item.t, oninput: onText })),
    h("label", {}, "Type", kindSelect),
    item.k === "person" ? h("label", {}, "Asset assignee name (if different)", h("input", {
      value: item.assignee || "",
      list: "assignee-options",
      placeholder: "Uses text on the map when empty",
      onchange: (event) => {
        item.assignee = event.target.value.trim();
        index = null;
        renderRelated(item, related);
        save();
      },
    })) : null,
    h("label", {}, "Location note (room, cube, counter…)", h("input", {
      value: item.loc || "",
      placeholder: "e.g. Cubicle 150-001",
      oninput: (event) => { item.loc = event.target.value; renderRelated(item, related); save(); },
    })),
    h(
      "div",
      { class: "form-row" },
      h("label", {}, "Font size", h("input", {
        type: "number", min: "1", max: "30", step: "0.1", value: item.s,
        oninput: (event) => { item.s = Math.max(1, Number(event.target.value) || item.s); renderItem(item); save(); },
      })),
      h("label", {}, "Rotation", h(
        "select",
        { onchange: (event) => { item.r = Number(event.target.value); renderItem(item); save(); } },
        [0, 90, 180, 270].map((deg) => h("option", { value: deg, selected: deg === (item.r || 0) }, `${deg}°`)),
      )),
    ),
    h("button", { class: "danger", type: "button", onclick: () => deleteItem(item) }, "Delete from map"),
  );
}

function addItem(kind, text) {
  const center = viewCenter();
  const item = {
    id: `m${Date.now()}`,
    k: kind,
    t: text || (kind === "person" ? "New person" : `New ${KINDS[kind].label.toLowerCase()}`),
    x: Math.round(center.x * 10) / 10,
    y: Math.round(center.y * 10) / 10,
    s: 4,
    r: 0,
    loc: "",
  };
  items.push(item);
  index = null;
  renderItem(item);
  selectItem(item, false);
  save();
}

function deleteItem(item) {
  if (!confirm(`Remove "${item.t}" from the floor plan?`)) return;
  items = items.filter((other) => other !== item);
  nodes.get(item.id)?.remove();
  nodes.delete(item.id);
  index = null;
  selection = null;
  updateRing();
  renderDetails();
  save();
}

/* ---------- global search ---------- */

const searchInput = $("#global-search");
const resultsList = $("#search-results");
let results = [];
let activeResult = -1;

function runSearch() {
  const query = searchInput.value.trim().toLowerCase();
  results = [];
  if (!query) return renderResults();
  const idx = getIndex();
  const seenAssignees = new Set();

  for (const item of items) {
    if (!["person", "room", "seat", "printer", "ap", "kiosk"].includes(item.k)) continue;
    const assignee = assigneeFor(item);
    const hay = `${item.t} ${assignee || ""} ${item.loc || ""}`.toLowerCase();
    if (!hay.includes(query)) continue;
    if (assignee) seenAssignees.add(assignee);
    results.push({
      title: item.t,
      sub: `${KINDS[item.k].label} on the floor plan`,
      run: () => selectItem(item, true),
      rank: item.k === "person" ? 0 : 1,
    });
  }
  for (const name of idx.assetsByAssignee.keys()) {
    if (seenAssignees.has(name) || !name.toLowerCase().includes(query)) continue;
    if ((idx.itemsByAssignee.get(name) || []).length) continue;
    results.push({ title: name, sub: "Has assets · not on the floor plan", run: () => selectAssignee(name), rank: 2 });
  }
  const tagMatches = assets.filter((a) => a.tag && a.tag.toLowerCase().startsWith(query)).slice(0, 4);
  for (const asset of tagMatches) {
    results.push({
      title: `${asset.tag} · ${asset.type}`,
      sub: `Asset · ${asset.assignee || "Unassigned"}`,
      run: () => focusAsset(asset.tag),
      rank: 3,
    });
  }
  results.sort((a, b) => a.rank - b.rank);
  results = results.slice(0, 14);
  activeResult = results.length ? 0 : -1;
  renderResults();
}

function renderResults() {
  resultsList.replaceChildren();
  resultsList.hidden = !searchInput.value.trim();
  if (!results.length) {
    if (!resultsList.hidden) resultsList.append(h("li", {}, "No matches"));
    return;
  }
  results.forEach((result, position) => {
    resultsList.append(
      h("li", {
        "aria-selected": position === activeResult ? "true" : "false",
        onmousedown: (event) => { event.preventDefault(); chooseResult(position); },
      }, result.title, h("small", {}, result.sub)),
    );
  });
}

function chooseResult(position) {
  const result = results[position];
  if (!result) return;
  result.run();
  resultsList.hidden = true;
  searchInput.blur();
}

searchInput.addEventListener("input", runSearch);
searchInput.addEventListener("focus", runSearch);
searchInput.addEventListener("blur", () => { resultsList.hidden = true; });
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!results.length) return;
    activeResult = (activeResult + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
    renderResults();
  } else if (event.key === "Enter") {
    chooseResult(Math.max(activeResult, 0));
  } else if (event.key === "Escape") {
    searchInput.value = "";
    resultsList.hidden = true;
  }
});

/* ---------- assets table ---------- */

const rowsBody = $("#asset-rows");

function statusOf(asset) {
  if (asset.assignee === "Storage") return "storage";
  return asset.assignee ? "assigned" : "unassigned";
}

function filteredAssets() {
  const query = $("#asset-search").value.trim().toLowerCase();
  const type = $("#asset-type-filter").value;
  const status = $("#asset-status-filter").value;
  const list = assets.filter((asset) => {
    if (type && asset.type !== type) return false;
    if (status && statusOf(asset) !== status) return false;
    if (!query) return true;
    return `${asset.tag} ${asset.type} ${asset.assignee} ${asset.model} ${asset.serial}`.toLowerCase().includes(query);
  });
  const { key, dir } = assetSort;
  return list.sort((a, b) => dir * String(a[key] || "").localeCompare(String(b[key] || ""), undefined, { numeric: true }));
}

function refreshOptionLists() {
  const types = [...new Set(assets.map((a) => a.type).filter(Boolean))].sort();
  const counts = new Map();
  for (const asset of assets) counts.set(asset.type, (counts.get(asset.type) || 0) + 1);
  const filter = $("#asset-type-filter");
  const current = filter.value;
  filter.replaceChildren(
    h("option", { value: "" }, "All types"),
    ...types.map((type) => h("option", { value: type, selected: type === current }, `${type} (${counts.get(type)})`)),
  );
  $("#type-options").replaceChildren(...types.map((type) => h("option", { value: type })));
  const names = [...new Set(assets.map((a) => a.assignee).filter(Boolean))].sort();
  const assignees = [...new Set(["Storage", ...names, ...items.filter((i) => i.k === "person").map((i) => i.t)])];
  $("#assignee-options").replaceChildren(...assignees.map((name) => h("option", { value: name })));
}

function assigneeCell(asset) {
  if (editMode) {
    return h("input", {
      value: asset.assignee,
      list: "assignee-options",
      placeholder: "Unassigned",
      "aria-label": `Assigned to for ${asset.tag}`,
      onchange: (event) => updateAsset(asset, "assignee", event.target.value.trim()),
    });
  }
  if (asset.assignee === "Storage") return h("span", { class: "storage", title: asset.location || "Storage" }, "Storage");
  if (!asset.assignee) return h("span", { class: "unassigned" }, "Unassigned");
  return asset.assignee;
}

function renderAssets() {
  refreshOptionLists();
  const list = filteredAssets();
  const visible = list.slice(0, assetPage * PAGE_SIZE);
  $("#asset-count").textContent = `${list.length.toLocaleString()} of ${assets.length.toLocaleString()} assets`;
  $("#more-assets").hidden = visible.length >= list.length;
  $("#more-assets").textContent = `Show more (${(list.length - visible.length).toLocaleString()} left)`;

  const rows = visible.map((asset) => {
    const row = h("tr", { class: editMode ? "" : "row-link" });
    if (editMode) {
      row.append(
        h("td", { class: "tag" }, h("input", {
          value: asset.tag, "aria-label": "Asset tag",
          onchange: (event) => updateAsset(asset, "tag", event.target.value.trim()),
        })),
        h("td", {}, h("input", {
          value: asset.type, list: "type-options", "aria-label": `Type for ${asset.tag}`,
          onchange: (event) => updateAsset(asset, "type", event.target.value.trim()),
        })),
        h("td", {}, assigneeCell(asset)),
        h("td", {}, h("button", { type: "button", class: "danger", "aria-label": `Delete ${asset.tag}`, onclick: () => deleteAsset(asset) }, "✕")),
      );
    } else {
      row.title = asset.model ? `${asset.model}${asset.serial ? ` · S/N ${asset.serial}` : ""}` : "";
      row.addEventListener("click", () => {
        if (asset.assignee && asset.assignee !== "Storage") locateAssignee(asset.assignee);
      });
      row.append(
        h("td", { class: "tag" }, asset.tag),
        h("td", {}, asset.type),
        h("td", {}, assigneeCell(asset)),
      );
    }
    return row;
  });
  rowsBody.replaceChildren(...rows);
}

function updateAsset(asset, key, value) {
  asset[key] = value;
  index = null;
  save();
  renderAssets();
  if (selection) renderDetails();
}

function deleteAsset(asset) {
  if (!confirm(`Delete asset ${asset.tag || "(no tag)"}?`)) return;
  assets = assets.filter((other) => other !== asset);
  index = null;
  save();
  renderAssets();
  if (selection) renderDetails();
}

function addAsset() {
  $("#asset-search").value = "";
  $("#asset-type-filter").value = "";
  $("#asset-status-filter").value = "";
  assets.unshift({ id: `a${Date.now()}`, tag: "", type: "", assignee: "", model: "", serial: "", location: "" });
  assetSort = { key: "none", dir: 1 };
  index = null;
  save();
  renderAssets();
  rowsBody.querySelector("input")?.focus();
}

function focusAsset(tag) {
  showTab("assets");
  $("#asset-search").value = tag;
  $("#asset-type-filter").value = "";
  $("#asset-status-filter").value = "";
  assetPage = 1;
  renderAssets();
}

/* ---------- ui wiring ---------- */

function showTab(name) {
  if ($(".workspace").classList.contains("expanded")) {
    $(".workspace").classList.remove("expanded");
    $("#expand-map").setAttribute("aria-pressed", "false");
    $("#expand-map").textContent = "Expand map";
    requestAnimationFrame(updateRing);
  }
  for (const button of document.querySelectorAll("[data-tab]")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === name));
  }
  $("#panel-details").hidden = name !== "details";
  $("#panel-assets").hidden = name !== "assets";
}

function setEditMode(on) {
  if (on && layoutEdit) setLayoutEdit(false);
  editMode = on;
  document.body.classList.toggle("editing", on);
  const toggle = $("#edit-toggle");
  toggle.setAttribute("aria-pressed", String(on));
  toggle.textContent = `Edit mode: ${on ? "on" : "off"}`;
  renderDetails();
  renderAssets();
}

function setLayoutEdit(on) {
  if (on && editMode) setEditMode(false);
  layoutEdit = on;
  svg.classList.toggle("layout-edit", on);
  $("#layout-toggle").setAttribute("aria-pressed", String(on));
  $("#layout-toggle").textContent = `Layout edit: ${on ? "on" : "off"}`;
  $("#layout-tools").hidden = !on;
  $("#layout-hint").hidden = !on;
  if (!on) selectShape(null);
  if (on) setStatus("The linework is an approximate trace, split into editable fragments. Compare it with the original reference.");
}

function wire() {
  $("#edit-toggle").addEventListener("click", () => setEditMode(!editMode));
  $("#layout-toggle").addEventListener("click", () => setLayoutEdit(!layoutEdit));
  $("#delete-shape").addEventListener("click", deleteShape);
  $("#undo-layout").addEventListener("click", undoLayout);
  $("#layout-tool").addEventListener("change", () => selectShape(null));
  $("#show-reference").addEventListener("change", (event) => {
    $("#map-bg").toggleAttribute("hidden", !event.target.checked);
  });
  $("#export-svg").addEventListener("click", exportSvg);
  $("#expand-map").addEventListener("click", (event) => {
    const expanded = $(".workspace").classList.toggle("expanded");
    event.target.setAttribute("aria-pressed", String(expanded));
    event.target.textContent = expanded ? "Show details" : "Expand map";
    requestAnimationFrame(updateRing);
  });
  $("#export-json").addEventListener("click", exportJson);
  $("#export-csv").addEventListener("click", exportCsv);
  $("#reset-data").addEventListener("click", resetData);
  $("#import-json").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) importJson(file);
    event.target.value = "";
  });
  $("#zoom-in").addEventListener("click", () => zoomAt(0.7));
  $("#zoom-out").addEventListener("click", () => zoomAt(1.4));
  $("#zoom-fit").addEventListener("click", fitView);
  $("#text-scale").addEventListener("input", (event) => {
    document.documentElement.style.setProperty("--text-scale", event.target.value);
    for (const item of items) renderItem(item);
  });
  for (const box of document.querySelectorAll("[data-layer]")) {
    box.addEventListener("change", () => svg.classList.toggle(`hide-${box.dataset.layer}`, !box.checked));
  }
  for (const button of document.querySelectorAll("[data-tab]")) {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  }
  $("#add-kind").replaceChildren(
    ...Object.entries(KINDS).map(([value, kind]) => h("option", { value }, kind.label)),
  );
  $("#add-item").addEventListener("click", () => addItem($("#add-kind").value));
  $("#add-asset").addEventListener("click", addAsset);
  $("#more-assets").addEventListener("click", () => { assetPage += 1; renderAssets(); });
  for (const id of ["#asset-search", "#asset-type-filter", "#asset-status-filter"]) {
    $(id).addEventListener("input", () => { assetPage = 1; renderAssets(); });
  }
  for (const button of document.querySelectorAll("[data-sort]")) {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      assetSort = { key, dir: assetSort.key === key ? -assetSort.dir : 1 };
      renderAssets();
    });
  }
  document.addEventListener("keydown", (event) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if (event.key === "Escape" && !typing) selectItem(null, false);
    if (event.key === "Delete" && layoutEdit && !typing && selectedShape) deleteShape();
    else if (event.key === "Delete" && editMode && !typing && selection?.type === "item") {
      const item = findItem(selection.id);
      if (item) deleteItem(item);
    }
  });
  window.addEventListener("resize", updateRing);
}

async function init() {
  wire();
  try {
    const [planResponse, assetsResponse, geometryResponse] = await Promise.all([
      fetch("data/floorplan.json"),
      fetch("data/assets.json"),
      fetch("data/floorplan-geometry.json"),
    ]);
    if (!planResponse.ok || !assetsResponse.ok || !geometryResponse.ok) throw new Error("data files missing");
    const planData = await planResponse.json();
    const assetData = await assetsResponse.json();
    const geometryData = await geometryResponse.json();
    if (!validData({ items: planData.items, assets: assetData, geometry: geometryData })) {
      throw new Error("invalid data files");
    }
    plan = { width: planData.width, height: planData.height, noteMasks: planData.noteMasks || [] };
    baseSnapshot = { items: planData.items, assets: assetData, geometry: geometryData };
    items = structuredClone(planData.items);
    assets = structuredClone(assetData);
    geometry = structuredClone(geometryData);
    let restored = false;
    let upgraded = false;
    let storageError = false;
    try {
      let saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && validData(saved)) {
        upgraded = (saved.version ?? 0) < 3;
        saved = upgradeData(saved);
        items = saved.items;
        assets = saved.assets;
        if (saved.geometry) geometry = saved.geometry;
        restored = true;
      } else if (saved) {
        storageError = true;
      }
    } catch {
      storageError = true;
    }
    fitView();
    renderGeometry();
    renderNoteMasks();
    renderAllItems();
    renderDetails();
    renderAssets();
    if (storageError) setStatus("Could not read saved edits in this browser. The original data is shown; export a backup before making changes.");
    else if (upgraded) {
      if (saveNow()) setStatus("Your saved edits were kept and updated with the BP links and reconstructed notes.");
    } else if (restored) setStatus("Showing your saved edits from this browser. Reset (in Edit mode) restores the original data.");
  } catch (error) {
    setStatus(`${error.message}. Serve this folder over HTTP (python3 -m http.server 8000) and keep the data/ folder beside index.html.`);
  }
}

init();
