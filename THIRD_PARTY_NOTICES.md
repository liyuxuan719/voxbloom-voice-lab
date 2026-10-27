# Third-Party Notices

## Pitchy

- Project: [ianprime0509/pitchy](https://github.com/ianprime0509/pitchy)
- Copyright: Ian Johnson
- License: MIT
- Use in VoxBloom: Real-time McLeod Pitch Method implementation. The browser
  module is vendored at `assets/pitchy.js` with its local FFT dependency.
- Full text: `licenses/pitchy-LICENSE`

## fft.js

- Project: [indutny/fft.js](https://github.com/indutny/fft.js)
- Copyright: Fedor Indutny
- License: MIT
- Use in VoxBloom: FFT dependency used by Pitchy. The browser-compatible
  vendored module is stored at `assets/fft.js`.
- Full text: `licenses/fft-js-LICENSE`

## Lucide

- Project: [lucide-icons/lucide](https://github.com/lucide-icons/lucide)
- Copyright: Lucide Contributors and portions of Feather by Cole Bemis
- License: ISC
- Use in VoxBloom: Interface icons, vendored at `assets/lucide.min.js`.
- Full text: `licenses/lucide-LICENSE`

The original Pitchy and fft.js source was copied and minimally adjusted only to
resolve local ES module imports in the browser. VoxBloom does not use remote
fonts, analytics, or a server-side audio service.
