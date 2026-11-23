// The module catalogue's sheets, as the core bundles them (ADR 17). The `sunreye-catalogue` crate
// beside this file checks them, and a module typed outside the catalogue.

import aikoNeostar2sPlusMah54db from "./modules/aiko-neostar-2s-plus-mah54db.json" with { type: "json" };
import jaSolarDeepblue40Jam54d40Gb from "./modules/ja-solar-deepblue-4-0-jam54d40-gb.json" with { type: "json" };
import jaSolarDeepblue40Jam54d40Lb from "./modules/ja-solar-deepblue-4-0-jam54d40-lb.json" with { type: "json" };
import jaSolarDeepblue40Jam54d40Mb from "./modules/ja-solar-deepblue-4-0-jam54d40-mb.json" with { type: "json" };
import jaSolarDeepblue40Jam54d41Lb from "./modules/ja-solar-deepblue-4-0-jam54d41-lb.json" with { type: "json" };
import longiHiMo6ExplorerLr554htb from "./modules/longi-hi-mo-6-explorer-lr5-54htb.json" with { type: "json" };
import longiHiMo6ExplorerLr554hth from "./modules/longi-hi-mo-6-explorer-lr5-54hth.json" with { type: "json" };
import longiHiMo6ScientistLr554htb from "./modules/longi-hi-mo-6-scientist-lr5-54htb.json" with { type: "json" };
import longiHiMo6ScientistLr554hth from "./modules/longi-hi-mo-6-scientist-lr5-54hth.json" with { type: "json" };
import longiHiMoX6ExplorerLr554htb from "./modules/longi-hi-mo-x6-explorer-lr5-54htb.json" with { type: "json" };
import longiHiMoX6ExplorerLr554hth from "./modules/longi-hi-mo-x6-explorer-lr5-54hth.json" with { type: "json" };
import trinaSolarVertexSPlusNeg9r28 from "./modules/trina-solar-vertex-s-plus-neg9r-28.json" with { type: "json" };

/** @type {readonly import("./index.d.ts").Sheet[]} */
export const modules = [
  aikoNeostar2sPlusMah54db,
  jaSolarDeepblue40Jam54d40Gb,
  jaSolarDeepblue40Jam54d40Lb,
  jaSolarDeepblue40Jam54d40Mb,
  jaSolarDeepblue40Jam54d41Lb,
  longiHiMo6ExplorerLr554htb,
  longiHiMo6ExplorerLr554hth,
  longiHiMo6ScientistLr554htb,
  longiHiMo6ScientistLr554hth,
  longiHiMoX6ExplorerLr554htb,
  longiHiMoX6ExplorerLr554hth,
  trinaSolarVertexSPlusNeg9r28,
];
