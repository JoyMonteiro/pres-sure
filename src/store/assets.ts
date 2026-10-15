// Where image bytes go when an image is stored in the project (web-images spec D1).
// Today that is a data URI, exactly as an upload produces. When the asset-folders work
// lands, storeImageBlob writes a file in folder mode instead — this is the one seam.

export const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Returns the value to put in Element.content for a stored image. */
export function storeImageBlob(blob: Blob, _nameHint: string): Promise<string> {
  return blobToDataUrl(blob);
}
