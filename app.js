const csvPath = "Assets_20261109_112156.csv";
const searchInput = document.querySelector("#asset-search");
const locationFilter = document.querySelector("#location-filter");
const clearFiltersButton = document.querySelector("#clear-filters");
const assetRows = document.querySelector("#asset-rows");
const resultCount = document.querySelector("#result-count");
const loadError = document.querySelector("#load-error");

let assets = [];

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field === "") {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);

  const headers = rows.shift();
  if (!headers) throw new Error("The asset CSV is empty.");
  headers[0] = headers[0].replace(/^\uFEFF/, "");

  return rows.map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ""]),
  ));
}

function displayValue(value) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function createCell(value) {
  const cell = document.createElement("td");
  cell.textContent = displayValue(value) || "—";
  return cell;
}

function renderAssets() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const selectedLocation = locationFilter.value;
  const filteredAssets = assets.filter((asset) => {
    if (selectedLocation && displayValue(asset.Location) !== selectedLocation) return false;
    if (!query) return true;

    return [
      asset["Asset Tag"],
      asset["Asset Description"],
      asset["Asset Type"],
      asset.Location,
      asset.Condition,
      asset["Department Code"],
      asset["Serial Number"],
      asset.Manufacturer,
      asset.Model,
      asset["Category Name"],
      asset.Assignee,
    ].some((value) => displayValue(value).toLocaleLowerCase().includes(query));
  });

  const fragment = document.createDocumentFragment();
  for (const asset of filteredAssets) {
    const row = document.createElement("tr");
    for (const value of [
      asset["Asset Tag"],
      asset["Asset Description"],
      asset["Asset Type"],
      asset.Location,
      asset.Condition,
      asset.Assignee,
    ]) {
      row.append(createCell(value));
    }
    fragment.append(row);
  }

  assetRows.replaceChildren(fragment);
  resultCount.textContent = `Showing ${filteredAssets.length.toLocaleString()} of ${assets.length.toLocaleString()} assets`;
  if (filteredAssets.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 6;
    emptyCell.textContent = "No assets match these filters.";
    emptyRow.append(emptyCell);
    assetRows.append(emptyRow);
  }
}

function populateLocations() {
  const locations = [...new Set(
    assets.map((asset) => displayValue(asset.Location)).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b));

  for (const location of locations) {
    const option = document.createElement("option");
    option.value = location;
    option.textContent = location;
    locationFilter.append(option);
  }
}

searchInput.addEventListener("input", renderAssets);
locationFilter.addEventListener("change", renderAssets);
clearFiltersButton.addEventListener("click", () => {
  searchInput.value = "";
  locationFilter.value = "";
  renderAssets();
  searchInput.focus();
});

fetch(csvPath)
  .then((response) => {
    if (!response.ok) throw new Error(`Could not load the asset CSV (${response.status}).`);
    return response.text();
  })
  .then((text) => {
    assets = parseCSV(text);
    populateLocations();
    renderAssets();
  })
  .catch((error) => {
    resultCount.textContent = "Assets could not be loaded.";
    loadError.textContent = `${error.message} Serve this folder over HTTP and keep the CSV beside the application files.`;
    loadError.hidden = false;
  });
