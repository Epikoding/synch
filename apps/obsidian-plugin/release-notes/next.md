# Next Obsidian plugin release

## Added

## Changed

- Remote path changes now move existing vault files when possible instead of deleting and recreating them.
- Sync progress reporting now avoids scanning every stored entry after startup, improving responsiveness in larger vaults.

## Fixed

- Accepted push batches are now saved together so successful file changes stay recorded even when another file in the batch is rejected.
