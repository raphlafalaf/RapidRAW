# Single image mode

Date: 2026-07-01
Status: Approved, ready for implementation plan

## Problem

RapidRAW currently only opens images through a library: pick a root folder, it gets scanned, and you browse a folder tree / filmstrip. There's no way to just open one image file and edit it, without any folder scanning.

## Goal

From the blank welcome screen, let the user open a single image directly into the editor, with no folder tree, no filmstrip, and no library scan involved. Two entry points: a button, and drag-and-drop.

## Non-goals (explicitly deferred)

- OS-level "Open with RapidRAW" file association. Note: there is already dead code for this (`initial_file_path` in `src-tauri/src/app_state.rs` / `lib.rs`, and `initialFileToOpen` in `useProcessStore.ts`) that stores the path and emits an `open-with-file` event, but nothing ever consumes `initialFileToOpen` on the frontend. Worth revisiting later, out of scope here.
- Sidecar autosave / persistence for images opened this way. Edits live only in the session until exported.
- Opening several loose images together as a mini-session (no folder, but more than one image with a filmstrip). Single image only.

## Design

### A. Entry points

1. **"Open Image" button.** Added next to the existing "Open Folder" button on the blank welcome screen (`src/components/panel/MainLibrary.tsx`, the `!props.rootPaths || props.rootPaths.length === 0` branch, around line 296-320). Opens a native single-file picker (`@tauri-apps/plugin-dialog` `open()`, `directory: false, multiple: false`) filtered to the app's supported image/RAW extensions (reuse `supportedTypes` from `useSettingsStore`, same list already used for import filtering).

2. **Drag and drop.** Uses Tauri's native window drag-drop event (`getCurrentWindow().onDragDropEvent`), not HTML5 drag events, so we get real filesystem paths. Works globally, whether or not a folder/library is currently open (dropping a file always opens it directly in single-image mode, taking over from whatever was on screen). If multiple files are dropped at once, only the first file with a supported extension is opened; the rest are ignored, no error shown.

Both entry points converge on the same handler.

### B. Opening flow

Both entry points call the existing `handleImageSelect(path)` from `useAppNavigation.ts` directly. This function is already purely path-based (it just needs a string path, loads the image and its metadata via `LoadImage` / `LoadMetadata` invokes) and has no dependency on `rootPaths` or a scanned folder. No backend changes are needed for opening.

No root path is registered, no folder tree is built, no library scan runs.

### C. Editor behaviour

- Folder tree: already hidden automatically when `rootPaths` is empty (`renderFolderTree()` in `App.tsx` returns `null` when `!hasRoots`). Nothing to change.
- Filmstrip: `EditorView` passes `sortedImageList` into the filmstrip; when there's no library this list is empty, so it already renders empty. We'll additionally explicitly hide the filmstrip in single-image mode (no root paths) rather than showing an empty strip, since we explicitly don't want prev/next navigation here.
- Back / close: pressing "back" (`handleBackToLibrary`) returns to the blank welcome screen, same as today. Since there's no autosave for images opened this way, if the current adjustments differ from what was loaded (or from defaults, for a freshly opened image), show a simple confirm dialog ("Discard unsaved edits?") before navigating away. If there are no changes, back navigates immediately with no prompt.

### D. Export

No changes. The existing Export panel already works for a single selected image regardless of whether a folder/library is open (`ExportPanel.tsx` builds `pathsToExport` from `selectedImage.path` when not in library context, and only uses `rootPaths` to preserve relative folder structure for batch/library exports, which doesn't apply here).

## Risks / things to verify during implementation

- Confirm `ExportPanel` doesn't silently misbehave when `rootPaths` is an empty array (it's typed as `string[]`, currently always passed a real array from `App.tsx`; single-image mode should pass `[]`, same as it already would with no folder open).
- Confirm the native drag-drop event fires correctly across Windows/macOS/Linux and doesn't conflict with any existing pointer/resize event handling in `App.tsx`.
- Decide where the "discard unsaved edits" comparison baseline comes from (compare current adjustments to `INITIAL_ADJUSTMENTS`, since there's no sidecar to diff against).
