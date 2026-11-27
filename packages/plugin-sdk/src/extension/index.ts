/**
 * Extension bridge helpers — not a browser module; a very small contract the
 * popup/sidepanel/content layers read from the extension package. Kept here so
 * the main app can eventually reuse server URLs in a shared fashion.
 */

export interface ExtensionMeta {
  name: string;
  version: string;
  defaultLocale: string;
}

export async function extensionMeta(): Promise<ExtensionMeta> {
  return { name: '__AYAtodoist · آية', version: '0.1.0.0', defaultLocale: 'ar-AE' };
}
