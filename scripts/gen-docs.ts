import * as fs from "fs";
import { codesMarkdown } from "../src/codes";
fs.writeFileSync("ERROR_CODES.md", codesMarkdown() + "\n");
