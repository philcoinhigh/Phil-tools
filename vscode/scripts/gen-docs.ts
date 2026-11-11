import * as fs from "fs";
import { codesMarkdown } from "../../core/src/codes";
fs.writeFileSync("vscode/ERROR_CODES.md", codesMarkdown() + "\n");
