/**
 * How long a bottom sheet takes to leave (its 180 ms close plus the native modal dismissal). iOS drops a modal that
 * is presented while another is still going away, so a sheet that leads to a second sheet waits this long first.
 */
export const SHEET_CLOSE_MS = 450

/** Runs `next` once the sheet that was just closed is gone. */
export function afterSheetCloses(next: () => void): void {
  setTimeout(next, SHEET_CLOSE_MS)
}
