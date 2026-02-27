import { generateId } from "@allmaps/id";

export async function buildAllmapsAnnotationUrl(manifestUrl: string): Promise<{ id: string; url: string }> {
  const id = await generateId(manifestUrl);
  return { id, url: `https://annotations.allmaps.org/manifests/${id}` };
}