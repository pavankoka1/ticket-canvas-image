import { buildToolbar } from "./buildToolbar";
import { TicketCatalogController } from "./TicketCatalogController";

export type TicketCatalogMountOptions = {
  root: HTMLElement;
};

/** Mount the home catalog (vanilla DOM — no React). */
export function mountTicketCatalog({ root }: TicketCatalogMountOptions): () => void {
  root.replaceChildren();
  root.className = "app";

  const ui = buildToolbar(root);

  const catalogFrame = document.createElement("div");
  catalogFrame.className = "catalogFrame";

  const scroll = document.createElement("div");
  scroll.className = "catalog";

  const content = document.createElement("div");
  content.className = "catalog__content";

  const canvasHost = document.createElement("div");
  canvasHost.className = "catalog__canvas";
  canvasHost.setAttribute("aria-hidden", "true");

  const domHost = document.createElement("div");
  domHost.className = "catalog__dom";

  content.append(canvasHost, domHost);
  scroll.append(content);
  catalogFrame.append(scroll);

  const atlasHost = document.createElement("div");
  atlasHost.className = "catalog__captureHost";
  const badgeHost = document.createElement("div");
  badgeHost.className = "catalog__captureHost";
  const idHost = document.createElement("div");
  idHost.className = "catalog__captureHost";
  const prewarmHost = document.createElement("div");
  prewarmHost.className = "catalog__captureHost";

  root.append(catalogFrame, atlasHost, badgeHost, idHost, prewarmHost);

  const controller = new TicketCatalogController({
    root,
    ui,
    catalogFrame,
    scroll,
    content,
    canvasHost,
    domHost,
    atlasHost,
    prewarmHost,
  });

  controller.start();
  return () => controller.destroy();
}
