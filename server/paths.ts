import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SERVER_DIR = __dirname;
export const ROOT_DIR = join(__dirname, "..");
