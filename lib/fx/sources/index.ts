import type { FxSource } from "../types";
import { cbslIndicative, cbslTt } from "./cbsl";
import { amana, combank, dfcc, hnb, ndb, ntb, peoples, sampath } from "./banks";

/** Every source the collector runs. Skipped sources (terms forbid automated
 *  access/reuse, or bot walls) are listed in lib/fx/SOURCES.md, not here. */
export const FX_SOURCES: FxSource[] = [
  cbslIndicative,
  cbslTt,
  combank,
  sampath,
  hnb,
  peoples,
  ndb,
  ntb,
  dfcc,
  amana,
];

export type FxSourceMeta = Pick<FxSource, "id" | "name" | "shortName" | "kind" | "pageUrl">;

/** Display metadata only — safe to import from client components. */
export const FX_SOURCE_META: Record<string, FxSourceMeta> = Object.fromEntries(
  FX_SOURCES.map(({ id, name, shortName, kind, pageUrl }) => [id, { id, name, shortName, kind, pageUrl }]),
);
