# Homepage landscape

The Pyrenees photograph was taken and supplied by Alejandro Blanco, the Track Atlas
project owner, who retains its copyright and authorized its use on the site. It is not covered
by the application's MIT license. No third-party stock photograph is used.

`pyrenees_original.jpg` is the unchanged source (5472 × 3648 pixels).

The homepage uses these derived files:

| Dimensions  | JPEG                | WebP                 | AVIF                 |
| ----------- | ------------------- | -------------------- | -------------------- |
| 960 × 640   | `pyrenees-960.jpg`  | `pyrenees-960.webp`  | `pyrenees-960.avif`  |
| 1920 × 1280 | `pyrenees-1920.jpg` | `pyrenees-1920.webp` | `pyrenees-1920.avif` |

Generated with Sharp: auto-orient, resize without enlargement while preserving
aspect ratio, JPEG quality 82 (MozJPEG), WebP quality 80, and AVIF quality 55
(effort 6). Derived files omit embedded metadata. The layout crops them with
`object-fit: cover`; the files themselves retain the original framing.

The native `<picture>` offers AVIF first, then WebP, then JPEG. Each format has
960w/1920w responsive candidates with `sizes="100vw"`. The below-fold photograph
uses lazy loading and asynchronous decoding. The original is never requested by
the homepage.
