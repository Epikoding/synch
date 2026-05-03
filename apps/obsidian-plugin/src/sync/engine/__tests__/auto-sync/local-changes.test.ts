import { describe, expect, it, vi } from "vitest";

import { createInitializedTestSyncStore, createTestPlugin } from "../../../../test-support/test-plugin";
import { SyncAutoLoop } from "../../auto-sync";
import {
  createPushResult,
  createRealtimeClient,
  createToken,
} from "./helpers";
import type {
  SyncRealtimeCallbacks,
  SyncRealtimeSession,
} from "../../../remote/realtime-client";

describe("SyncAutoLoop local changes", () => {
  it("runs ad-hoc realtime work on the active session", async () => {
    const store = await createInitializedTestSyncStore(createTestPlugin());
    const pushPendingMutations = vi.fn(async () => {});
    const pullOnce = vi.fn(async () => {});
    let openCount = 0;
    let session: SyncRealtimeSession | null = null;
    const autoLoop = new SyncAutoLoop({
      getApiBaseUrl: () => "http://127.0.0.1:8787",
      getSyncToken: async () => createToken(),
      getSyncStore: () => store,
      pushPendingMutations,
      pullOnce,
      realtimeClient: createRealtimeClient(
        () => {
          openCount += 1;
        },
        (nextSession) => {
          session = nextSession;
        },
      ),
    });

    await autoLoop.start();
    const result = await autoLoop.withRealtimeSession(async (activeSession) => {
      expect(activeSession).toBe(session);
      return "done";
    });

    expect(result).toBe("done");
    expect(openCount).toBe(1);
    autoLoop.stop();
    await store.close();
  });

  it("debounces local changes into a single push", async () => {
    vi.useFakeTimers();

    const store = await createInitializedTestSyncStore(createTestPlugin());
    const pushPendingMutations = vi.fn(async () => {});
    const pullOnce = vi.fn(async () => {});
    let session: SyncRealtimeSession | null = null;
    const autoLoop = new SyncAutoLoop({
      getApiBaseUrl: () => "http://127.0.0.1:8787",
      getSyncToken: async () => createToken(),
      getSyncStore: () => store,
      pushPendingMutations,
      pullOnce,
      realtimeClient: createRealtimeClient(undefined, (nextSession) => {
        session = nextSession;
      }),
      pushDebounceMs: 100,
    });

    await autoLoop.start();
    autoLoop.notifyLocalChange();
    autoLoop.notifyLocalChange();
    autoLoop.notifyLocalChange();

    await vi.advanceTimersByTimeAsync(100);

    expect(pushPendingMutations).toHaveBeenCalledTimes(1);
    expect(pushPendingMutations).toHaveBeenCalledWith(session);
    expect(pullOnce).toHaveBeenCalledTimes(0);
    autoLoop.stop();
    await store.close();
  });

  it("pushes file-size blocked mutations unblocked by the current session policy", async () => {
    const store = await createInitializedTestSyncStore(createTestPlugin());
    const pushPendingMutations = vi.fn(async () => createPushResult());
    const unblockFileSizeBlockedMutations = vi.fn(async () => 1);
    const pullOnce = vi.fn(async () => {});
    let session: SyncRealtimeSession | null = null;
    const autoLoop = new SyncAutoLoop({
      getApiBaseUrl: () => "http://127.0.0.1:8787",
      getSyncToken: async () => createToken(),
      getSyncStore: () => store,
      pushPendingMutations,
      unblockFileSizeBlockedMutations,
      pullOnce,
      realtimeClient: createRealtimeClient(undefined, (nextSession) => {
        session = nextSession;
      }),
    });

    await autoLoop.start();
    await Promise.resolve();

    expect(unblockFileSizeBlockedMutations).toHaveBeenCalledWith(session);
    expect(pushPendingMutations).toHaveBeenCalledWith(session);
    expect(pullOnce).toHaveBeenCalledTimes(0);
    autoLoop.stop();
    await store.close();
  });

  it("retries file-size blocked mutations after policy updates", async () => {
    const store = await createInitializedTestSyncStore(createTestPlugin());
    const pushPendingMutations = vi.fn(async () => createPushResult());
    const unblockFileSizeBlockedMutations = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    const pullOnce = vi.fn(async () => {});
    let callbacks: SyncRealtimeCallbacks | null = null;
    let session: SyncRealtimeSession | null = null;
    const autoLoop = new SyncAutoLoop({
      getApiBaseUrl: () => "http://127.0.0.1:8787",
      getSyncToken: async () => createToken(),
      getSyncStore: () => store,
      pushPendingMutations,
      unblockFileSizeBlockedMutations,
      pullOnce,
      realtimeClient: createRealtimeClient(
        (nextCallbacks) => {
          callbacks = nextCallbacks;
        },
        (nextSession) => {
          session = nextSession;
        },
      ),
    });

    await autoLoop.start();
    callbacks?.onPolicyUpdated(
      {
        storageLimitBytes: 1_000_000_000,
        maxFileSizeBytes: 5_000_000,
      },
      {
        storageUsedBytes: 24_300_000,
        storageLimitBytes: 1_000_000_000,
      },
    );
    await vi.waitFor(() => {
      expect(pushPendingMutations).toHaveBeenCalledWith(session);
    });

    expect(unblockFileSizeBlockedMutations).toHaveBeenCalledTimes(2);
    expect(unblockFileSizeBlockedMutations).toHaveBeenLastCalledWith(session);
    expect(pullOnce).toHaveBeenCalledTimes(0);
    autoLoop.stop();
    await store.close();
  });

  it("reopens the realtime session after file-size unblock initialization fails", async () => {
    vi.useFakeTimers();

    const store = await createInitializedTestSyncStore(createTestPlugin());
    const pushPendingMutations = vi.fn(async () => createPushResult());
    const unblockFileSizeBlockedMutations = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient unblock failure"))
      .mockResolvedValueOnce(0);
    const pullOnce = vi.fn(async () => {});
    const onError = vi.fn();
    const closedSessions: SyncRealtimeSession[] = [];
    let openCount = 0;
    const autoLoop = new SyncAutoLoop({
      getApiBaseUrl: () => "http://127.0.0.1:8787",
      getSyncToken: async () => createToken(),
      getSyncStore: () => store,
      pushPendingMutations,
      unblockFileSizeBlockedMutations,
      pullOnce,
      realtimeClient: createRealtimeClient(
        () => {
          openCount += 1;
        },
        (session) => {
          const close = session.close.bind(session);
          session.close = () => {
            closedSessions.push(session);
            close();
          };
        },
      ),
      reconnectDelayMs: 100,
      onError,
    });

    await autoLoop.start();
    await vi.advanceTimersByTimeAsync(100);

    expect(openCount).toBe(2);
    expect(unblockFileSizeBlockedMutations).toHaveBeenCalledTimes(2);
    expect(closedSessions).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
    autoLoop.stop();
    await store.close();
  });

  it("keeps pushing when the push service reports more pending work", async () => {
    vi.useFakeTimers();

    const store = await createInitializedTestSyncStore(createTestPlugin());
    const pushPendingMutations = vi
      .fn()
      .mockResolvedValueOnce(createPushResult({ hasMore: true }))
      .mockResolvedValueOnce(createPushResult({ hasMore: false }));
    const pullOnce = vi.fn(async () => {});
    const autoLoop = new SyncAutoLoop({
      getApiBaseUrl: () => "http://127.0.0.1:8787",
      getSyncToken: async () => createToken(),
      getSyncStore: () => store,
      pushPendingMutations,
      pullOnce,
      realtimeClient: createRealtimeClient(),
      pushDebounceMs: 100,
    });

    await autoLoop.start();
    autoLoop.notifyLocalChange();

    await vi.advanceTimersByTimeAsync(100);

    expect(pushPendingMutations).toHaveBeenCalledTimes(2);
    expect(pullOnce).toHaveBeenCalledTimes(0);
    autoLoop.stop();
    await store.close();
  });
});
