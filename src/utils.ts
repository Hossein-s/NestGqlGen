import { Kind, parse, StringValueNode } from "graphql";
import { FileSourcePair } from "./loader";

export interface ResolverMethodInfo {
  file: string;
}

export interface ObjectInfo {
  file: string;
  type: "ObjectType" | "InputType" | "Enum" | "Interface";
}

export type TypeInfo = ObjectInfo | ResolverMethodInfo;

export interface FileMapData {
  queries: Map<string, ResolverMethodInfo>;
  mutations: Map<string, ResolverMethodInfo>;
  types: Map<string, ObjectInfo>;
}

export function getFileMapData(fileSources: Array<FileSourcePair>): FileMapData {
  const queries = new Map<string, ResolverMethodInfo>();
  const mutations = new Map<string, ResolverMethodInfo>();
  const types = new Map<string, ObjectInfo>();

  for (const { file, source } of fileSources) {
    const schema = parse(source);

    schema.definitions.forEach((node) => {
      if (
        (node.kind === Kind.OBJECT_TYPE_DEFINITION || node.kind === Kind.OBJECT_TYPE_EXTENSION) &&
        (node.name.value === "Query" || node.name.value === "Mutation")
      ) {
        node.fields?.forEach((fieldNode) => {
          if (node.name.value === "Query") {
            queries.set(fieldNode.name.value, { file });
          } else {
            mutations.set(fieldNode.name.value, { file });
          }
        });
      } else if (node.kind === Kind.OBJECT_TYPE_DEFINITION) {
        types.set(node.name.value, { file, type: "ObjectType" });
      } else if (node.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION) {
        types.set(node.name.value, { file, type: "InputType" });
      } else if (node.kind === Kind.ENUM_TYPE_DEFINITION) {
        types.set(node.name.value, { file, type: "Enum" });
      } else if (node.kind === Kind.INTERFACE_TYPE_DEFINITION) {
        types.set(node.name.value, { file, type: "Interface" });
      }
    });
  }

  return {
    queries,
    mutations,
    types,
  };
}

export function printValue(value: any) {
  if (typeof value === "string") {
    return `"${value}"`;
  }

  return value.toString();
}

export function printDescription(descNode: StringValueNode): string {
  return `"${descNode.value.replace(/\n/g, "\\n")}"`;
}
