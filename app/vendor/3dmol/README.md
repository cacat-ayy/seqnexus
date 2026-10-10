# 3Dmol.js 2.5.5

The prebuilt, minified browser build (`build/3Dmol-min.js`) of
[3Dmol.js](https://3dmol.csb.pitt.edu/), unmodified, from the npm package
`3dmol@2.5.5` (published 2026-05-22; tarball sha512
`kqNHouGqq3YfW58174tdERvm0XYTmP0tavQKOqIw1ouc2OJ7epkXEFrtEkVXV0clBZT2Ze2xHRC/qxX0u0qCdw==`).

It is vendored rather than installed because the app is a single HTML file
that has to work when opened from disk: the build copies this script beside
`app.html` as `3Dmol-2.5.5.min.js`, and the structure panel loads it with a
plain script tag the first time a structure is shown. A module import would
inline half a megabyte into every page load, and module chunks do not load
over `file://`.

License: BSD-3-Clause, see `LICENSE` (3Dmol.js incorporates code from GLmol,
Three.js and jQuery under their own permissive licenses, listed there) and
`3Dmol-min.js.LICENSE.txt`. The build publishes the license beside the script.

To update: download the new `3dmol` tarball from the npm registry, check its
integrity hash against the registry's, copy `build/3Dmol-min.js`, `LICENSE`
and `build/3Dmol-min.js.LICENSE.txt` here, and change `THREEDMOL_VERSION` in
`vite.config.ts`.
