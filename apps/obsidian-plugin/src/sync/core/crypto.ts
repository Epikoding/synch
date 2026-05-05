import type { SyncedEntryMetadata } from "./content";
import { parseSyncedEntryMetadata, serializeSyncedEntryMetadata } from "./content";
import { decodeBase64, encodeBase64, randomBytes, toArrayBuffer } from "../../utils/bytes";

const ENVELOPE_VERSION = 1;
const SYNC_BLOB_BINARY_ENVELOPE_VERSION = 2;
const AES_GCM_NONCE_BYTES = 12;
const KEY_USAGE_SALT = new Uint8Array();
const SYNC_BLOB_V2_MAGIC = new Uint8Array([0x53, 0x59, 0x4e, 0x42]);
const SYNC_BLOB_V2_VERSION_OFFSET = SYNC_BLOB_V2_MAGIC.byteLength;
const SYNC_BLOB_V2_NONCE_OFFSET = SYNC_BLOB_V2_VERSION_OFFSET + 1;
const SYNC_BLOB_V2_CIPHERTEXT_OFFSET = SYNC_BLOB_V2_NONCE_OFFSET + AES_GCM_NONCE_BYTES;

export type SyncMetadataCryptoContext = {
  entryId: string;
  revision: number;
  op: "upsert" | "delete";
  blobId: string | null;
};

export type SyncBlobCryptoContext = {
  blobId: string;
};

export type SyncBlobEnvelopeOptions = {
  syncFormatVersion: number;
};

type EncryptedEnvelope = {
  version: number;
  nonce: string;
  ciphertext: string;
};

export async function encryptSyncMetadata(
  remoteVaultKey: Uint8Array,
  metadata: SyncedEntryMetadata,
  context: SyncMetadataCryptoContext,
): Promise<string> {
  return await encryptEnvelope(
    remoteVaultKey,
    "sync-metadata",
    new TextEncoder().encode(serializeSyncedEntryMetadata(metadata)),
    encodeMetadataAad(context),
  );
}

export async function decryptSyncMetadata(
  remoteVaultKey: Uint8Array,
  encryptedMetadata: string,
  context: SyncMetadataCryptoContext,
): Promise<SyncedEntryMetadata> {
  const plaintext = await decryptEnvelope(
    remoteVaultKey,
    "sync-metadata",
    encryptedMetadata,
    encodeMetadataAad(context),
  );
  return parseSyncedEntryMetadata(new TextDecoder().decode(plaintext));
}

export async function encryptSyncBlob(
  remoteVaultKey: Uint8Array,
  plaintext: Uint8Array,
  context: SyncBlobCryptoContext,
  options: SyncBlobEnvelopeOptions,
): Promise<Uint8Array> {
  switch (options.syncFormatVersion) {
    case ENVELOPE_VERSION: {
      const envelope = await encryptEnvelope(
        remoteVaultKey,
        "sync-blob",
        plaintext,
        encodeBlobAad(context, ENVELOPE_VERSION),
        ENVELOPE_VERSION,
      );
      return new TextEncoder().encode(envelope);
    }
    case SYNC_BLOB_BINARY_ENVELOPE_VERSION:
      return await encryptBinaryBlobEnvelope(remoteVaultKey, plaintext, context);
    default:
      throwUnsupportedSyncBlobFormatVersion(options.syncFormatVersion);
  }
}

export async function decryptSyncBlob(
  remoteVaultKey: Uint8Array,
  encryptedBlob: Uint8Array,
  context: SyncBlobCryptoContext,
  options: SyncBlobEnvelopeOptions,
): Promise<Uint8Array> {
  switch (options.syncFormatVersion) {
    case ENVELOPE_VERSION:
      return await decryptEnvelope(
        remoteVaultKey,
        "sync-blob",
        new TextDecoder().decode(encryptedBlob),
        encodeBlobAad(context, ENVELOPE_VERSION),
        ENVELOPE_VERSION,
      );
    case SYNC_BLOB_BINARY_ENVELOPE_VERSION:
      return await decryptBinaryBlobEnvelope(remoteVaultKey, encryptedBlob, context);
    default:
      throwUnsupportedSyncBlobFormatVersion(options.syncFormatVersion);
  }
}

async function encryptEnvelope(
  remoteVaultKey: Uint8Array,
  usage: string,
  plaintext: Uint8Array,
  additionalData: Uint8Array,
  envelopeVersion = ENVELOPE_VERSION,
): Promise<string> {
  const key = await deriveUsageKey(remoteVaultKey, usage, envelopeVersion);
  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(additionalData),
    },
    key,
    toArrayBuffer(plaintext),
  );

  return JSON.stringify({
    version: envelopeVersion,
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
  } satisfies EncryptedEnvelope);
}

async function decryptEnvelope(
  remoteVaultKey: Uint8Array,
  usage: string,
  serializedEnvelope: string,
  additionalData: Uint8Array,
  envelopeVersion = ENVELOPE_VERSION,
): Promise<Uint8Array> {
  const envelope = parseEncryptedEnvelope(serializedEnvelope, envelopeVersion);
  const key = await deriveUsageKey(remoteVaultKey, usage, envelopeVersion);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(decodeBase64(envelope.nonce)),
      additionalData: toArrayBuffer(additionalData),
    },
    key,
    toArrayBuffer(decodeBase64(envelope.ciphertext)),
  );

  return new Uint8Array(plaintext);
}

