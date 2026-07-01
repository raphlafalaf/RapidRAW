# Single Image Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user open a single image directly into the RapidRAW editor from the blank welcome screen, via an "Open Image" button or by dragging a file onto the window, with no folder tree, filmstrip, or library scan involved.

**Architecture:** Both entry points resolve a file path and feed it into the existing `handleImageSelect(path)` function (`src/hooks/useAppNavigation.ts`), which is already purely path-based and needs no library/root path. We add: a shared image-type-filter/extension util, a new `handleOpenImage` navigation handler, a new button on the welcome screen, a global native drag-drop listener, filmstrip suppression when no root path is open, and a "discard unsaved edits" confirm gate on the existing back-to-library path when leaving a single-image session.

**Tech Stack:** React 18 + TypeScript, Zustand stores, Tauri v2 (`@tauri-apps/api`, `@tauri-apps/plugin-dialog`), i18next.

**Verification note:** This repo has no frontend test runner configured (no vitest/jest, `package.json` only has `typecheck`/`lint`/`build` scripts) and no Rust changes are needed for this feature, so there are no `cargo test` targets to add either. Steps below use `npm run typecheck` and `npm run lint` as the automated gate. Baseline: on the pre-existing `main` branch, `npm run typecheck` already reports 11 pre-existing errors unrelated to this work (in `useImageProcessing.ts`, `useLibraryActions.ts`, `useSortedLibrary.ts`, `main.tsx`, `adjustments.ts`, `cropUtils.ts`, `frontendLogBridge.ts`). Verification steps check that this count doesn't increase, not that it's zero. Each task also ends with a manual QA step, since a GPU-backed Tauri window can't be driven headlessly here — run those manually with `npm run start` (aka `tauri dev`) on your machine.

---

### Task 1: Shared image-type-filter utility

**Files:**
- Create: `src/utils/fileUtils.ts`
- Modify: `src/hooks/useFileOperations.ts:281-320`

The dialog file-type filter logic (raw/non-raw extension lists, uppercase+lowercase expansion) currently lives only in `handleImportClick` in `useFileOperations.ts`. We need the same logic for the new "Open Image" picker and for drag-drop filtering, so extract it once.

- [x] **Step 1: Create the shared util**

```typescript
// src/utils/fileUtils.ts
import { SupportedTypes } from '../components/ui/AppProperties';

export interface DialogTypeFilter {
  name: string;
  extensions: string[];
}

const expandExtensionCase = (exts: string[]): string[] => {
  return Array.from(new Set(exts.flatMap((ext) => [ext.toLowerCase(), ext.toUpperCase()])));
};

export function buildImageTypeFilters(supportedTypes: SupportedTypes | null): DialogTypeFilter[] {
  const nonRaw = supportedTypes?.nonRaw || [];
  const raw = supportedTypes?.raw || [];

  const processedNonRaw = expandExtensionCase(nonRaw);
  const processedRaw = expandExtensionCase(raw);
  const allImageExtensions = [...processedNonRaw, ...processedRaw];

  return [
    { name: 'All Supported Images', extensions: allImageExtensions },
    { name: 'RAW Images', extensions: processedRaw },
    { name: 'Standard Images (JPEG, PNG, etc.)', extensions: processedNonRaw },
    { name: 'All Files', extensions: ['*'] },
  ];
}

export function getFileExtension(path: string): string {
  const pathWithoutVC = path.split('?vc=')[0];
  const filename = pathWithoutVC.split(/[\\/]/).pop() || '';
  const lastDotIndex = filename.lastIndexOf('.');
  return lastDotIndex !== -1 ? filename.substring(lastDotIndex + 1).toLowerCase() : '';
}

export function isSupportedImagePath(path: string, supportedTypes: SupportedTypes | null): boolean {
  if (!supportedTypes) return false;
  const extension = getFileExtension(path);
  if (!extension) return false;
  return supportedTypes.raw.includes(extension) || supportedTypes.nonRaw.includes(extension);
}
```

- [x] **Step 2: Refactor `handleImportClick` to use it**

In `src/hooks/useFileOperations.ts`, add the import at the top (after the existing `Status` import on line 11):

