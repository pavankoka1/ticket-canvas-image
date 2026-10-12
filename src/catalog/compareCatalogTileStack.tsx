/**
 * Same stack as "Live DOM + canvas capture" (foreignObject raster).
 * Use this row to sanity-check Safari; production `/` tiles still use
 * `paintCatalogTicketSvgAll` until composite parity is fixed there.
 */

import { CompareSvgStack, type CompareSvgStackProps } from "./compareSvgStack";

export type CompareCatalogTileStackProps = Omit<CompareSvgStackProps, "optimized">;

export function CompareCatalogTileStack(props: CompareCatalogTileStackProps) {
  return <CompareSvgStack {...props} optimized={false} />;
}
