# Next Obsidian plugin release

## Added

- Show an Obsidian status bar and settings warning when remote vault storage is almost full.

## Changed

- Show a loading spinner next to the settings sync status while sync is active or reconnecting.

## Fixed

- Avoid unnecessary follow-up pulls after local changes are pushed when the accepted sync cursors are already contiguous with the last pulled checkpoint.
