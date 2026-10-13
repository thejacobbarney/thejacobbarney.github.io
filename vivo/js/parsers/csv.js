/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes
 * ("" inside a quoted field), commas/newlines inside quotes, and both
 * \n and \r\n line endings. No external dependency — wearable exports are
 * small enough (thousands of rows at most) that a hand-rolled parser is
 * fine and keeps this a zero-build, zero-vendor-file project like Iceberg.
 *
 * Returns { headers: string[], rows: string[][] }.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  function pushField() {
    row.push(field);
    field = '';
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      pushField();
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Trailing field/row (file may or may not end with a newline).
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const [headers, ...dataRows] = nonEmpty;
  return { headers: headers.map((h) => h.trim()), rows: dataRows };
}
