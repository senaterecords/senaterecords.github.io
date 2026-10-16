// A spreadsheet file (.csv) made in the browser, for Excel, Numbers or Google Sheets. Nothing is stored.

type Cell = string | number | null | undefined;

const LIMIT = 32_000; // Excel holds at most 32,767 characters in a cell

function cell(value: Cell): string {
  if (value == null) return "";
  let text = String(value);
  if (text.length > LIMIT) text = `${text.slice(0, LIMIT - 1)}…`;
  // A cell starting with =, + or @ would run as a formula when the file is opened.
  if (/^[=+@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows as CSV, starting with the byte-order mark Excel needs to read accented names, rows ending in Windows line ends. */
export const csv = (rows: Cell[][]): string => `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
