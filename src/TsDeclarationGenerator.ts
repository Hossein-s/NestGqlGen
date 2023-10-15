import {
  DefinitionNode,
  EnumTypeDefinitionNode,
  FieldDefinitionNode,
  InputObjectTypeDefinitionNode,
  InputValueDefinitionNode,
  Kind,
  ObjectTypeDefinitionNode,
  TypeNode,
} from "graphql";
import { kebabCase } from "lodash";
import {
  ClassDeclarationStructure,
  EnumDeclarationStructure,
  ImportDeclarationStructure,
  MethodDeclarationStructure,
  ParameterDeclarationStructure,
  StructureKind,
} from "ts-morph";
import { join, relative, dirname } from "path";
import { BASE_INPUT_PATH, BASE_OUTPUT_PATH } from "./config";
import { FileMapData, printDescription, printValue } from "./utils";

export interface GenerateClassResult {
  type: "class";
  declarationStructure: ClassDeclarationStructure;
  imports?: ImportDeclarationStructure[];
}

export interface GenerateEnumResult {
  type: "enum";
  declarationStructure: EnumDeclarationStructure;
  imports?: ImportDeclarationStructure[];
}

export type GenerateResult = GenerateClassResult | GenerateEnumResult;

export interface MethodEntry {
  type: "Query" | "Mutation";
  fieldDefinition: FieldDefinitionNode;
}

export class TsDeclarationGenerator {
  private importNames: Set<string> = new Set();

  constructor(private readonly mapData: FileMapData) {}

  generate(node: DefinitionNode): GenerateResult | null {
    this.importNames = new Set();

    if (
      node.kind === Kind.OBJECT_TYPE_DEFINITION ||
      node.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION
    ) {
      const declarationStructure = this.generateObjectTypeStructure(node);

      return {
        type: "class",
        declarationStructure,
        imports: this.makeImportDeclarationsFromSet(this.importNames),
      };
    } else if (node.kind === Kind.ENUM_TYPE_DEFINITION) {
      const declarationStructure = this.generateEnumStructure(node);

      return {
        declarationStructure,
        type: "enum",
        imports: this.makeImportDeclarationsFromSet(this.importNames),
      };
    }

    return null;
  }

  generateResolver(name: string, methods: Array<MethodEntry>): GenerateResult {
    this.importNames = new Set();
    this.importNames.add("Resolver");

    const declarationStructure: ClassDeclarationStructure = {
      kind: StructureKind.Class,
      name: `${name}Resolver`,
      decorators: [
        { name: "Resolver", arguments: this.mapData.types.has(name) ? [`() => ${name}`] : [] },
      ],
      isExported: true,
      ctors: [{ kind: StructureKind.Constructor }],
      methods: methods.map((method) =>
        this.generateMethodStructure(method.type, method.fieldDefinition)
      ),
    };

    return {
      type: "class",
      declarationStructure,
      imports: this.makeImportDeclarationsFromSet(this.importNames),
    };
  }

  private generateObjectTypeStructure(
    typeDef: ObjectTypeDefinitionNode | InputObjectTypeDefinitionNode
  ): ClassDeclarationStructure {
    const decorator = typeDef.kind === Kind.OBJECT_TYPE_DEFINITION ? "ObjectType" : "InputType";
    this.importNames.add(decorator);

    const decoratorArgs = [];
    if (typeDef.description?.value) {
      decoratorArgs.push(`{ description: ${printDescription(typeDef.description)} }`);
    }

    return {
      kind: StructureKind.Class,
      name: typeDef.name.value,
      decorators: [{ name: decorator, arguments: decoratorArgs }],
      isExported: true,
      properties:
        typeDef.fields?.map((fieldDef, idx) =>
          this.generateObjectPropertyStructure(fieldDef, { newLine: idx > 0 })
        ) ?? [],
    };
  }

  private generateObjectPropertyStructure(
    fieldDef: FieldDefinitionNode | InputValueDefinitionNode,
    options?: { newLine?: boolean }
  ) {
    this.importNames.add("Field");

    const type = this.getType(fieldDef.type);

    const decoratorArgs: string[] = [];
    if (this.doesNeedTypeDecorator(fieldDef.type)) {
      decoratorArgs.push(`() => ${this.getGraphQLType(fieldDef.type)}`);
    }

    const optsArg = this.makeOptsArg(fieldDef);
    if (optsArg) {
      decoratorArgs.push(optsArg);
    }

    return {
      name: fieldDef.name.value,
      type,
      leadingTrivia: options?.newLine ? "\n" : "",
      decorators: [
        {
          name: "Field",
          arguments: decoratorArgs,
        },
      ],
    };
  }

  private generateEnumStructure(enumTypeDef: EnumTypeDefinitionNode): EnumDeclarationStructure {
    return {
      kind: StructureKind.Enum,
      name: enumTypeDef.name.value,
      isExported: true,
      members: enumTypeDef.values?.map((valDef) => ({
        name: valDef.name.value,
      })),
    };
  }

