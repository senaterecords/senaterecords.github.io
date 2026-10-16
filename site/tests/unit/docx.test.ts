import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { docx } from "../../src/lib/docx";

/** The files in a zip written without compression, checked against their stored checksums. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    expect(crc32(data) >>> 0, name).toBe(crc);
    files.set(name, new TextDecoder().decode(data));
    at += 46 + nameLength + extra;
  }
  return files;
}

describe("a Word document made in the browser", () => {
  it("holds the parts Word needs, each intact", () => {
    const files = unzip(docx([{ kind: "title", text: "Regular Session" }]));
    expect([...files.keys()].sort()).toEqual(
      ["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml"]);
    expect(files.get("[Content_Types].xml")).toContain("wordprocessingml.document.main+xml");
    expect(files.get("word/document.xml")).toContain('<w:pStyle w:val="Title"/>');
  });

  it("writes text safely, with bold speaker names and links that open", () => {
    const files = unzip(docx([
      { kind: "para", runs: [{ text: "SENATOR KRUEGER: ", bold: true }, { text: 'Tolls & fares <rise> "now"' }] },
      { kind: "para", runs: [{ text: "Read it here", link: "https://senaterecords.github.io/transcripts/x/?a=1&b=2" }] },
    ]));
    const doc = files.get("word/document.xml")!;
    expect(doc).toContain("<w:b/>");
    expect(doc).toContain("Tolls &amp; fares &lt;rise&gt; &quot;now&quot;");
    expect(doc).toMatch(/<w:hyperlink r:id="(rId\d+)">/);
    const id = doc.match(/<w:hyperlink r:id="(rId\d+)">/)![1];
    expect(files.get("word/_rels/document.xml.rels")).toContain(
      `Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://senaterecords.github.io/transcripts/x/?a=1&amp;b=2" TargetMode="External"`);
  });

  it("leaves out characters XML can't hold, so the file always opens", () => {
    const doc = unzip(docx([{ kind: "para", runs: [{ text: "a\u0001b\u000Bc\uFFFEd" }] }])).get("word/document.xml")!;
    expect(doc).toContain(">abcd<");
  });

  it("keeps spaces at the edges of a run", () => {
    const doc = unzip(docx([{ kind: "para", runs: [{ text: "SENATOR X: ", bold: true }, { text: "Thank you." }] }])).get("word/document.xml")!;
    expect(doc).toContain('<w:t xml:space="preserve">SENATOR X: </w:t>');
  });
});