```typescript
import { buildImageTypeFilters } from '../utils/fileUtils';
```

Then replace the filter-building block (current lines 287-306, from `const nonRaw = supportedTypes?.nonRaw || [];` through the `open({...})` call's `filters` value) so it reads:

```typescript
        const typeFilters = isAndroid ? [] : buildImageTypeFilters(supportedTypes);

        const selected = await open({
          filters: typeFilters,
          multiple: true,
          title: 'Select files to import',
        });
```

- [x] **Step 3: Verify no behavior change**

Run: `npm run typecheck 2>&1 | grep -c "error TS"`
Expected: `11` (same pre-existing baseline count as before this task; no new errors from `fileUtils.ts` or `useFileOperations.ts`).

Run: `npm run lint`
Expected: no new errors reported for `src/utils/fileUtils.ts` or `src/hooks/useFileOperations.ts`.

- [x] **Step 4: Commit**

```bash
cd /home/raph/MyAppsZor/RapidRAW
git add src/utils/fileUtils.ts src/hooks/useFileOperations.ts
git commit -m "refactor: extract shared image file-type filter util"
```

---

### Task 2: `handleOpenImage` navigation handler

**Files:**
- Modify: `src/hooks/useAppNavigation.ts:437-483` (right after `handleOpenFolder`)

- [x] **Step 1: Add the import**

At the top of `src/hooks/useAppNavigation.ts`, add alongside the existing imports (after line 13, `import { globalImageCache } from '../utils/ImageLRUCache';`):

```typescript
import { buildImageTypeFilters } from '../utils/fileUtils';
```

- [x] **Step 2: Add `handleOpenImage`**

Insert immediately after the closing `};` of `handleOpenFolder` (after line 483, before `const handleContinueSession = () => {`):

```typescript
  const handleOpenImage = async () => {
    const { supportedTypes } = useSettingsStore.getState();

    try {
      const typeFilters = buildImageTypeFilters(supportedTypes);
      const selected = await open({
        filters: typeFilters,
        multiple: false,
        title: 'Select an image to open',
      });

      if (typeof selected === 'string') {
        await handleImageSelect(selected);
      }
    } catch (err) {
      console.error('Failed to open image selection dialog:', err);
      toast.error('Failed to open image selection dialog.');
    }
  };
```

- [x] **Step 3: Export it from the hook**

In the `return { ... }` block at the end of the file (lines 587-596), add `handleOpenImage` after `handleOpenFolder`:

```typescript
  return {
    handleGoHome,
    handleBackToLibrary,
    handleImageSelect,
    handleSelectSubfolder,
    handleSelectAlbum,
    handleOpenFolder,
    handleOpenImage,
    handleContinueSession,
  };
```

- [x] **Step 4: Verify**

Run: `npm run typecheck 2>&1 | grep -c "error TS"`
Expected: `11` (unchanged baseline; `handleOpenImage` isn't wired to any caller yet so nothing else should break).

- [x] **Step 5: Commit**

```bash
cd /home/raph/MyAppsZor/RapidRAW
git add src/hooks/useAppNavigation.ts
git commit -m "feat: add handleOpenImage navigation handler"
```

---

### Task 3: "Open Image" button on the welcome screen

**Files:**
- Modify: `src/components/panel/MainLibrary.tsx`
- Modify: `src/components/views/LibraryView.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n/locales/en.json`, `de.json`, `es.json`, `fr.json`, `it.json`, `ja.json`, `ko.json`, `pl.json`, `pt.json`, `ru.json`, `zh-CN.json`, `zh-TW.json`

- [x] **Step 1: Add translation key to all 12 locales**

In each locale file's `splash` object, insert a new `openImage` key alphabetically between the existing `openFolder` and `openLibrary` keys:

`src/i18n/locales/en.json` (after line 968 `"openFolder": "Open Folder",`):
```json
      "openImage": "Open Image",
```

`src/i18n/locales/de.json`:
```json
      "openImage": "Bild öffnen",
```

`src/i18n/locales/es.json`:
```json
      "openImage": "Abrir imagen",
```

`src/i18n/locales/fr.json`:
```json
      "openImage": "Ouvrir une image",
```

`src/i18n/locales/it.json`:
```json
      "openImage": "Apri immagine",
```

`src/i18n/locales/ja.json`:
```json
      "openImage": "画像を開く",
```

`src/i18n/locales/ko.json`:
```json
      "openImage": "이미지 열기",
```

`src/i18n/locales/pl.json`:
```json
      "openImage": "Otwórz obraz",
```

`src/i18n/locales/pt.json`:
```json
      "openImage": "Abrir imagem",
```

`src/i18n/locales/ru.json`:
```json
      "openImage": "Открыть изображение",
```

`src/i18n/locales/zh-CN.json`:
```json
      "openImage": "打开图片",
```

`src/i18n/locales/zh-TW.json`:
```json
      "openImage": "打開圖片",
```

Each locale's `splash` block has the same key layout as `en.json` (`openFolder` then `openLibrary`) — insert the new line between them, keeping the trailing comma on `openFolder`'s line as in the existing file.

- [x] **Step 2: Verify i18n key is picked up**

Run: `npm run i18n:check`
Expected: no missing-key errors for `splash.openImage` (it now exists in all locale files used by the extractor).

- [x] **Step 3: Add `onOpenImage` prop and button to `MainLibrary.tsx`**

Add `ImagePlus` to the `lucide-react` import (top of file, currently lines 3-16):

```typescript
import {
  AlertTriangle,
  Check,
  Folder,
  FolderInput,
  Home,
  ImagePlus,
  Loader2,
  RefreshCw,
  Settings,
  Search,
  Users,
  SlidersHorizontal,
} from 'lucide-react';
```

Add `onOpenImage(): void;` to `MainLibraryProps` (after line 64, `onOpenFolder(): void;`):

```typescript
  onOpenFolder(): void;
  onOpenImage(): void;
```

In the splash screen button row (currently lines 306-330, the `<div className="flex items-center gap-2">` containing the Open Folder button and the settings gear button), add a new button between them:

```tsx
                      <div className="flex items-center gap-2">
                        <Button
                          className={`rounded-md grow flex justify-center items-center shadow-md h-11 ${
                            hasLastPath ? 'bg-surface text-text-primary' : ''
                          }`}
                          onClick={props.onOpenFolder}
                          size="lg"
                        >
                          <Folder size={20} className="mr-2" />
                          {props.isAndroid
                            ? t('library.splash.openLibrary')
                            : hasLastPath
                              ? t('library.splash.addFolder')
                              : t('library.splash.openFolder')}
                        </Button>
                        {!props.isAndroid && (
                          <Button
                            className="rounded-md grow flex justify-center items-center shadow-md h-11 bg-surface text-text-primary"
                            onClick={props.onOpenImage}
                            size="lg"
                          >
                            <ImagePlus size={20} className="mr-2" />
                            {t('library.splash.openImage')}
                          </Button>
                        )}
                        <Button
                          className="px-3 bg-surface text-text-primary shadow-md h-11"
                          onClick={() => setShowSettings(true)}
                          size="lg"
                          data-tooltip={t('settings.general.title')}
                          variant="ghost"
                        >
                          <Settings size={20} />
                        </Button>
                      </div>
```

(Only the new `{!props.isAndroid && (...)}` block is new; the surrounding two buttons are unchanged, shown here for placement context. Android is excluded because it already uses a SAF-based library picker as its only "open" flow, consistent with `isAndroid` being excluded from other file-dialog flows in this codebase.)

- [x] **Step 4: Thread `onOpenImage` through `LibraryView.tsx`**

In `src/components/views/LibraryView.tsx`, add to `LibraryViewProps` (after line 32, `handleOpenFolder: (...args: any) => void;`):

```typescript
  handleOpenFolder: (...args: any) => void;
  handleOpenImage: () => void;
```

Add to the destructured props (after line 58, `handleOpenFolder,`):

```typescript
  handleOpenFolder,
  handleOpenImage,
```

Pass it to `MainLibrary` (after line 152, `onOpenFolder={handleOpenFolder}`):

```typescript
            onOpenFolder={handleOpenFolder}
            onOpenImage={handleOpenImage}
```

- [x] **Step 5: Wire it up in `App.tsx`**

Destructure `handleOpenImage` from `useAppNavigation` (line 260-271, add to the destructured list alongside `handleOpenFolder`):

```typescript
  const {
    handleGoHome,
    handleBackToLibrary,
    handleImageSelect,
    handleSelectSubfolder,
    handleSelectAlbum,
    handleOpenFolder,
    handleOpenImage,
    handleContinueSession,
  } = useAppNavigation({
    clearThumbnailQueue,
    refs: navigationRefs,
  });
```

Pass it to `LibraryView` (after line 682, `handleOpenFolder={handleOpenFolder}`):

```typescript
                  handleOpenFolder={handleOpenFolder}
                  handleOpenImage={handleOpenImage}
```

- [x] **Step 6: Verify**

Run: `npm run typecheck 2>&1 | grep -c "error TS"`
Expected: `11` (unchanged baseline).

Run: `npm run lint`
Expected: no new errors.

Manual QA (run `npm run start` on your machine): launch the app with no folder previously opened. The blank welcome screen should show "Open Folder" and a new "Open Image" button. Click "Open Image", pick a single RAW or JPEG file. The editor should open directly on that image, with no folder tree on the left and no filmstrip at the bottom.

- [x] **Step 7: Commit**

```bash
cd /home/raph/MyAppsZor/RapidRAW
git add src/components/panel/MainLibrary.tsx src/components/views/LibraryView.tsx src/App.tsx src/i18n/locales/*.json
git commit -m "feat: add Open Image button to welcome screen"
```

---

### Task 4: Global drag-and-drop to open a single image

**Files:**
- Modify: `src/App.tsx`

Uses Tauri's native window drag-drop event (real filesystem paths, not the HTML5 DataTransfer API), so it works the same whether or not the OS webview has focus-related quirks around HTML5 drag events.

- [x] **Step 1: Add imports**

In `src/App.tsx`, `getCurrentWindow` is already imported (line 4). Add the extension-check util import alongside the other util imports (after line 13, `import { useThumbnails } from './hooks/useThumbnails';`, is fine, or group with other utils imports near line 28):

```typescript
import { isSupportedImagePath } from './utils/fileUtils';
```

- [x] **Step 2: Add the drag-drop listener effect**

Add a new `useEffect` in `App.tsx`, near the other window-level effects (right after the fullscreen-tracking effect that ends around line 523, before `const handleRightPanelSelect = ...`):

```typescript
  useEffect(() => {
    const { supportedTypes } = useSettingsStore.getState();
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onDragDropEvent((event: any) => {
        if (event.payload.type !== 'drop') return;

        const paths: string[] = event.payload.paths || [];
        const firstSupported = paths.find((path) => isSupportedImagePath(path, supportedTypes));

        if (firstSupported) {
          handleImageSelect(firstSupported);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [handleImageSelect]);
```

- [x] **Step 3: Verify**

Run: `npm run typecheck 2>&1 | grep -c "error TS"`
Expected: `11` (unchanged baseline).

Run: `npm run lint`
Expected: no new errors.

Manual QA (run `npm run start`): with the app on the blank welcome screen, drag a supported image file from your file manager onto the app window. It should open directly in the editor. Repeat while a folder library is already open and an unrelated image is being edited: dropping a new file should switch straight to editing the dropped file. Drop a file with an unsupported extension (e.g. a `.txt` file): nothing should happen, no crash, no toast.

- [x] **Step 4: Commit**

```bash
cd /home/raph/MyAppsZor/RapidRAW
git add src/App.tsx
git commit -m "feat: support opening an image via drag-and-drop"
```

---

### Task 5: Hide filmstrip when no folder/library is open

**Files:**
- Modify: `src/components/views/EditorView.tsx:179`

- [x] **Step 1: Confirm `rootPaths` is already available in this component**

`rootPaths` is already destructured and used in `EditorView.tsx` (passed to `ExportPanel` at line 236). No new store subscription needed.

- [x] **Step 2: Change `showFilmstrip`**

In `src/components/views/EditorView.tsx`, change line 179 from:

```tsx
      showFilmstrip={!isCompactPortrait}
```

to:

```tsx
      showFilmstrip={!isCompactPortrait && rootPaths.length > 0}
```

- [x] **Step 3: Verify**

Run: `npm run typecheck 2>&1 | grep -c "error TS"`
Expected: `11` (unchanged baseline).

Manual QA (run `npm run start`): open a single image via the Open Image button (no folder open). Confirm the bottom filmstrip strip is not shown. Then go back, open a folder normally, select an image, and confirm the filmstrip still shows as before.

- [x] **Step 4: Commit**

```bash
cd /home/raph/MyAppsZor/RapidRAW
git add src/components/views/EditorView.tsx
git commit -m "fix: hide filmstrip in single image mode"
```

---

### Task 6: Confirm before discarding unsaved edits on close

**Files:**
- Modify: `src/hooks/useAppNavigation.ts:59-105`

Since images opened via Open Image / drag-and-drop have no sidecar autosave, leaving the editor (back button, Escape, etc.) while there are unsaved edits and no folder open would silently discard them. Gate that specific case with the existing `ConfirmModal` (already wired app-wide via `useUIStore.confirmModalState`, see `src/components/modals/AppModals.tsx:116-118`).

- [x] **Step 1: Rename the existing body to an inner function**

In `src/hooks/useAppNavigation.ts`, rename `handleBackToLibrary`'s implementation so it can be reused as the confirmed action. Replace the current declaration (lines 59-105):

```typescript
  const handleBackToLibrary = useCallback(() => {
    const { selectedImage, resetHistory, setEditor } = useEditorStore.getState();
    const { setLibrary } = useLibraryStore.getState();
    const { setUI } = useUIStore.getState();

    if (selectedImage?.path && cachedEditStateRef.current) {
      globalImageCache.set(selectedImage.path, cachedEditStateRef.current);
    }
    if (transformWrapperRef.current) {
      transformWrapperRef.current.resetTransform(0);
    }
    setEditor({ zoom: 1 });

    debouncedSave.flush();
    debouncedSetHistory.cancel();

    const lastActivePath = selectedImage?.path ?? null;

    setEditor({
      hasRenderedFirstFrame: false,
      selectedImage: null,
      finalPreviewUrl: null,
      uncroppedAdjustedPreviewUrl: null,
      histogram: null,
      waveform: null,
      activeMaskId: null,
      activeMaskContainerId: null,
      activeAiPatchContainerId: null,
      isWbPickerActive: false,
      activeAiSubMaskId: null,
      transformedOriginalUrl: null,
    });

    selectedImagePathRef.current = null;

    setLibrary({ libraryActivePath: lastActivePath });
    setUI({ slideDirection: 1 });

    setEditor({ adjustments: INITIAL_ADJUSTMENTS });
    resetHistory(INITIAL_ADJUSTMENTS);

    isBackendReadyRef.current = true;
    setEditor((state) => {
      if (state.interactivePatch?.url) URL.revokeObjectURL(state.interactivePatch.url);
      return { interactivePatch: null };
    });
  }, [refs]);
```

with:

```typescript
  const performBackToLibrary = useCallback(() => {
    const { selectedImage, resetHistory, setEditor } = useEditorStore.getState();
    const { setLibrary } = useLibraryStore.getState();
    const { setUI } = useUIStore.getState();

    if (selectedImage?.path && cachedEditStateRef.current) {
      globalImageCache.set(selectedImage.path, cachedEditStateRef.current);
    }
    if (transformWrapperRef.current) {
      transformWrapperRef.current.resetTransform(0);
    }
    setEditor({ zoom: 1 });

    debouncedSave.flush();
    debouncedSetHistory.cancel();

    const lastActivePath = selectedImage?.path ?? null;

    setEditor({
      hasRenderedFirstFrame: false,
      selectedImage: null,
      finalPreviewUrl: null,
      uncroppedAdjustedPreviewUrl: null,
      histogram: null,
      waveform: null,
      activeMaskId: null,
      activeMaskContainerId: null,
      activeAiPatchContainerId: null,
      isWbPickerActive: false,
      activeAiSubMaskId: null,
      transformedOriginalUrl: null,
    });

    selectedImagePathRef.current = null;

    setLibrary({ libraryActivePath: lastActivePath });
    setUI({ slideDirection: 1 });

    setEditor({ adjustments: INITIAL_ADJUSTMENTS });
    resetHistory(INITIAL_ADJUSTMENTS);

    isBackendReadyRef.current = true;
    setEditor((state) => {
      if (state.interactivePatch?.url) URL.revokeObjectURL(state.interactivePatch.url);
      return { interactivePatch: null };
    });
  }, [refs]);

  const handleBackToLibrary = useCallback(() => {
    const { selectedImage, adjustments } = useEditorStore.getState();
    const { rootPaths } = useLibraryStore.getState();
    const { setUI } = useUIStore.getState();

    const isSingleImageSession = !rootPaths || rootPaths.length === 0;
    const hasUnsavedEdits =
      isSingleImageSession && !!selectedImage && JSON.stringify(adjustments) !== JSON.stringify(INITIAL_ADJUSTMENTS);

    if (hasUnsavedEdits) {
      setUI({
        confirmModalState: {
          confirmText: 'Discard Edits',
          confirmVariant: 'destructive',
          isOpen: true,
          message: 'You have unsaved edits on this image. Leaving now will discard them. Continue?',
          onConfirm: performBackToLibrary,
          title: 'Discard unsaved edits?',
        },
      });
      return;
    }

    performBackToLibrary();
  }, [performBackToLibrary]);
```

- [x] **Step 2: Verify**

Run: `npm run typecheck 2>&1 | grep -c "error TS"`
Expected: `11` (unchanged baseline).

Run: `npm run lint`
Expected: no new errors.

Manual QA (run `npm run start`):
1. Open an image via Open Image, make no edits, press Escape (or the editor's back button). Should return to the welcome screen immediately, no dialog.
2. Open an image via Open Image, change any adjustment slider, then go back. Should show a "Discard unsaved edits?" confirmation. Cancel should keep you in the editor with the edit intact. Confirm should return to the welcome screen and discard the edit.
3. Open a folder normally, select an image, make an edit, go back. Should return immediately with no confirmation (library mode has autosave, this gate only applies when no folder is open).

- [x] **Step 3: Commit**

```bash
cd /home/raph/MyAppsZor/RapidRAW
git add src/hooks/useAppNavigation.ts
git commit -m "feat: confirm before discarding unsaved edits in single image mode"
```

---

### Task 7: Final verification pass

**Files:** none (verification only)

- [x] **Step 1: Full typecheck diff check**

Run: `npm run typecheck 2>&1 | grep "error TS" | wc -l`
Expected: `11`, matching the documented pre-existing baseline at the top of this plan. If it's higher, find and fix the new error(s) before proceeding.

- [x] **Step 2: Full lint pass**

Run: `npm run lint`
Expected: no errors introduced by this feature (pre-existing warnings/errors elsewhere in the repo, if any, are out of scope).

- [x] **Step 3: Production build**

Run: `npm run build`
Expected: build completes successfully (this also catches any Vite/Rollup-level issues typecheck alone might miss).

- [ ] **Step 4: Manual QA pass (run `npm run start` on your machine)**

Run through, in order:
1. Fresh launch, no prior session: welcome screen shows both "Open Folder" and "Open Image".
2. Open Image → pick a JPEG: opens directly in editor, no folder tree, no filmstrip.
3. Open Image → pick a RAW file (if you have one): same as above, confirms RAW decoding path still works outside a library.
4. Edit the image (any slider), export via the existing Export panel: confirms export still works with no `rootPaths`.
5. Go back without exporting after editing: confirm the discard-edits dialog appears and both Cancel/Confirm behave correctly.
6. Drag a supported image file onto the app window from the welcome screen: opens directly.
7. Drag a supported image file onto the app window while a folder library is open and mid-edit on another image: switches to the dropped file.
8. Drag an unsupported file (e.g. `.txt`) onto the window: no-op, no crash.
9. Open a folder normally afterward: confirm nothing above broke standard library browsing, filmstrip, folder tree, or context menus.

- [x] **Step 5: Push**

```bash
cd /home/raph/MyAppsZor/RapidRAW
git push https://github.com/raphlafalaf/RapidRAW main
```