  private generateMethodStructure(
    type: string,
    def: FieldDefinitionNode
  ): MethodDeclarationStructure {
    this.importNames.add(type);

    const decoratorArgs: string[] = [];
    decoratorArgs.push(`() => ${this.getGraphQLType(def.type)}`);

    const optsArg = this.makeOptsArg(def);
    if (optsArg) {
      decoratorArgs.push(optsArg);
    }

    return {
      kind: StructureKind.Method,
      name: def.name.value,
      isAsync: true,
      returnType: `Promise<${this.getType(def.type)}>`,
      decorators: [{ name: type, arguments: decoratorArgs }],
      parameters: def.arguments?.map((arg) => this.generateParameterStructure(arg)),
      statements: [`throw new Error("Method is not implemented")`],
    };
  }

  private generateParameterStructure(def: InputValueDefinitionNode): ParameterDeclarationStructure {
    this.importNames.add("Args");

    const doesNeedType = this.doesNeedTypeDecorator(def.type);
    const isNullable = this.isNullableType(def.type);

    const args = [`"${def.name.value}"`];

    if (isNullable || doesNeedType) {
      const optsArg = [];
      if (doesNeedType) {
        optsArg.push(`type: () => ${this.getGraphQLType(def.type)}`);
      }

      if (isNullable) {
        optsArg.push(`nullable: ${printValue(isNullable)}`);
      }

      args.push(`{ ${optsArg.join(", ")} }`);
    }

    return {
      kind: StructureKind.Parameter,
      name: def.name.value,
      type: this.getType(def.type),
      decorators: [{ name: "Args", arguments: args }],
    };
  }

  private getType(typeNode: TypeNode): string {
    if (typeNode.kind === Kind.NAMED_TYPE) {
      return this.getTsType(typeNode.name.value);
    } else if (typeNode.kind === Kind.NON_NULL_TYPE) {
      return this.getType(typeNode.type);
    } else {
      return `${this.getType(typeNode.type)}[]`;
    }
  }

  private getGraphQLType(typeNode: TypeNode): string {
    if (typeNode.kind === Kind.NAMED_TYPE) {
      return typeNode.name.value;
    } else if (typeNode.kind === Kind.NON_NULL_TYPE) {
      return this.getGraphQLType(typeNode.type);
    } else {
      return `[${this.getGraphQLType(typeNode.type)}]`;
    }
  }

  private doesNeedTypeDecorator(typeNode: TypeNode): boolean {
    if (typeNode.kind === Kind.NAMED_TYPE) {
      const name = typeNode.name.value;
      if (
        name === "Int" ||
        name === "Float" ||
        name === "ID" ||
        this.mapData.types.get(name)?.type === "Enum"
      ) {
        this.importNames.add(name);
        return true;
      } else {
        return false;
      }
    } else if (typeNode.kind === Kind.LIST_TYPE) {
      return true;
    } else {
      return this.doesNeedTypeDecorator(typeNode.type);
    }
  }

  private isNullableType(typeNode: TypeNode): boolean | "items" | "itemsAndList" {
    if (typeNode.kind === Kind.NAMED_TYPE) {
      return true;
    } else if (typeNode.kind === Kind.NON_NULL_TYPE) {
      if (typeNode.type.kind === Kind.LIST_TYPE) {
        return this.nullableTypeValue(false, this.isNullableListItemType(typeNode.type.type));
      } else {
        return false;
      }
    } else if (typeNode.kind === Kind.LIST_TYPE) {
      return this.nullableTypeValue(true, this.isNullableListItemType(typeNode.type));
    } else {
      return false;
    }
  }

  private isNullableListItemType(typeNode: TypeNode): boolean {
    return typeNode.kind !== Kind.NON_NULL_TYPE;
  }

  private nullableTypeValue(list: boolean, items: boolean): boolean | "items" | "itemsAndList" {
    if (list && items) {
      return "itemsAndList";
    } else if (list && !items) {
      return true;
    } else if (!list && items) {
      return "items";
    } else {
      return false;
    }
  }

  private getTsType(type: string) {
    switch (type) {
      case "String":
        return "string";

      case "DateTime":
        return "Date";

      case "Int":
      case "Float":
        return "number";

      case "Boolean":
        return "boolean";

      case "ID":
        this.importNames.add("ID");
        return "string";

      default:
        // import custom type
        this.importNames.add(type);
        return type;
    }
  }

  private makeOptsArg(def: FieldDefinitionNode | InputValueDefinitionNode) {
    const isNullable = this.isNullableType(def.type);

    const optsArg = [];
    if (isNullable) {
      optsArg.push(`nullable: ${printValue(isNullable)}`);
    }

    if (def.description?.value) {
      optsArg.push(`description: ${printDescription(def.description)}`);
    }

    return `{ ${optsArg.join(", ")} }`;
  }

  private makeImportDeclarationsFromSet(set: Set<string>): ImportDeclarationStructure[] {
    const map = new Map<string, ImportDeclarationStructure>();

    [...set].forEach((name) => {
      const ourObject = this.mapData.types.get(name);

      let module;
      if (ourObject) {
        const filePath =
          ourObject.type === "Enum"
            ? `/enums/${kebabCase(name)}.enum`
            : `/dto/${kebabCase(name)}.dto`;

        module = join(
          BASE_OUTPUT_PATH,
          dirname(relative(BASE_INPUT_PATH, ourObject.file)),
          filePath
        );
      } else {
        module = "@nestjs/graphql";
      }

      if (!map.has(module)) {
        map.set(module, {
          kind: StructureKind.ImportDeclaration,
          namedImports: [],
          moduleSpecifier: module,
        });
      }

      (map.get(module)!.namedImports as string[]).push(name);
    });

    return [...map.values()];
  }
}
