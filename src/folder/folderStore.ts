import { create } from "zustand";
import type { DeckFolder } from "./deckFolder";

export type FolderStatus = "none" | "needsPermission" | "open" | "conflict";
export type SaveState = "idle" | "pending" | "saving" | "error";

interface FolderState {
  status: FolderStatus;
  name: string | null;
  handle: FileSystemDirectoryHandle | null;
  session: DeckFolder | null;
  saving: SaveState;
  error: string | null;
}

export const useFolderStore = create<FolderState>()(() => ({
  status: "none",
  name: null,
  handle: null,
  session: null,
  saving: "idle",
  error: null,
}));

/** While the reopen overlay is up, the canvas shows a read-only copy (spec §4 "Reopen overlay"). */
export const isEditingLocked = (): boolean => useFolderStore.getState().status === "needsPermission";
