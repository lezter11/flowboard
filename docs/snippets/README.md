# Saved frontend snippets

`compressCardImage.ts` preserves the function supplied by the user on 2026-10-26 for future adoption. It is not imported by the HTML artifact or the production API.

Its `<250 KB` comment is a target, not an enforced result: quality is fixed at 0.85 and the original can be returned. Files below 150 KB skip processing, and processed images fit inside 1920×1080. Validate format, size, failure cleanup and visual quality when integrating it; this saved reference is not verified upload behavior.
