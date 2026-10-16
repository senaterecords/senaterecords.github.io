// Per-transcript speaker card data, built at build time and embedded in the reader for the islands (spec 8.3).
// Each card says only what the record supports.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./data";
import { plural, serviceText } from "./format";
import type { AssemblyMember, SenatorIndexEntry, Transcript, Turn } from "./types";
import { url } from "./url";

export interface SpeakerInfo {
  key: string;
  kind: "senator" | "assembly" | "president" | "secretary";
  name: string;
  photo: string | null;
  line1: string;
  line2: string;
  url: string | null;
  officialUrl: string | null;
  /** Turn indices where this speaker spoke (senator, chair or Assembly roles). */
  remarks: number[];
  /** Turn indices where this speaker presided or read (presiding, President, Secretary). */
  presiding: number[];
}

export interface SpeakerContext {
  senatorsBySlug: Map<string, SenatorIndexEntry>;
  assembly: Record<string, AssemblyMember>;
  pageSlugs: Set<string>;
}

const SPOKEN = new Set(["senator", "chair", "assembly"]);

function photoUrl(photo: string | null): string | null {
  return photo && existsSync(join(DATA_DIR, photo)) ? url(photo) : null;
}

export function speakerData(doc: Transcript, ctx: SpeakerContext): { speakers: Record<string, SpeakerInfo>; keyOf: (t: Turn) => string | null } {
  const president = doc.officers.president;
  const secretary = doc.officers.secretary;

  const keyOf = (t: Turn): string | null => {
    if (t.senator && ctx.senatorsBySlug.has(t.senator)) return t.senator;
    if (t.assembly && ctx.assembly[t.assembly]) return `assembly:${t.assembly}`;
    if (t.role === "president" && president) return "president";
    if (t.role === "secretary") return "secretary";
    return null;
  };

  const speakers: Record<string, SpeakerInfo> = {};
  const session = String(doc.session);

  const info = (key: string, t: Turn): SpeakerInfo => {
    if (key === "president") {
      return {
        key, kind: "president", name: `Lt. Gov. ${president!.name}`, photo: null,
        line1: `Lieutenant Governor, ${president!.from ?? ""}–${president!.until ?? "present"}`.replace(/^Lieutenant Governor, –/, "Lieutenant Governor, "),
        line2: "As President of the Senate, presides when present.", url: null, officialUrl: null, remarks: [], presiding: [],
      };
    }
    if (key === "secretary") {
      return {
        key, kind: "secretary", name: "The Secretary", photo: null,
        line1: "Reads bills and calls the roll. A deputy often reads, so the transcript doesn't say who.",
        line2: secretary?.name ? `Secretary of the Senate at the time: ${secretary.name}` : "",
        url: null, officialUrl: null, remarks: [], presiding: [],
      };
    }
    if (key.startsWith("assembly:")) {
      const member = ctx.assembly[t.assembly!];
      const district = member.sessions[session];
      return {
        key, kind: "assembly", name: `Asm. ${member.name}`, photo: photoUrl(member.photo),
        line1: district ? `Member of the Assembly · District ${district}` : "Member of the Assembly",
        line2: "", url: null, officialUrl: member.officialUrl, remarks: [], presiding: [],
      };
    }
    const senator = ctx.senatorsBySlug.get(key)!;
    const district = senator.sessions[session];
    const service = serviceText(senator.service);
    return {
      key, kind: "senator", name: `Sen. ${senator.name}`, photo: photoUrl(senator.photo),
      line1: [district ? `District ${district}` : "", service].filter(Boolean).join(" · "),
      line2: `${plural(senator.remarks, "remark")} in ${plural(senator.transcripts, "transcript")}`,
      url: ctx.pageSlugs.has(key) ? url(`/senators/${key}/`) : null,
      officialUrl: senator.officialUrl, remarks: [], presiding: [],
    };
  };

  for (const t of doc.turns) {
    const key = keyOf(t);
    if (!key) continue;
    const speaker = (speakers[key] ??= info(key, t));
    (SPOKEN.has(t.role) ? speaker.remarks : speaker.presiding).push(t.i);
    if (speaker.kind === "assembly" && t.role === "chair") speaker.line2 = "Chairing this joint hearing";
  }
  // The officers named on the cover get entries even on days they didn't speak, for the headnote and citations.
  const noTurn = { role: "record" } as Turn;
  if (president && !speakers.president) speakers.president = info("president", noTurn);
  if (secretary?.name && !speakers.secretary) speakers.secretary = info("secretary", noTurn);
  return { speakers, keyOf };
}
