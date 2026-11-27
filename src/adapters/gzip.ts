/** 浏览器原生 gzip 工具，供各存储适配器共用。 */

export async function gzipText(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}
