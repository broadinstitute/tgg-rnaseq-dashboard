/** Read objects from Google Cloud Storage in the browser with the user's OAuth token (TGG viewer pattern). */

export function parseGsUrl(url: string): { bucket: string; object: string } {
  const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(url.trim());
  if (!m) throw new Error(`Not a gs:// URL: ${url}`);
  return { bucket: m[1], object: m[2] };
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzip(buffer: ArrayBuffer): Promise<string> {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

/** Decode bytes to text, gunzipping when the content is gzip (by magic bytes, not by file name). */
export async function bytesToText(buffer: ArrayBuffer): Promise<string> {
  if (isGzip(new Uint8Array(buffer))) return gunzip(buffer);
  return new TextDecoder().decode(buffer);
}

export async function fetchGsText(url: string, accessToken: string): Promise<string> {
  const { bucket, object } = parseGsUrl(url);
  const api = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
  const resp = await fetch(api, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) {
    const detail = resp.status === 403 ? "no read access to this object for the signed-in account" : resp.statusText;
    throw new Error(`Failed to read ${url}: ${resp.status} ${detail}`);
  }
  return bytesToText(await resp.arrayBuffer());
}

export async function fileToText(file: File): Promise<string> {
  return bytesToText(await file.arrayBuffer());
}

export interface GsObject {
  name: string;      // object name within the bucket
  gsUrl: string;
  updated: string;   // ISO timestamp
  size: number;
}

/** Folder listing: objects directly under gs://bucket/prefix/ and the immediate subfolders. */
export interface GsListing { objects: GsObject[]; subfolders: string[] }

export async function listGsFolder(folderUrl: string, accessToken: string): Promise<GsObject[]> {
  return (await listGs(folderUrl, accessToken)).objects;
}

export async function listGs(folderUrl: string, accessToken: string): Promise<GsListing> {
  const folder = folderUrl.trim().endsWith("/") ? folderUrl.trim() : folderUrl.trim() + "/";
  const { bucket, object: prefix } = parseGsUrl(folder + "x");
  const realPrefix = prefix.slice(0, -1);
  const out: GsObject[] = [];
  const subfolders: string[] = [];
  let pageToken = "";
  do {
    const api = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`);
    api.searchParams.set("prefix", realPrefix);
    api.searchParams.set("delimiter", "/");
    api.searchParams.set("fields", "items(name,updated,size),prefixes,nextPageToken");
    if (pageToken) api.searchParams.set("pageToken", pageToken);
    const resp = await fetch(api, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resp.ok) {
      const detail = resp.status === 403 ? "no access to this bucket for the signed-in account" : resp.statusText;
      throw new Error(`Failed to list ${folder}: ${resp.status} ${detail}`);
    }
    const body = (await resp.json()) as {
      items?: { name: string; updated: string; size: string }[]; prefixes?: string[]; nextPageToken?: string;
    };
    for (const it of body.items ?? []) {
      if (it.name === realPrefix) continue;   // the folder placeholder object itself
      out.push({ name: it.name, gsUrl: `gs://${bucket}/${it.name}`, updated: it.updated, size: Number(it.size) });
    }
    for (const p of body.prefixes ?? []) subfolders.push(`gs://${bucket}/${p}`);
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return { objects: out, subfolders };
}

/** Upload text as an object (overwrites). Needs the devstorage.read_write scope and write access to the bucket. */
export async function uploadGsText(url: string, text: string, contentType: string, accessToken: string): Promise<void> {
  const { bucket, object } = parseGsUrl(url);
  const api = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
  api.searchParams.set("uploadType", "media");
  api.searchParams.set("name", object);
  const resp = await fetch(api, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": contentType },
    body: text,
  });
  if (!resp.ok) {
    const detail = resp.status === 403 ? "the signed-in account cannot write to this folder" : resp.statusText;
    throw new Error(`Failed to write ${url}: ${resp.status} ${detail}`);
  }
}
