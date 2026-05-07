// Y.encodeStateAsUpdate() of an empty Y.Doc returns a 2-byte sentinel. The
// snapshot path uses this to refuse overwriting a populated Oracle row with
// a transient empty doc that hasn't synced yet.
export const EMPTY_STATE_BYTES = 2;
