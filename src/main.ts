import { mergeTypeDefs } from "@graphql-tools/merge";
import { join } from "path";
import { BASE_INPUT_PATH, SEARCH_GLOB } from "./config";
import { generate } from "./generate";
import { loadSources } from "./loader";
import { getFileMapData } from "./utils";

async function main() {
  const fileSources = await loadSources(join(BASE_INPUT_PATH, SEARCH_GLOB));
  const typeDefs = await mergeTypeDefs(fileSources.map((f) => f.source));

  const mapData = getFileMapData(fileSources);

  await generate(typeDefs, mapData);
}

main().catch((e) => {
  console.log(e);
});
