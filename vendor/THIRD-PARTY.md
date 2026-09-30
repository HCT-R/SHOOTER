# Included libraries

The build embeds these local distributions into index.html. No CDN is accessed by the game.

| Library | Version | Use | License/source |
|---|---|---|---|
| Three.js | r170 | WebGL scene, models, lighting, instancing and HDR pixel post-processing | MIT; https://github.com/mrdoob/three.js/tree/r170 |
| @tweenjs/tween.js | 25.0.0 | Sector reveal interpolation, driven by game time | MIT; TWEEN-LICENSE.txt; https://github.com/tweenjs/tween.js |

`tween.module.js` is the unmodified `dist/tween.esm.js` from the pinned npm package. `tools/build.js` places the export in a private closure while bundling. The upstream license is retained in `TWEEN-LICENSE.txt`.
