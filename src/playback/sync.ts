// Presenter <-> audience sync via BroadcastChannel (§4.6). Payload is tiny: just the
// current frame index + overview flag. Presenter view loads its own copy of the
// presentation from IndexedDB and follows these messages.
export const CHANNEL = "pres-sure-playback";

export interface PlaybackMsg {
  type: "state";
  index: number;
  overview: boolean;
  presentationId: string;
}

export function openChannel(): BroadcastChannel {
  return new BroadcastChannel(CHANNEL);
}
