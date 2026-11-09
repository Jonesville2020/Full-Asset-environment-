"use strict";

const $ = selector => document.querySelector(selector);
let data = { locations: [], people: [], assets: [] };
let waspCsv = "";
const fields = {
  tag: ["asset tag", "asset number", "asset id", "tag", "asset tag number"],
  name: ["asset name", "name", "item name"],
  description: ["description", "asset description"],
  serial: ["serial", "serial number"],
  person: ["assigned to", "person", "employee", "checked out to"],
  location: ["location", "space", "site"],
  status: ["status", "asset status"]
};

function message(value) { $("#message").textContent = value; }
async function post(path, value) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
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
async function remove(kind, record) {
  if (!confirm(`Delete ${record.name || record.tag}? This cannot be undone.`)) return;
  await post("/api/delete", { kind, id: record.id });
  await refresh();
}
function renderMap() {
  const img = $("#floor-image");
  if (data.floorplan) img.src = data.floorplan; else img.removeAttribute("src");
  $("#empty-map").hidden = !!data.floorplan;
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
    zone.addEventListener("pointerup", event => {
      if (!start) return;
      const moved = start.moved;
      start = null;
      if (moved) {
        run(async () => {
          await post("/api/locations", { ...location, x: parseFloat(zone.style.left), y: parseFloat(zone.style.top) });
          await refresh();
        });
      } else {
        editForm($("#location-form"), location, "location");
      }
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
    const location = data.locations.find(location => location.id === row.location_id);
    item(people, row.name, location ? location.name : "No space assigned",
      () => editForm($("#person-form"), row, "person"), () => run(() => remove("people", row)));
  }
  renderAssets();
}
function renderAssets() {
  const list = $("#asset-list");
  list.replaceChildren();
  const search = $("#asset-search").value.trim().toLowerCase();
  const rows = data.assets.filter(row => [row.tag, row.name, row.description, row.serial, row.status, row.person, row.location].some(value => String(value || "").toLowerCase().includes(search)));
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
async function refresh() {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("Unable to load inventory.");
  data = await response.json();
  render();
}
for (const [name, endpoint] of [["location", "locations"], ["person", "people"], ["asset", "assets"]]) {
  const form = $(`#${name}-form`);
  form.addEventListener("submit", event => {
    event.preventDefault();
    run(async () => {
      await post(`/api/${endpoint}`, Object.fromEntries(new FormData(form)));
      resetForm(form, name);
      await refresh();
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
  const image = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
  await post("/api/floorplan", { image });
  event.target.value = "";
  await refresh();
}));
$("#clear-floor").addEventListener("click", () => run(async () => {
  if (!confirm("Remove the background image? Spaces will be kept.")) return;
  await post("/api/floorplan", { image: "" });
  await refresh();
}));
$("#wasp-file").addEventListener("change", event => run(async () => {
  waspCsv = "";
  $("#mapping").hidden = true;
  $("#comparison").replaceChildren();
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) throw new Error("CSV must be 10 MB or smaller.");
  const content = await file.text();
  const { headers } = await post("/api/wasp/headers", { csv: content });
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
async function waspAction(importing) {
  if (importing && !confirm("Import only new WASP tags? Existing assets will not be changed.")) return;
  const mapping = Object.fromEntries([...$("#mapping-fields").querySelectorAll("select")].map(select => [select.name, select.value]));
  const response = await post(`/api/wasp/${importing ? "import" : "compare"}`, { csv: waspCsv, mapping });
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
  if (importing) await refresh();
}
$("#compare").addEventListener("click", () => run(() => waspAction(false)));
$("#import").addEventListener("click", () => run(() => waspAction(true)));
run(refresh);
