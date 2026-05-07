"use client";

import { useEffect } from "react";
import type { WebsocketProvider } from "y-websocket";
import { pickInitial } from "./types";

interface Props {
  provider: WebsocketProvider | null;
  roomId: string;
}

// y-monaco wires up decoration classes (.yRemoteSelection-<clientID>,
// .yRemoteSelectionHead-<clientID>) but ships no CSS. Inject per-client
// colour rules off the awareness state so each remote caret + selection
// takes that user's pill colour. globals.css covers the base shape.
export function RemoteCursorStyles({ provider, roomId }: Props): null {
  useEffect(() => {
    if (!provider) return;
    const styleEl = document.createElement("style");
    styleEl.dataset.pad = roomId;
    document.head.appendChild(styleEl);

    const update = () => {
      const localId = provider.awareness.clientID;
      const blocks: string[] = [];
      for (const [clientId, state] of provider.awareness.getStates()) {
        if (clientId === localId) continue;
        const u = (state as { user?: { name?: string; color?: string } }).user;
        const color = typeof u?.color === "string" ? u.color : "#888";
        const initial = pickInitial(u?.name);
        blocks.push(
          `.yRemoteSelection-${clientId} { background-color: ${color}55; }
           .yRemoteSelectionHead-${clientId} { border-left-color: ${color}; }
           .yRemoteSelectionHead-${clientId}::after {
             background: ${color};
             content: ${JSON.stringify(initial)};
           }`
        );
      }
      styleEl.textContent = blocks.join("\n");
    };

    provider.awareness.on("change", update);
    update();
    return () => {
      provider.awareness.off("change", update);
      styleEl.remove();
    };
  }, [provider, roomId]);

  return null;
}
