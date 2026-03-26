#!/usr/bin/env node
import { register } from "tsx/esm/api"
import { pathToFileURL } from "node:url"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
register()

const entry = pathToFileURL(resolve(__dirname, "..", "src", "index.ts")).href
await import(entry)
