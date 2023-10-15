import {
  DefinitionNode,
  DocumentNode,
  EnumTypeDefinitionNode,
  InputObjectTypeDefinitionNode,
  Kind,
  ObjectTypeDefinitionNode,
} from "graphql";
import { Project } from "ts-morph";
import { camelCase, groupBy, upperFirst } from "lodash";
import { GenerateResult, MethodEntry, TsDeclarationGenerator } from "./TsDeclarationGenerator";
import { basename } from "path";
import {
  FileType,
  getFileTypeFromDefNode,
  makeImportPath,
  makeOutputFilePath,
} from "./path-helper";
import { FileMapData } from "./utils";

export async function generate(document: DocumentNode, mapData: FileMapData) {
  const project = new Project();

  const tsDeclarationGenerator = new TsDeclarationGenerator(mapData);

  // iterate over definitions and create files
  function isAllowedNode(
    node: DefinitionNode
  ): node is ObjectTypeDefinitionNode | InputObjectTypeDefinitionNode | EnumTypeDefinitionNode {
    return [
      Kind.OBJECT_TYPE_DEFINITION,
      Kind.INPUT_OBJECT_TYPE_DEFINITION,
      Kind.ENUM_TYPE_DEFINITION,
    ].includes(node.kind);
  }

  // generate dtos and enums
  await Promise.all(
    document.definitions.map(async (node) => {
      if (!isAllowedNode(node)) {
        return;
      }

      if (node.name.value === "Query" || node.name.value === "Mutation") {
        return;
      }

      // create file path for object
      const schemaFilePath = mapData.types.get((node as ObjectTypeDefinitionNode).name.value)!.file;
      await generateFile(
        project,
        makeOutputFilePath(schemaFilePath, node.name.value, getFileTypeFromDefNode(node)),
        () => tsDeclarationGenerator.generate(node)!
      );
    })
  );

  // find query and mutation definition objects
  const queryObject = document.definitions.find(
    (d): d is ObjectTypeDefinitionNode =>
      d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === "Query"
  );
  const mutationObject = document.definitions.find(
    (d): d is ObjectTypeDefinitionNode =>
      d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === "Mutation"
  );

  // group query and mutations by file path
  const resolverDefs = groupBy(
    [
      ...[...mapData.queries.entries()].map<MethodEntry & { file: string }>(([name, info]) => ({
        type: "Query",
        fieldDefinition: queryObject!.fields!.find((f) => f.name.value === name)!,
        ...info,
      })),
      ...[...mapData.mutations.entries()].map<MethodEntry & { file: string }>(([name, info]) => ({
        type: "Mutation",
        fieldDefinition: mutationObject!.fields!.find((f) => f.name.value === name)!,
        ...info,
      })),
    ],
    (rm) => rm.file
  );

  await Promise.all(
    Object.keys(resolverDefs).map(async (path) => {
      const methods = resolverDefs[path];

      const resolverName = upperFirst(camelCase(basename(path, "Schema.graphql")));

      // create file path for object
      await generateFile(project, makeOutputFilePath(path, resolverName, FileType.Resolver), () =>
        tsDeclarationGenerator.generateResolver(resolverName, methods)
      );
    })
  );
}

export async function generateFile(
  project: Project,
  path: string,
  declarationProvider: () => GenerateResult
) {
  const outFile = project.createSourceFile(path, "", { overwrite: true });

  const declaration = await declarationProvider();

  if (declaration?.type === "class") {
    outFile.addClass(declaration.declarationStructure);
  } else if (declaration?.type === "enum") {
    outFile.addEnum(declaration.declarationStructure);
  }

  if (declaration?.imports?.length) {
    outFile.addImportDeclarations(
      declaration.imports.map((imp) => ({
        ...imp,
        moduleSpecifier: makeImportPath(path, imp.moduleSpecifier),
      }))
    );
  }

  await outFile.save();
}
