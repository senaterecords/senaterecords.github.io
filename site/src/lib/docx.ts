// A Word document (.docx) made in the browser, with no library: a few XML files in a zip stored without compression.
// It opens in Word, Google Docs, Pages and LibreOffice. Nothing is stored.

export interface Run { text: string; bold?: boolean; italic?: boolean; link?: string; }
/** A paragraph: the title, a heading, a small grey line (dates, sources), a page mark ("p. 113"), or body text. */
export interface Block { kind: "title" | "heading" | "meta" | "page" | "para"; text?: string; runs?: Run[]; }

const STYLE: Record<Block["kind"], string | null> = { title: "Title", heading: "Heading1", meta: "Meta", page: "PageMark", para: null };
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// XML 1.0 can't hold control characters or the non-characters U+FFFE and U+FFFF: a document with one won't open.
// (A lone surrogate never reaches the file: encoding to UTF-8 turns it into U+FFFD.)
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const xml = (s: string) => s.replace(UNSAFE, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const STYLES = `${HEAD}<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia" w:eastAsia="Georgia"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Meta"><w:name w:val="Meta"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:color w:val="5B6470"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="PageMark"><w:name w:val="Page mark"/><w:basedOn w:val="Meta"/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="80"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0B6B50"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

const TYPES = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`;

/** A run of text; line breaks inside it become line breaks in Word. */
function run(r: Run): string {
  const props = `${r.link ? '<w:rStyle w:val="Hyperlink"/>' : ""}${r.bold ? "<w:b/>" : ""}${r.italic ? "<w:i/>" : ""}`;
  const text = r.text.split("\n").map((part) => `<w:t xml:space="preserve">${xml(part)}</w:t>`).join("<w:br/>");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${text}</w:r>`;
}

/** The document's files: its paragraphs, styles and the relationships that make its links open. */
function parts(blocks: Block[]): [string, string][] {
  const links: string[] = [];
  const body = blocks.map((b) => {
    const style = STYLE[b.kind];
    const runs = (b.runs ?? [{ text: b.text ?? "" }]).map((r) => {
      if (!r.link) return run(r);
      links.push(r.link);
      return `<w:hyperlink r:id="rId${links.length + 1}">${run(r)}</w:hyperlink>`;
    }).join("");
    return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${runs}</w:p>`;
  }).join("\n");
  const page = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  const document = `${HEAD}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>\n${body}\n${page}</w:body></w:document>`;
  const rels = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>${
    links.map((href, i) => `<Relationship Id="rId${i + 2}" Type="${REL}/hyperlink" Target="${xml(href)}" TargetMode="External"/>`).join("")}</Relationships>`;
  return [["[Content_Types].xml", TYPES], ["_rels/.rels", ROOT_RELS], ["word/document.xml", document], ["word/_rels/document.xml.rels", rels], ["word/styles.xml", STYLES]];
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data: Uint8Array) => {
  let c = 0xffffffff;
  for (const byte of data) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Files in a zip, stored as they are (no compression), with their checksums. */
function zip(files: [string, string][]): Uint8Array {
  const encode = new TextEncoder();
  const entries = files.map(([name, text]) => ({ name: encode.encode(name), data: encode.encode(text) }));
  const size = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length + 46 + e.name.length, 22);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  const DATE = (0 << 9) | (1 << 5) | 1; // 1 January 1980, the earliest date a zip can hold
  let at = 0;
  const offsets: number[] = [];
  const header = (e: (typeof entries)[number], crc: number, central: boolean) => {
    view.setUint32(at, central ? 0x02014b50 : 0x04034b50, true); at += 4;
    if (central) { view.setUint16(at, 20, true); at += 2; } // made by
    view.setUint16(at, 20, true); view.setUint16(at + 2, 0, true); view.setUint16(at + 4, 0, true); // version, flags, stored
    view.setUint16(at + 6, 0, true); view.setUint16(at + 8, DATE, true); view.setUint32(at + 10, crc, true);
    view.setUint32(at + 14, e.data.length, true); view.setUint32(at + 18, e.data.length, true);
    view.setUint16(at + 22, e.name.length, true); view.setUint16(at + 24, 0, true); at += 26;
    if (central) { at += 10; view.setUint32(at, offsets.shift()!, true); at += 4; } // comment length, disk, attributes; offset
    out.set(e.name, at); at += e.name.length;
  };
  const crcs = entries.map((e) => crc32(e.data));
  const starts: number[] = [];
  entries.forEach((e, i) => { starts.push(at); header(e, crcs[i], false); out.set(e.data, at); at += e.data.length; });
  const central = at;
  offsets.push(...starts);
  entries.forEach((e, i) => header(e, crcs[i], true));
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true); view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - central, true); view.setUint32(at + 16, central, true);
  return out;
}

/** A Word document holding the blocks, as the bytes of a .docx file. */
export const docx = (blocks: Block[]): Uint8Array => zip(parts(blocks));

export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
