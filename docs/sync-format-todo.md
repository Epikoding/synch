# Sync Format TODO

## Encrypted blob envelope v2

Current sync blob transport and storage already use binary request/response bodies:

- The Obsidian plugin uploads encrypted blob bytes to `PUT /v1/vaults/:vaultId/blobs/:blobId`.
- The API streams those bytes directly into R2.
- Downloads return the R2 object body directly.

The remaining JSON/base64 overhead is inside the encrypted blob envelope produced by
`encryptSyncBlob`: plaintext file bytes are encrypted, wrapped as a JSON object with
base64 `nonce` and `ciphertext`, then UTF-8 encoded before upload.

Keep existing vaults on the current v1 envelope. For a future v2 create-vault flow,
introduce a vault-level sync or crypto format version and create new vaults with a
binary blob envelope from the start.

Implementation notes:

- Store the selected sync/crypto format version on the remote vault record.
- Return that format version when a plugin connects to or issues a sync token for a vault.
- Branch encryption by vault format, not plugin version.
- Keep v1 decrypt support so existing vaults and cached blobs remain readable.
- Start with binary blob envelopes only; metadata envelopes can stay v1 unless there is a separate reason to change them.
- Reject or clearly block old plugin versions from connecting to v2 vaults if they cannot read the new envelope.
- Define the v2 binary byte layout before enabling v2 vault creation.

The expected rollout shape is:

1. Add read support for both v1 JSON envelopes and v2 binary envelopes.
2. Add a vault format version field and expose it through the sync connection path.
3. Make new v2 vault creation write binary blob envelopes.
4. Leave existing vaults on v1 without migration.
