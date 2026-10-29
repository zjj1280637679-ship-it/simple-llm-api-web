/** Browser decoding is a separate observation from MIME/signature checks.
 * A successful decode establishes dimensions, not semantic task quality.
 */
export async function decodeBrowserRaster(blob, url) {
  if(typeof globalThis.createImageBitmap==='function') {
    const bitmap=await globalThis.createImageBitmap(blob);
    try { return {width:bitmap.width,height:bitmap.height}; }
    finally { bitmap.close(); }
  }
  if(typeof globalThis.Image!=='function')return null;
  const image=new globalThis.Image();image.src=url;
  try {
    if(typeof image.decode==='function')await image.decode();
    else await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;});
    return {width:image.naturalWidth,height:image.naturalHeight};
  } finally { image.onload=image.onerror=null;image.removeAttribute('src'); }
}

export function createImageDelivery({decode=decodeBrowserRaster,urls=URL}={}) {
  const owned=new Set();let disposed=false;
  function release(url) { if(owned.delete(url))urls.revokeObjectURL(url); }
  async function prepare(images,expectedPixels) {
    if(disposed)throw new Error('Image host disposed');
    const output=[];
    try {
      for(const source of images) {
        const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'})[source.mimeType];
        if(!extension)throw new Error('Unsupported image MIME');
        const bytes=Uint8Array.from(atob(source.data),c=>c.charCodeAt(0));
        const blob=new Blob([bytes],{type:source.mimeType}),url=urls.createObjectURL(blob);
        owned.add(url);
        const image={...source,extension,url,checks:{decoded:'unknown',dimensions:'unknown'}};
        output.push(image);
        try {
          const dimensions=await decode(blob,url);
          if(dimensions) {
            if(!Number.isSafeInteger(dimensions.width)||!Number.isSafeInteger(dimensions.height)||dimensions.width<=0||dimensions.height<=0)throw new Error('Invalid decoded dimensions');
            image.width=dimensions.width;image.height=dimensions.height;image.checks.decoded='passed';
            if(expectedPixels)image.checks.dimensions=dimensions.width===expectedPixels[0]&&dimensions.height===expectedPixels[1]?'matched':'mismatch';
          }
        } catch { image.failed=true;image.checks.decoded='failed'; }
        if(disposed)throw new Error('Image host disposed');
      }
      return output;
    } catch(error) { for(const image of output)release(image.url);throw error; }
  }
  return {prepare,release,dispose(){disposed=true;for(const url of [...owned])release(url);}};
}
