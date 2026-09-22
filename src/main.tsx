import { createRoot } from "react-dom/client";

import { Catalog } from "./catalog/Catalog";
import { ensureTicketFont } from "./catalog/ticketFont";
import "./index.css";

// Gate the first paint on the self-hosted ticket face so DOM + SnapDOM agree
// from the first frame (and atlas keys never land on "fallback-system").
void ensureTicketFont(16).then(({ face, mbOnest700 }) => {
  console.info("[font] ready", { face, mbOnest700 });
  // No StrictMode — double-mount was stacking SnapDOM sheet captures during atlas warm.
  createRoot(document.getElementById("root")!).render(<Catalog />);
});
