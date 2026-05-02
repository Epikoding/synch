# Next Obsidian plugin release

## Added

- Preview synced file versions before restoring them from version history.
- Preview deleted files before restoring them when previewable text content is available.

## Fixed

- Avoid expensive automatic text merges when large files would exceed the merge budget.
- Keep the version history pane available after Obsidian restarts.
- Hide sync progress until a remote vault is connected.
- Detach the local vault cursor on remote vault disconnect, while still allowing local disconnect when the server cannot be reached.
- Prevent pushed local changes from advancing the pull checkpoint before earlier remote changes have been applied.
