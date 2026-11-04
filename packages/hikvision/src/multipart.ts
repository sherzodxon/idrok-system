// Minimal multipart/form-data reader: enough for what terminals send (a JSON part and a picture).
/** Splits a multipart/form-data body into its parts by name (terminal pushes, FaceDataRecord). */
export function multipartParts(body: Buffer, contentType: string): Map<string, Buffer> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const out = new Map<string, Buffer>();
  if (!boundary) return out;
  const sep = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let start = body.indexOf(sep);
  while (start !== -1) {
    const next = body.indexOf(sep, start + sep.length);
    if (next === -1) break;
    const part = body.subarray(start + sep.length + 2, next - 2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const name = /name="([^"]+)"/.exec(headers)?.[1];
      if (name) out.set(name, part.subarray(headerEnd + 4));
    }
    start = next;
  }
  return out;
}
