/** Ported from fortunamania MultiplierLabelNode — 3-layer "N×" label. */
const MULTIPLIER_ROTATION_DEG = -15;
const MULTIPLIER_SUFFIX = "×";

export class MultiplierLabelNode {
  readonly dom: HTMLSpanElement;
  private readonly values: Text[] = [];
  private lastValue: number | null = null;

  constructor() {
    this.dom = document.createElement("span");
    this.dom.className = "ticketCard__badgeLabel";

    const label = document.createElement("span");
    label.className = "ticketCard__multiplier";
    label.style.transform = `rotate(${MULTIPLIER_ROTATION_DEG}deg)`;

    for (const layerClass of [
      "ticketCard__multiplierFill",
      "ticketCard__multiplierStroke",
      "ticketCard__multiplierShadow",
    ]) {
      const layer = document.createElement("span");
      layer.className = layerClass;

      const value = document.createElement("span");
      const valueText = document.createTextNode("");
      value.appendChild(valueText);

      const suffix = document.createElement("span");
      suffix.className = "ticketCard__multiplierX";
      suffix.textContent = MULTIPLIER_SUFFIX;

      layer.append(value, suffix);
      label.appendChild(layer);
      this.values.push(valueText);
    }

    this.dom.appendChild(label);
  }

  update(value: number): void {
    if (this.lastValue === value) return;
    this.lastValue = value;
    const text = String(value);
    for (const node of this.values) node.data = text;
  }
}
