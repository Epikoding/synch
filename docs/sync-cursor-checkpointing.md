# Sync cursor checkpointing

`last_pulled_cursor` is a local-vault checkpoint, not a record of the latest
server cursor seen by the client.

## Meaning

When a local vault stores `last_pulled_cursor = N`, it means:

- every server entry state with `updated_seq <= N` has been processed without
  gaps;
- the next pull can safely request changes after `N`;
- any failure or deferred dependency must leave the checkpoint at the last
  gap-free cursor.

This is stronger than "my last push was accepted at cursor N".

## Push accepted cursors

A push response cursor only proves that the submitted mutation was committed at
that position in the vault-wide server stream. It does not prove that the client
has applied earlier server cursors.

Example:

```text
local last_pulled_cursor = 10

other local vault commits B -> server cursor 11
this local vault has not pulled 11 yet

this local vault pushes A -> accepted at server cursor 12
```

If the client stores `last_pulled_cursor = 12` here, cursor 11 can be skipped
forever. The local A state may be correct, but the checkpoint would falsely say
that all changes through 12 were applied.

## Current rule

Push must not advance `last_pulled_cursor`.

Push may update local entry state for accepted mutations and clear dirty
mutations, but cursor checkpointing belongs to pull. After an accepted push, the
client should schedule a pull so the pull path can apply the vault-wide stream
and advance the checkpoint only after a gap-free window is complete.

The server still returns accepted cursors for commit results because clients need
them for local entry state and reporting, but those cursors are not local pull
checkpoints.

## Future optimization

The conservative rule can be optimized later, but only with tests that preserve
the gap-free invariant.

Potential optimizations:

- allow push to checkpoint only when accepted cursors are exactly
  `last_pulled_cursor + 1`, `+2`, and so on with no gaps;
- coalesce repeated push-triggered pulls so a burst of local changes schedules
  one follow-up pull;
- skip blob fetch/decrypt during pull when an entry state is already known to be
  identical to the accepted local state.

Do not add an optimization that treats `max(accepted.cursor)` as a safe
checkpoint.
