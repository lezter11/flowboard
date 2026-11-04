# Evidence retention

All failed/incomplete rounds, raw command logs, probe sources, reports, source/artifact SHA maps and acceptance screenshots are preserved. Raw command output may contain trailing spaces or terminal progress carriage returns; it is retained byte-for-byte rather than reformatted after review.

The generated `independent-ui-review/{runs,setup}/*/stage/` copies contain repeat copies of Next static output, staged source modules and compiled Pages worker. They remain on this Mac and are excluded from Git to avoid committing repeated build distributions. No file in the formal passing review's782-file manifest is excluded. The reports retain their exact build/source maps, commands and outcomes; future execution rebuilds these copies from the reviewed source. Nothing was deleted as part of this exclusion.
