/**
 * Sanitizes a filename for safe use in Content-Disposition and storage.
 * Prevents header injection (CR/LF) and keeps only safe characters.
 * WHY: V-04/V-06 — avoid Content-Disposition header injection via client-controlled filenames.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\r\n\0]/g, "")
    .replace(/[^\w\s.\-()[\]]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 255) || "attachment";
}
