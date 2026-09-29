/**
 * Deterministic multiplier badge as native SVG (stress-test for reactSvgRaster).
 * Same props → same bytes → cacheable bitmaps.
 */

export type MultiplierBadgeSvgProps = {
  value: number;
  size: number;
  active?: boolean;
};

const CLASS = {
  label: "mbLabel",
} as const;

export function multiplierBadgeStyleBlock(fontFamily: string): string {
  return (
    `.${CLASS.label}{` +
    `font-family:${fontFamily};font-weight:700;` +
    `font-size:10px;fill:#1a1a1a;text-anchor:middle;dominant-baseline:central;` +
    `}`
  );
}

export function MultiplierBadgeSvg({
  value,
  size,
  active = true,
}: MultiplierBadgeSvgProps) {
  const r = size / 2;
  const fill = active ? "#f5c842" : "#9aa8a6";
  const stroke = active ? "#c9a227" : "#6b7876";
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`${value}×`}
    >
      <circle
        cx={r}
        cy={r}
        r={r - 0.5}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
      />
      <text x={r} y={r} className={CLASS.label}>
        {value}×
      </text>
    </svg>
  );
}