async function encryptBinaryBlobEnvelope(
  remoteVaultKey: Uint8Array,
  plaintext: Uint8Array,
  context: SyncBlobCryptoContext,
): Promise<Uint8Array> {
  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  const ciphertext = await encryptAesGcm(
    remoteVaultKey,
    "sync-blob",
    plaintext,
    nonce,
    encodeBlobAad(context, SYNC_BLOB_BINARY_ENVELOPE_VERSION),
    SYNC_BLOB_BINARY_ENVELOPE_VERSION,
  );
  const envelope = new Uint8Array(SYNC_BLOB_V2_CIPHERTEXT_OFFSET + ciphertext.byteLength);
  envelope.set(SYNC_BLOB_V2_MAGIC, 0);
  envelope[SYNC_BLOB_V2_VERSION_OFFSET] = SYNC_BLOB_BINARY_ENVELOPE_VERSION;
  envelope.set(nonce, SYNC_BLOB_V2_NONCE_OFFSET);
  envelope.set(ciphertext, SYNC_BLOB_V2_CIPHERTEXT_OFFSET);
  return envelope;
}

async function decryptBinaryBlobEnvelope(
  remoteVaultKey: Uint8Array,
  encryptedBlob: Uint8Array,
  context: SyncBlobCryptoContext,
): Promise<Uint8Array> {
  const { nonce, ciphertext } = parseBinaryBlobEnvelope(encryptedBlob);
  const plaintext = await decryptAesGcm(
    remoteVaultKey,
    "sync-blob",
    ciphertext,
    nonce,
    encodeBlobAad(context, SYNC_BLOB_BINARY_ENVELOPE_VERSION),
    SYNC_BLOB_BINARY_ENVELOPE_VERSION,
  );
  return plaintext;
}

async function encryptAesGcm(
  remoteVaultKey: Uint8Array,
  usage: string,
  plaintext: Uint8Array,
  nonce: Uint8Array,
  additionalData: Uint8Array,
  envelopeVersion: number,
): Promise<Uint8Array> {
  const key = await deriveUsageKey(remoteVaultKey, usage, envelopeVersion);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(additionalData),
    },
    key,
    toArrayBuffer(plaintext),
  );
  return new Uint8Array(ciphertext);
}

async function decryptAesGcm(
  remoteVaultKey: Uint8Array,
  usage: string,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  additionalData: Uint8Array,
  envelopeVersion: number,
): Promise<Uint8Array> {
  const key = await deriveUsageKey(remoteVaultKey, usage, envelopeVersion);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(additionalData),
    },
    key,
    toArrayBuffer(ciphertext),
  );
  return new Uint8Array(plaintext);
}

async function deriveUsageKey(
  remoteVaultKey: Uint8Array,
  usage: string,
  envelopeVersion: number,
): Promise<CryptoKey> {
  const imported = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(remoteVaultKey),
    "HKDF",
    false,
    ["deriveKey"],
  );

  return await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(KEY_USAGE_SALT),
      info: new TextEncoder().encode(`${usage}:v${envelopeVersion}`),
    },
    imported,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

function encodeMetadataAad(context: SyncMetadataCryptoContext): Uint8Array {
  return new TextEncoder().encode(
    [
      "synch.sync-metadata",
      `v${ENVELOPE_VERSION}`,
      context.entryId,
      String(context.revision),
      context.op,
      context.blobId ?? "",
    ].join("\n"),
  );
}

function encodeBlobAad(context: SyncBlobCryptoContext, envelopeVersion: number): Uint8Array {
  return new TextEncoder().encode(
    ["synch.sync-blob", `v${envelopeVersion}`, context.blobId].join("\n"),
  );
}

function parseBinaryBlobEnvelope(value: Uint8Array): {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
} {
  if (value.byteLength < SYNC_BLOB_V2_CIPHERTEXT_OFFSET) {
    throw new Error("Encrypted sync blob v2 payload is too short.");
  }
  for (let index = 0; index < SYNC_BLOB_V2_MAGIC.byteLength; index += 1) {
    if (value[index] !== SYNC_BLOB_V2_MAGIC[index]) {
      throw new Error("Encrypted sync blob v2 payload has an invalid magic header.");
    }
  }
  if (value[SYNC_BLOB_V2_VERSION_OFFSET] !== SYNC_BLOB_BINARY_ENVELOPE_VERSION) {
    throw new Error(
      `Unsupported sync blob binary envelope version: ${value[SYNC_BLOB_V2_VERSION_OFFSET] ?? "unknown"}.`,
    );
  }
  return {
    nonce: value.slice(SYNC_BLOB_V2_NONCE_OFFSET, SYNC_BLOB_V2_CIPHERTEXT_OFFSET),
    ciphertext: value.slice(SYNC_BLOB_V2_CIPHERTEXT_OFFSET),
  };
}

function throwUnsupportedSyncBlobFormatVersion(syncFormatVersion: number): never {
  throw new Error(`Unsupported sync blob format version: ${syncFormatVersion}.`);
}

function parseEncryptedEnvelope(value: string, envelopeVersion = ENVELOPE_VERSION): EncryptedEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Encrypted sync payload is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Encrypted sync payload must decode to an object.");
  }

  const record = parsed as Partial<EncryptedEnvelope>;
  if (record.version !== envelopeVersion) {
    throw new Error(`Unsupported sync payload version: ${record.version ?? "unknown"}.`);
  }
  if (typeof record.nonce !== "string" || !record.nonce.trim()) {
    throw new Error("Encrypted sync payload is missing a nonce.");
  }
  if (typeof record.ciphertext !== "string" || !record.ciphertext.trim()) {
    throw new Error("Encrypted sync payload is missing ciphertext.");
  }

  return {
    version: record.version,
    nonce: record.nonce,
    ciphertext: record.ciphertext,
  };
}
