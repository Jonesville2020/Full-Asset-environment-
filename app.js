"use strict";

const $ = selector => document.querySelector(selector);
const STORAGE_NAME = "floorplan-inventory";
const STATUSES = ["unverified", "available", "in use", "repair", "retired"];
const FIELDS = ["tag", "name", "description", "serial", "person", "location", "status"];
const fields = {
  tag: ["asset tag", "asset number", "asset id", "tag", "asset tag number"],
  name: ["asset name", "name", "item name"],
  description: ["description", "asset description"],
  serial: ["serial", "serial number"],
  person: ["assigned to", "person", "employee", "checked out to"],
  location: ["location", "space", "site"],
  status: ["status", "asset status"]
};
let data = { floorplan: "", locations: [], people: [], assets: [] };
let waspCsv = "";
let floorplanObjectUrl = "";

function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STORAGE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("inventory", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Your browser could not open local storage."));
  });
}
async function loadData() {
  const db = await openStorage();
  const saved = await new Promise((resolve, reject) => {
    const request = db.transaction("inventory").objectStore("inventory").get("state");
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(new Error("Could not read the saved inventory."));
  });
  if (saved) data = saved;
  render();
}
async function persist() {
  const db = await openStorage();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("inventory", "readwrite");
    transaction.objectStore("inventory").put({ key: "state", value: data });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(new Error("Could not save your changes. Export a backup and check your browser's storage settings."));
    transaction.onabort = () => reject(new Error("Could not save your changes. Export a backup and check your browser's storage settings."));
  });
}
function message(value) { $("#message").textContent = value; }
async function run(action) {
  try { message(""); await action(); } catch (error) { message(error.message); }
}
function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}
function options(select, rows, empty) {
  const selected = select.value;
  select.replaceChildren(new Option(empty, ""));
  for (const row of rows) select.add(new Option(row.name, row.id));
  select.value = rows.some(row => String(row.id) === selected) ? selected : "";
}
function item(container, title, detail, edit, remove) {
  const node = element("div", undefined, "item");
  node.append(element("strong", title), element("p", detail));
  const editButton = element("button", "Edit", "secondary");
  editButton.type = "button";
  editButton.addEventListener("click", edit);
  const deleteButton = element("button", "Delete", "danger");
  deleteButton.type = "button";
  deleteButton.addEventListener("click", remove);
  node.append(editButton, deleteButton);
  container.append(node);
}
function editForm(form, record, title) {
  for (const [key, value] of Object.entries(record)) {
    if (form.elements[key]) form.elements[key].value = value ?? "";
  }
  $(`#${title}-title`).textContent = `Edit ${title === "location" ? "space" : title}`;
  if (title === "asset") updateAssetLocation();
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}
function resetForm(form, title) {
  form.reset();
  form.elements.id.value = "";
  $(`#${title}-title`).textContent = `Add ${title === "location" ? "a space" : title === "asset" ? "an asset" : "a person"}`;
  if (title === "asset") updateAssetLocation();
}
function byId(rows, value) {
  return rows.find(row => String(row.id) === String(value)) || null;
}
function assetView(asset) {
  const person = byId(data.people, asset.person_id);
  const assignedLocation = person && byId(data.locations, person.location_id);
  const location = assignedLocation || byId(data.locations, asset.location_id);
  return { ...asset, person: person?.name || "", location: location?.name || "" };
}
function validateText(value, required = false) {
  const text = String(value || "").trim();
  if (text.length > 500 || (required && !text)) throw new Error("Required fields must be filled and text must be at most 500 characters.");
  return text;
}
function saveRecord(kind, values) {
  const current = values.id ? byId(data[kind], values.id) : null;
  if (values.id && !current) throw new Error("Record no longer exists.");
  let record;
  if (kind === "locations") {
    const name = validateText(values.name, true);
    const x = Number(values.x), y = Number(values.y), width = Number(values.width), height = Number(values.height);
    if (![x, y, width, height].every(Number.isFinite) || !(x >= 0 && x <= 100 && y >= 0 && y <= 100 && width > 0 && width <= 100 - x && height > 0 && height <= 100 - y)) {
      throw new Error("Location rectangles must fit within the floorplan.");
    }
    record = { name, x, y, width, height };
  } else if (kind === "people") {
    record = { name: validateText(values.name, true), location_id: values.location_id ? Number(values.location_id) : null };
    if (record.location_id && !byId(data.locations, record.location_id)) throw new Error("Select an existing space.");
  } else {
    const status = validateText(values.status, true);
    const person_id = values.person_id ? Number(values.person_id) : null;
    const location_id = values.location_id ? Number(values.location_id) : null;
    if (!STATUSES.includes(status)) throw new Error("Invalid asset status.");
    if (person_id && !byId(data.people, person_id)) throw new Error("Select an existing person.");
    if (location_id && !byId(data.locations, location_id)) throw new Error("Select an existing space.");
    if (person_id && status === "available") throw new Error("An assigned asset cannot be marked available.");
    record = {
      tag: validateText(values.tag, true), name: validateText(values.name, true),
      description: validateText(values.description), serial: validateText(values.serial),
      status, person_id, location_id: person_id ? null : location_id
    };
  }
  const nameKey = kind === "assets" ? "tag" : "name";
  if (data[kind].some(row => row.id !== current?.id && row[nameKey].trim().toLowerCase() === record[nameKey].toLowerCase())) {
    throw new Error(`${kind === "assets" ? "Asset tag" : "Name"} must be unique.`);
  }
  if (current) Object.assign(current, record);
  else data[kind].push({ id: Math.max(0, ...data[kind].map(row => Number(row.id) || 0)) + 1, ...record });
}
async function remove(kind, record) {
  if (!confirm(`Delete ${record.name || record.tag}? This cannot be undone.`)) return;
  if (kind === "locations" && (data.people.some(row => row.location_id === record.id) || data.assets.some(row => row.location_id === record.id))) {
    throw new Error("Reassign the people and assets in this space before deleting it.");
  }
  if (kind === "people" && data.assets.some(row => row.person_id === record.id)) {
    throw new Error("Reassign this person's assets before deleting them.");
  }
  data[kind] = data[kind].filter(row => row.id !== record.id);
  await persist();
  render();
}
function renderMap() {
  const img = $("#floor-image");
  if (floorplanObjectUrl) URL.revokeObjectURL(floorplanObjectUrl);
  const image = typeof data.floorplan === "string" && data.floorplan.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (image) {
    const bytes = Uint8Array.from(atob(image[2]), character => character.charCodeAt(0));
    floorplanObjectUrl = URL.createObjectURL(new Blob([bytes], { type: image[1] }));
    img.src = floorplanObjectUrl;
  } else {
    floorplanObjectUrl = "";
    img.removeAttribute("src");
  }
  $("#empty-map").hidden = !!image;
  const zones = $("#zones");
  zones.replaceChildren();
  for (const location of data.locations) {
    const occupants = data.people.filter(person => person.location_id === location.id).map(person => person.name);
    const zone = element("button", `${location.name}${occupants.length ? " — " + occupants.join(", ") : ""}`, "zone");
    zone.type = "button";
    zone.title = "Drag to move; click to edit";
    Object.assign(zone.style, { left: `${location.x}%`, top: `${location.y}%`, width: `${location.width}%`, height: `${location.height}%` });
    let start;
    zone.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY, left: location.x, top: location.y, moved: false };
      zone.setPointerCapture(event.pointerId);
    });
    zone.addEventListener("pointermove", event => {
      if (!start) return;
      const bounds = zones.getBoundingClientRect();
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) start.moved = true;
      const x = Math.max(0, Math.min(100 - location.width, start.left + dx / bounds.width * 100));
      const y = Math.max(0, Math.min(100 - location.height, start.top + dy / bounds.height * 100));
      zone.style.left = `${x}%`;
      zone.style.top = `${y}%`;
    });
    zone.addEventListener("pointerup", () => {
      if (!start) return;
      const moved = start.moved;
      start = null;
      if (moved) {
        run(async () => {
          saveRecord("locations", { ...location, x: parseFloat(zone.style.left), y: parseFloat(zone.style.top) });
          await persist();
          render();
        });
      } else editForm($("#location-form"), location, "location");
    });
    zone.addEventListener("pointercancel", () => { start = null; renderMap(); });
    zone.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        editForm($("#location-form"), location, "location");
      }
    });
    zones.append(zone);
  }
}
function render() {
  data.locations.sort((a, b) => a.name.localeCompare(b.name));
  data.people.sort((a, b) => a.name.localeCompare(b.name));
  data.assets.sort((a, b) => a.tag.localeCompare(b.tag));
  document.querySelectorAll(".location-select").forEach(select => options(select, data.locations, "No space"));
  options($("#asset-person"), data.people, "No person");
  updateAssetLocation();
  renderMap();
  const locations = $("#location-list");
  locations.replaceChildren();
  for (const row of data.locations) {
    item(locations, row.name, `${data.people.filter(person => person.location_id === row.id).length} people`,
      () => editForm($("#location-form"), row, "location"), () => run(() => remove("locations", row)));
  }
  const people = $("#person-list");
  people.replaceChildren();
  for (const row of data.people) {
    const location = byId(data.locations, row.location_id);
    item(people, row.name, location ? location.name : "No space assigned",
      () => editForm($("#person-form"), row, "person"), () => run(() => remove("people", row)));
  }
  renderAssets();
}
function renderAssets() {
  const list = $("#asset-list");
  list.replaceChildren();
  const search = $("#asset-search").value.trim().toLowerCase();
  const rows = data.assets.map(assetView).filter(row => [row.tag, row.name, row.description, row.serial, row.status, row.person, row.location].some(value => String(value || "").toLowerCase().includes(search)));
  $("#asset-count").textContent = `(${rows.length} of ${data.assets.length})`;
  for (const row of rows) {
    const detail = [row.description, row.serial && `Serial: ${row.serial}`, `Status: ${row.status}`, row.person && `Person: ${row.person}`, row.location ? `Space: ${row.location}` : "Space unknown"].filter(Boolean).join(" · ");
    item(list, `${row.tag} — ${row.name}`, detail,
      () => editForm($("#asset-form"), row, "asset"), () => run(() => remove("assets", row)));
  }
}
function updateAssetLocation() {
  $("#asset-location").disabled = !!$("#asset-person").value;
}
for (const [name, kind] of [["location", "locations"], ["person", "people"], ["asset", "assets"]]) {
  const form = $(`#${name}-form`);
  form.addEventListener("submit", event => {
    event.preventDefault();
    run(async () => {
      saveRecord(kind, Object.fromEntries(new FormData(form)));
      await persist();
      resetForm(form, name);
      render();
    });
  });
  form.querySelector(".reset").addEventListener("click", () => resetForm(form, name));
}
$("#asset-person").addEventListener("change", updateAssetLocation);
$("#asset-search").addEventListener("input", renderAssets);
$("#floor-file").addEventListener("change", event => run(async () => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024 || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG, GIF, or WebP image up to 10 MB.");
  data.floorplan = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
  await persist();
  event.target.value = "";
  render();
}));
$("#clear-floor").addEventListener("click", () => run(async () => {
  if (!confirm("Remove the background image? Spaces will be kept.")) return;
  data.floorplan = "";
  await persist();
  render();
}));
function parseCsv(content) {
  const rows = [];
  let row = [], cell = "", quoted = false, afterQuote = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (quoted) {
      if (char === '"' && content[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else cell += char;
    } else if (afterQuote && char !== "," && char !== "\r" && char !== "\n") {
      throw new Error("Invalid CSV: unexpected text after a quoted value.");
    } else if (char === '"' && !cell) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; afterQuote = false; }
    else if (char === "\n" || char === "\r") {
      row.push(cell); rows.push(row); row = []; cell = ""; afterQuote = false;
      if (char === "\r" && content[i + 1] === "\n") i++;
    } else cell += char;
  }
  if (quoted) throw new Error("Invalid CSV: unterminated quoted value.");
  if (cell || row.length || afterQuote) { row.push(cell); rows.push(row); }
  return rows;
}
function parseWaspCsv(content) {
  const rows = parseCsv(content.replace(/^\uFEFF/, ""));
  const headers = rows.shift() || [];
  if (!headers.length || headers.some(header => !header) || new Set(headers).size !== headers.length) {
    throw new Error("CSV column names must be non-empty and unique.");
  }
  for (const cells of rows) {
    if (cells.length > headers.length) throw new Error("A CSV row has more values than headers.");
  }
  return { headers, rows: rows.filter(cells => cells.some(value => value.trim())).map(cells => Object.fromEntries(headers.map((header, i) => [header, (cells[i] || "").trim()]))) };
}
$("#wasp-file").addEventListener("change", event => run(async () => {
  waspCsv = "";
  $("#mapping").hidden = true;
  $("#comparison").replaceChildren();
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) throw new Error("CSV must be 10 MB or smaller.");
  const content = await file.text();
  const { headers } = parseWaspCsv(content);
  waspCsv = content;
  const container = $("#mapping-fields");
  container.replaceChildren();
  for (const [field, aliases] of Object.entries(fields)) {
    const label = element("label", field === "tag" ? "Asset tag (required)" : field[0].toUpperCase() + field.slice(1));
    const select = element("select");
    select.name = field;
    select.add(new Option("Not mapped", ""));
    headers.forEach(header => select.add(new Option(header, header)));
    const match = headers.find(header => aliases.includes(header.trim().toLowerCase()));
    if (match) select.value = match;
    label.append(select);
    container.append(label);
  }
  $("#mapping").hidden = false;
}));
function compareWasp(importing, mapping) {
  if (!mapping.tag) throw new Error("Select the WASP asset tag column.");
  const rows = parseWaspCsv(waspCsv).rows.map(row => Object.fromEntries(FIELDS.map(field => [field, row[mapping[field]] || ""])));
  const local = new Map(data.assets.map(asset => [asset.tag.trim().toLowerCase(), assetView(asset)]));
  const people = new Map(data.people.map(person => [person.name.trim().toLowerCase(), person]));
  const locations = new Map(data.locations.map(location => [location.name.trim().toLowerCase(), location]));
  const counts = new Map();
  rows.forEach(row => { const tag = row.tag.toLowerCase(); if (tag) counts.set(tag, (counts.get(tag) || 0) + 1); });
  const seen = new Set(), results = [];
  let imported = 0;
  for (const row of rows) {
    const tag = row.tag.toLowerCase();
    if (!tag || counts.get(tag) > 1) {
      results.push({ tag: row.tag, result: "Missing or duplicate tag", differences: [] });
      if (tag) seen.add(tag);
      continue;
    }
    seen.add(tag);
    const asset = local.get(tag);
    if (asset) {
      const differences = FIELDS.slice(1).filter(field => mapping[field] && String(asset[field] || "").trim().toLowerCase() !== row[field].toLowerCase())
        .map(field => ({ field, local: asset[field] || "", wasp: row[field] }));
      results.push({ tag: row.tag, result: differences.length ? "Different" : "Match", differences });
    } else {
      let result = "Only in WASP";
      if (importing) {
        const person = row.person ? people.get(row.person.toLowerCase()) : null;
        const location = row.location ? locations.get(row.location.toLowerCase()) : null;
        const status = row.status ? row.status.toLowerCase() : "unverified";
        const conflict = (row.person && !person) || (row.location && !location) ||
          (person && location && person.location_id !== location.id) || !STATUSES.includes(status) ||
          (person && status === "available");
        if (conflict) result = "Not imported: unknown or conflicting person, location, or status";
        else {
          saveRecord("assets", {
            tag: row.tag, name: row.name || row.tag, description: row.description, serial: row.serial, status,
            person_id: person?.id || "", location_id: location?.id || ""
          });
          imported++;
          result = "Imported";
        }
      }
      results.push({ tag: row.tag, result, differences: [] });
    }
  }
  for (const [tag, asset] of local) {
    if (!seen.has(tag)) results.push({ tag: asset.tag, result: "Only in local inventory", differences: [] });
  }
  return { results, imported };
}
async function waspAction(importing) {
  if (importing && !confirm("Import only new WASP tags? Existing assets will not be changed.")) return;
  const mapping = Object.fromEntries([...$("#mapping-fields").querySelectorAll("select")].map(select => [select.name, select.value]));
  const response = compareWasp(importing, mapping);
  if (importing) await persist();
  const container = $("#comparison");
  container.replaceChildren(element("h3", importing ? `Imported ${response.imported} assets` : "Comparison results"));
  if (!response.results.length) container.append(element("p", "No assets found."));
  for (const result of response.results) {
    const node = element("div", undefined, "item");
    node.append(element("strong", `${result.tag || "(no tag)"} — ${result.result}`));
    for (const difference of result.differences) {
      node.append(element("p", `${difference.field}: local “${difference.local}” / WASP “${difference.wasp}”`, "difference"));
    }
    container.append(node);
  }
  if (importing) render();
}
$("#compare").addEventListener("click", () => run(() => waspAction(false)));
$("#import").addEventListener("click", () => run(() => waspAction(true)));
$("#export-data").addEventListener("click", () => run(async () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "floorplan-inventory-backup.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}));
$("#import-data").addEventListener("change", event => run(async () => {
  const file = event.target.files[0];
  if (!file) return;
  if (!confirm("Replace this browser's inventory with the selected backup? Export a backup first if you need to keep the current data.")) return;
  const backup = JSON.parse(await file.text());
  const image = backup?.floorplan || "";
  const records = ["locations", "people", "assets"].every(key =>
    Array.isArray(backup?.[key]) && backup[key].every(row => row && typeof row === "object" && !Array.isArray(row)));
  if (!backup || !records || typeof image !== "string" || image.length > 14 * 1024 * 1024 ||
      (image && !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))) {
    throw new Error("This is not a valid floorplan inventory backup.");
  }
  data = { floorplan: backup.floorplan || "", locations: backup.locations, people: backup.people, assets: backup.assets };
  await persist();
  render();
  message("Backup restored.");
  event.target.value = "";
}));
run(loadData);
