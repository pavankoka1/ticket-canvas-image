/**
 * Catalog home ↔ Figma Money Ball ticket (desktop medium).
 * Node: 6177:126669 — 43px tall, 17px header, 26px body, 4px radius, drop shadow.
 */

import type { TicketMetrics } from "./ticketPresets";
import { DESKTOP_MEDIUM } from "./ticketPresets";

/** When true, `/` locks preset + frame to the Figma desktop reference. */
export const CATALOG_FIGMA_DESKTOP_LOCK = true;

/** Fortunamania desktop catalog scrollport width (5× ticket + gaps). */
export const FIGMA_DESKTOP_CATALOG_FRAME_WIDTH = 1001;

export function figmaDesktopCatalogMetrics(): TicketMetrics {
  return DESKTOP_MEDIUM;
}
