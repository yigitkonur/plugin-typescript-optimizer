import { Project } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });
const file = project.getSourceFileOrThrow("src/utils/format.ts");
file.getFunctionOrThrow("formatName").rename("formatFullName");
project.saveSync();
