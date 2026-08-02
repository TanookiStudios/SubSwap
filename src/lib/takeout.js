// Google Takeout exports subscriptions as a CSV with the columns
// "Channel Id, Channel Url, Channel Title". Accepting that format means any
// export you already have works here without re-scraping.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  const src = String(text).replace(/^\ufeff/, "");
  for (let i = 0; i < src.length; i++) {
    const char = src[i];
    if (quoted) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") endField();
    else if (char === "\n") endRow();
    else if (char === "\r") continue;
    else field += char;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

// Header names have varied a little between Takeout versions, so match loosely
// rather than assuming a fixed column order.
function columnIndexes(header) {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
  return {
    id: norm.findIndex((h) => h === "channelid" || h === "id"),
    url: norm.findIndex((h) => h === "channelurl" || h === "url"),
    title: norm.findIndex((h) => h === "channeltitle" || h === "title" || h === "name"),
  };
}

export function parseTakeoutCsv(text) {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length === 0) return [];

  let columns = columnIndexes(rows[0]);
  let start = 1;
  // No recognisable header? Fall back to Takeout's documented column order.
  if (columns.id < 0 && columns.url < 0 && columns.title < 0) {
    columns = { id: 0, url: 1, title: 2 };
    start = 0;
  }

  const out = [];
  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const channelId = columns.id >= 0 ? (row[columns.id] || "").trim() : "";
    const url = columns.url >= 0 ? (row[columns.url] || "").trim() : "";
    const title = columns.title >= 0 ? (row[columns.title] || "").trim() : "";
    if (!channelId && !url) continue;
    out.push({ channelId, url, title });
  }
  return out;
}
