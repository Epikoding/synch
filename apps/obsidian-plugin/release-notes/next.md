# Next Obsidian plugin release

## Added

- Show an Obsidian status bar and settings warning when remote vault storage is almost full.
- Mark files in Obsidian's file explorer when Synch cannot sync them because their encrypted size exceeds the file size limit.

## Changed

- Show a loading spinner next to the settings sync status while sync is active or reconnecting.
- Scan changed local files faster during sync by reading file contents concurrently.

## Fixed

- Avoid unnecessary follow-up pulls after local changes are pushed when the accepted sync cursors are already contiguous with the last pulled checkpoint.
