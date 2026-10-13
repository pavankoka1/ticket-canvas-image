import { MAX_TICKETS } from "./constants";

export type ToolbarRefs = {
  toolbar: HTMLElement;
  ticketAdds: HTMLElement;
  lastDraw: HTMLElement;
  layoutStat: HTMLElement;
  ticketStat: HTMLElement;
  tileStat: HTMLElement;
  canvasStat: HTMLElement;
  domStat: HTMLElement;
  drawBtn: HTMLButtonElement;
};

export function buildToolbar(root: HTMLElement): ToolbarRefs {
  const toolbar = document.createElement("header");
  toolbar.className = "toolbar";

  const h1 = document.createElement("h1");
  h1.textContent = "Sprite canvas POC";

  const hint = document.createElement("p");
  hint.className = "toolbar__hint";
  hint.append(
    "+1 and +5 play the catalog appear gesture, then scroll to the bottom. ",
    "+25 and +100 only scroll. Live rows stay DOM. Scrolled-away rows use ",
    "svg-all sprite paint (compare atlas). Up to ",
    String(MAX_TICKETS),
    " tickets. · ",
  );
  const compareLink = document.createElement("a");
  compareLink.href = "/compare";
  compareLink.textContent = "DOM↔Canvas compare";
  hint.append(compareLink);

  const row = document.createElement("div");
  row.className = "toolbar__row";

  const ticketAdds = document.createElement("div");
  ticketAdds.className = "ticketAdds";
  ticketAdds.dataset.ticketAdds = "";
  for (const count of [1, 5, 25, 100] as const) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ticketAdds__btn";
    btn.textContent = `+${count}`;
    btn.dataset.addCount = String(count);
    ticketAdds.append(btn);
  }

  const mkBtn = (label: string, action: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-ghost";
    b.textContent = label;
    b.dataset.action = action;
    return b;
  };

  const drawBtn = mkBtn("Draw", "draw") as HTMLButtonElement;
  const lastDraw = document.createElement("span");
  lastDraw.className = "stat";
  lastDraw.hidden = true;

  const layoutStat = document.createElement("span");
  layoutStat.className = "stat";
  layoutStat.dataset.layoutStat = "";

  const ticketStat = document.createElement("span");
  ticketStat.className = "stat";
  ticketStat.dataset.ticketStat = "";

  const tileStat = document.createElement("span");
  tileStat.className = "stat";
  tileStat.dataset.tileStat = "";

  const canvasStat = document.createElement("span");
  canvasStat.className = "stat";
  canvasStat.dataset.canvasStat = "";

  const domStat = document.createElement("span");
  domStat.className = "stat";
  domStat.dataset.domStat = "";

  row.append(
    ticketAdds,
    mkBtn("Reset", "reset"),
    mkBtn("Rebuild canvas", "rebuild-canvas"),
    drawBtn,
    mkBtn("Clear draws", "clear-draws"),
    lastDraw,
    layoutStat,
    ticketStat,
    tileStat,
    canvasStat,
    domStat,
  );

  toolbar.append(h1, hint, row);
  root.append(toolbar);

  return {
    toolbar,
    ticketAdds,
    lastDraw,
    layoutStat,
    ticketStat,
    tileStat,
    canvasStat,
    domStat,
    drawBtn,
  };
}
