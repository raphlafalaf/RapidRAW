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
