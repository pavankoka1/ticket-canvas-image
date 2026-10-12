import { createRoot } from "react-dom/client";

import { Compare } from "./catalog/Compare";
import { mountTicketCatalog } from "./ticketCatalog";
import { ensureTicketFont } from "./ticketCatalog/ticketFont";
import "./index.css";

const isCompare =
  /(?:^|\/)compare\/?$/.test(location.pathname) ||
  location.hash === "#compare";

// Gate the first paint on the self-hosted ticket face so DOM + SnapDOM agree
// from the first frame (and atlas keys never land on "fallback-system").
void ensureTicketFont(16).then(({ face, mbOnest700 }) => {
  console.info("[font] ready", { face, mbOnest700 });
  const root = document.getElementById("root")!;
  if (isCompare) {
    // No StrictMode — double-mount was stacking SnapDOM sheet captures during atlas warm.
    createRoot(root).render(<Compare />);
    return;
  }
  mountTicketCatalog({ root });
});
