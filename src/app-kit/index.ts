/**
 * Optional helpers apps may import.
 * Navigator never imports this package for automatic behavior.
 */

export {
  edgeAction,
  edgeApp,
  edgeExternal,
  edgeNode,
  edgePop,
  type EdgeFlags,
} from "./edges.ts";

export { buildMap, siblingListEdges, type MapFragment, type SiblingListOptions } from "./lists.ts";

export { inputEdges, type InputEdgesOptions } from "./input.ts";

export { edgeToHome, homeCatalogPath, rootBackToHome } from "./home.ts";

export { signedOut, type SignedOutOptions } from "./signedOut.ts";

export {
  collectNeighborhood,
  type CollectNeighborhoodOptions,
  type NeighborhoodNeighbor,
} from "./neighborhood.ts";

export { splitText } from "./splitText.ts";
