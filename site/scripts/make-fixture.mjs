// Make tests/fixtures/data-site from ../data/site: six real transcripts, one synthetic plain-text transcript
// (Review Focus 1), and the bills, senators, Assembly members, photos and words they refer to.
// Run it after rebuilding data/site; commit the result.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SRC = resolve(process.env.OTR_SOURCE ?? "../data/site");
const OUT = resolve("tests/fixtures/data-site");
const SLUGS = [
  "2025-03-04-regular-session",
  "1995-05-08-regular-session",
  "2009-06-23-extraordinary-session",
  "2013-11-01-regular-session",
  "2025-02-27-joint-legislative-hearing-in-the-matter-of-the-2025-2026-executive-budget-on-taxes",
  "2021-06-03-new-york-state-forum-a-roundtable-discussion-to-evaluate-the-states-response-to-covid-19",
];
const PLAIN = "1995-05-09-test-plain-text";

const read = (rel) => JSON.parse(readFileSync(join(SRC, rel), "utf-8"));
const write = (rel, data) => {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 1) + "\n");
};
const baseOf = (printNo) => printNo.match(/^[SA]\d+/)[0];

rmSync(OUT, { recursive: true, force: true });
const docs = SLUGS.map((slug) => read(`transcripts/${slug}.json`));
const model = docs[1];
docs.push({
  ...model, slug: PLAIN, date: "1995-05-09", plainText: true, coverage: 0.42, segments: [], unresolvedBillMentions: 0,
  turns: [{ i: 0, label: null, role: "record", senator: null, page: model.turns[0].page, breaks: [], bills: [],
            text: model.turns.slice(0, 12).map((t) => t.text).join("\n\n") }],
});
const keep = new Set(docs.map((d) => d.slug));
for (const doc of docs) write(`transcripts/${doc.slug}.json`, doc);

const index = read("transcripts.json").filter((t) => keep.has(t.slug));
index.push({ ...index.find((t) => t.slug === model.slug), slug: PLAIN, date: "1995-05-09", plainText: true, speakers: 0, billsDebated: 0 });
index.sort((a, b) => (b.date + b.slug).localeCompare(a.date + a.slug));
write("transcripts.json", index);

const wanted = new Map();
for (const doc of docs) {
  const set = wanted.get(doc.session) ?? new Set();
  wanted.set(doc.session, set);
  for (const t of doc.turns) for (const p of t.bills) set.add(baseOf(p));
  for (const s of doc.segments) if (s.printNo) set.add(baseOf(s.printNo));
}
let billCount = 0;
const billKeys = new Set();
for (const [session, set] of wanted) {
  const bills = read(`bills/${session}.json`).bills
    .filter((b) => set.has(b.basePrintNo))
    .map((b) => ({ ...b, segments: b.segments.filter((s) => keep.has(s.transcript)),
                   mentionedIn: b.mentionedIn.filter((m) => keep.has(m.transcript)) }));
  bills.forEach((b) => billKeys.add(`${session}/${b.basePrintNo}`));
  billCount += bills.length;
  write(`bills/${session}.json`, { session, bills });
}

const speaking = new Set();
const assemblySlugs = new Set();
for (const doc of docs) for (const t of doc.turns) {
  if (t.senator) speaking.add(t.senator);
  if (t.assembly) assemblySlugs.add(t.assembly);
}
write("senators.json", read("senators.json")); // every senator, so votes and sponsors resolve to names
let pages = 0;
for (const slug of speaking) {
  if (!existsSync(join(SRC, `senators/${slug}.json`))) continue;
  const page = read(`senators/${slug}.json`);
  page.appearances = page.appearances.filter((a) => keep.has(a.transcript));
  page.recent = page.recent.filter((r) => keep.has(r.transcript));
  page.bills = page.bills.filter((b) => billKeys.has(`${b.session}/${b.basePrintNo}`));
  page.totals = {
    remarks: page.appearances.reduce((n, a) => n + a.remarks, 0),
    presiding: page.appearances.reduce((n, a) => n + a.presiding, 0),
    transcripts: page.appearances.length,
  };
  write(`senators/${slug}.json`, page);
  pages += 1;
}
const assembly = read("assembly.json");
write("assembly.json", Object.fromEntries(Object.entries(assembly).filter(([slug]) => assemblySlugs.has(slug))));

const meta = read("meta.json");
meta.counts = { floorTranscripts: docs.filter((d) => d.kind === "floor").length,
                hearings: docs.filter((d) => d.kind === "hearing").length, senators: pages, bills: billCount };
write("meta.json", meta);
write("quality.json", read("quality.json"));
cpSync(join(SRC, "words"), join(OUT, "words"), { recursive: true });
if (existsSync(join(SRC, "photos"))) cpSync(join(SRC, "photos"), join(OUT, "photos"), { recursive: true });
console.log(`Fixture: ${docs.length} transcripts, ${billCount} bills, ${pages} senator pages, ${assemblySlugs.size} Assembly members`);
