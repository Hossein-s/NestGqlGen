import { DefinitionNode, Kind } from "graphql";
import { kebabCase } from "lodash";
import { join, relative, dirname } from "path";
import { BASE_INPUT_PATH, BASE_OUTPUT_PATH } from "./config";

export enum FileType {
  Enum,
  Dto,
  Resolver,
}

export function makeOutputFilePath(schemaFilePath: string, name: string, type: FileType) {
  const schemaRelativeDir = dirname(relative(BASE_INPUT_PATH, schemaFilePath));
  const outDir = join(BASE_OUTPUT_PATH, schemaRelativeDir);
  return join(outDir, makeFilePath(name, type));
}

export function makeFilePath(name: string, type: FileType): string {
  switch (type) {
    case FileType.Dto:
      return `dto/${kebabCase(name)}.dto.ts`;

    case FileType.Enum:
      return `enums/${kebabCase(name)}.enum.ts`;

    case FileType.Resolver:
      return `${kebabCase(name)}.resolver.ts`;

    default:
      return "";
  }
}

export function getFileTypeFromDefNode(node: DefinitionNode): FileType {
  if (
    node.kind === Kind.OBJECT_TYPE_DEFINITION ||
    node.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION
  ) {
    return FileType.Dto;
  } else {
    return FileType.Enum;
  }
}

export function makeImportPath(filePath: string, importPath: string): string {
  if (importPath.startsWith("@nestjs")) {
    return importPath;
  }

  const path = relative(dirname(filePath), importPath);
  if (!path.startsWith(".")) {
    return `./${path}`;
  } else {
    return path;
  }
}
