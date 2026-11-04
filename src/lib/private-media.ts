import fs from "node:fs";
import path from "node:path";

/** A media reference stored in the database is untrusted input. */
export type PrivateMediaReference =
  | { kind: "external"; url: string }
  | { kind: "local"; filePath: string; filename: string }
  | { kind: "invalid" };

function fileNameFromReference(reference: string): string | null {
  const normalized = reference.replace(/\\/g, "/");
  const match = /^(?:\/?api\/media\/|\/?data\/media\/|\.\/data\/media\/)([^/?#]+)$/.exec(normalized);
  if (!match) return null;

  let filename: string;
  try {
    filename = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  // Saved media filenames contain a safe session id, message id and extension.
  // Never treat an opaque database value as a path to an arbitrary local file.
  if (
    filename.length > 255 ||
    !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.[a-zA-Z0-9]{1,10}$/.test(filename) ||
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) return null;

  return filename;
}

function withinDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

/**
 * Supports only HTTPS/HTTP URLs or media files in data/media.
 * realpath prevents following existing symlinks into .env, source, backups, etc.
 */
export function resolvePrivateMediaReference(
  reference: string,
  projectRoot: string = process.cwd(),
): PrivateMediaReference {
  if (typeof reference !== "string" || reference.length > 4096 || !reference) {
    return { kind: "invalid" };
  }

  if (/^https?:\/\//i.test(reference)) {
    try {
      const url = new URL(reference);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        !url.hostname || url.username || url.password
      ) return { kind: "invalid" };
      return { kind: "external", url: url.toString() };
    } catch {
      return { kind: "invalid" };
    }
  }

  const filename = fileNameFromReference(reference);
  if (!filename) return { kind: "invalid" };

  const mediaRoot = path.resolve(projectRoot, "data", "media");
  const lexicalPath = path.resolve(mediaRoot, filename);
  if (!withinDirectory(mediaRoot, lexicalPath)) return { kind: "invalid" };

  try {
    const actualRoot = fs.realpathSync.native(mediaRoot);
    const actualFile = fs.realpathSync.native(lexicalPath);
    if (!withinDirectory(actualRoot, actualFile)) return { kind: "invalid" };
    if (path.relative(path.join(actualRoot, filename), actualFile) !== "") return { kind: "invalid" };
    if (!fs.statSync(actualFile).isFile()) return { kind: "invalid" };
    return { kind: "local", filePath: actualFile, filename };
  } catch {
    return { kind: "invalid" };
  }
}

export function isSessionMessageMediaFilename(filename: string, sessionId: string, keyId: string): boolean {
  return path.basename(filename, path.extname(filename)) === `${sessionId}-${keyId}`;
}
