"use client";

import { useEffect, useRef, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { DEFAULT_LANGUAGE_ID } from "@/lib/languages";
import type {
  AwarenessUser,
  ConnectionStatus,
  DeletedNotice,
} from "./types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:1234";

interface ActiveUser {
  clientId: number;
  user: AwarenessUser;
}

export interface UseYjsEditorParams {
  roomId: string;
  localUser: AwarenessUser;
}

export interface UseYjsEditorResult {
  ydocRef: React.MutableRefObject<Y.Doc | null>;
  providerRef: React.MutableRefObject<WebsocketProvider | null>;
  metaRef: React.MutableRefObject<Y.Map<unknown> | null>;
  status: ConnectionStatus;
  users: ActiveUser[];
  languageId: string;
  setLanguageId: (id: string) => void;
  deleted: DeletedNotice | null;
  setDeleted: (n: DeletedNotice) => void;
}

// Owns the Yjs document, the y-websocket provider, awareness, and the
// shared `meta` map. Returns refs so the consuming component can hand the
// ydoc/provider to MonacoBinding on mount and run code via ydoc.getText.
export function useYjsEditor({
  roomId,
  localUser,
}: UseYjsEditorParams): UseYjsEditorResult {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [users, setUsers] = useState<ActiveUser[]>([]);
  const [languageId, setLanguageIdState] =
    useState<string>(DEFAULT_LANGUAGE_ID);
  const [deleted, setDeleted] = useState<DeletedNotice | null>(null);

  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const metaRef = useRef<Y.Map<unknown> | null>(null);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(WS_URL, roomId, ydoc);
    provider.awareness.setLocalStateField("user", localUser);

    const meta = ydoc.getMap("meta");
    metaRef.current = meta;

    const handleStatus = (event: { status: ConnectionStatus }) => {
      setStatus(event.status);
    };

    const refreshUsers = () => {
      const list: ActiveUser[] = [];
      for (const [clientId, state] of provider.awareness.getStates()) {
        const candidate = (state as { user?: Partial<AwarenessUser> }).user;
        if (
          candidate &&
          typeof candidate.name === "string" &&
          typeof candidate.color === "string"
        ) {
          list.push({
            clientId,
            user: {
              name: candidate.name,
              color: candidate.color,
              avatarUrl:
                typeof candidate.avatarUrl === "string"
                  ? candidate.avatarUrl
                  : null,
            },
          });
        }
      }
      setUsers(list);
    };

    const syncMetaFromYjs = () => {
      const lang = meta.get("language");
      if (typeof lang === "string") setLanguageIdState(lang);
      const del = meta.get("deleted");
      if (del && typeof del === "object") {
        setDeleted(del as DeletedNotice);
      }
    };

    provider.on("status", handleStatus);
    provider.awareness.on("change", refreshUsers);
    meta.observe(syncMetaFromYjs);

    refreshUsers();
    syncMetaFromYjs();

    ydocRef.current = ydoc;
    providerRef.current = provider;

    return () => {
      meta.unobserve(syncMetaFromYjs);
      provider.awareness.off("change", refreshUsers);
      provider.off("status", handleStatus);
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
      metaRef.current = null;
    };
  }, [roomId, localUser]);

  const setLanguageId = (id: string) => {
    metaRef.current?.set("language", id);
  };

  return {
    ydocRef,
    providerRef,
    metaRef,
    status,
    users,
    languageId,
    setLanguageId,
    deleted,
    setDeleted,
  };
}
