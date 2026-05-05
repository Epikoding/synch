# Sync Format

## Encrypted blob envelopes

Sync blob transport and storage use binary request/response bodies:

- The Obsidian plugin uploads encrypted blob bytes to `PUT /v1/vaults/:vaultId/blobs/:blobId`.
- The API streams those bytes directly into R2.
- Downloads return the R2 object body directly.

The blob envelope format is selected by the remote vault's `sync_format_version`.
The API stores this value on the vault record and returns it from sync token issuance.
The Obsidian plugin branches blob encryption and decryption by that vault format
version, not by plugin version.

## v1 JSON envelope

Existing v1 vaults keep using the original JSON envelope. `encryptSyncBlob`
encrypts plaintext file bytes, wraps the AES-GCM nonce and ciphertext in a JSON
object with base64 fields, then UTF-8 encodes that JSON before upload.

```json
{
  "version": 1,
  "nonce": "base64...",
  "ciphertext": "base64..."
}
```

## v2 binary envelope

New vaults use sync format v2 by default. The v2 blob envelope is binary:

```text
offset  size  value
0       4     magic bytes: 0x53 0x59 0x4e 0x42 ("SYNB")
4       1     binary envelope version: 0x02
5       12    AES-GCM nonce
17      rest  AES-GCM ciphertext, including the authentication tag
```

The v2 HKDF info and AES-GCM additional authenticated data use version `v2`, so
v1 and v2 blob payloads are cryptographically separated.

## Compatibility

Existing vaults remain on sync format v1 without migration. The plugin keeps v1
decrypt support so existing remote blobs and cached blobs remain readable.

Metadata envelopes remain on the v1 JSON format. The v2 binary envelope applies
only to file blob payloads.
