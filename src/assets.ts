import { defineAssets } from '@iwsdk/core';
import { LoungeAtmosphere } from './scene-assets/atmosphere.scene-asset.js';
import { InteriorDetails } from './scene-assets/interior-details.scene-asset.js';

/**
 * Only the two procedural prototypes are registered. Every model file (the heroes, and the
 * penthouse's lounge, table and chairs built in Blender) is loaded by the game itself, when
 * the world that needs it is chosen, so it can fall back to stand-ins if one is missing.
 *
 * Do not list model URLs here: IWSDK downloads and parses everything in this manifest before
 * the app starts. Four penthouse models used to be listed (14.6 MB, read from the manifest by
 * nothing), which made every start in every world take about 8 s instead of 2.
 */
export default defineAssets({
  loungeAtmosphere: new LoungeAtmosphere().group,
  interiorDetails: new InteriorDetails(false).group,
});
