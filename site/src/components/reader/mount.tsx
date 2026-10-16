// The reader's interactive parts, mounted by one shared script rather than as Astro islands: they render nothing on
// the server, and islands would inline Astro's 5 KB loader into each of 8,000 transcript pages.
import { createRoot } from "react-dom/client";
import CiteTools from "../CiteTools";
import ExportMenu from "../ExportMenu";
import FindInTranscript from "../FindInTranscript";
import ReaderNav from "../ReaderNav";
import SpeakerCards from "../SpeakerCards";

const host = document.createElement("div");
host.id = "reader-tools";
document.body.append(host);
createRoot(host).render(<><SpeakerCards /><CiteTools /><ReaderNav /></>);

const actions = document.getElementById("rd-acts");
if (actions) createRoot(actions).render(<><FindInTranscript /><ExportMenu /></>);
