// "Export remarks" on a senator's page: the recent remarks and every transcript as a Word document, or the transcripts
// as a spreadsheet. Made in the browser from the data the page carries; nothing is stored.
import { download } from "../lib/download";
import { DOCX_TYPE, docx } from "../lib/docx";
import { senatorBlocks, senatorCsv, type SenatorExport as SenatorData } from "../lib/exports";
import { ExportButton } from "./ExportButton";

const data = (): SenatorData => JSON.parse(document.getElementById("senator-data")!.textContent!);
const abs = (href: string) => new URL(href, location.href).href;

export default function SenatorExport() {
  return (
    <ExportButton label="Export remarks" choices={[
      { label: "Word document", hint: ".docx", pick: () => {
        const d = data();
        download(`${d.slug}-remarks.docx`, docx(senatorBlocks(d, location.href.split("#")[0], abs)), DOCX_TYPE);
      } },
      { label: "Spreadsheet of transcripts", hint: ".csv for Excel", pick: () => {
        const d = data();
        download(`${d.slug}-transcripts.csv`, senatorCsv(d, abs), "text/csv");
      } },
    ]} />
  );
}
