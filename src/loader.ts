import { Source } from "graphql";
import { readFile } from "fs/promises";
import glob from "fast-glob";

export interface FileSourcePair {
  file: string;
  source: Source;
}

export async function loadSources(pattern: string): Promise<Array<FileSourcePair>> {
  const files = await glob(pattern, { absolute: true });

  return await Promise.all(
    files.map(async (file) => ({ file, source: new Source(await readFile(file, "utf-8")) }))
  );
}
