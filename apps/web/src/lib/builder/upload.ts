// What the builder hands to the forms below it (ADR 20): who stores an uploaded car body, and
// the session's imported surroundings.
import { createContext } from "svelte";
import type { Core } from "../api/core.ts";
import type { Importing } from "./importing.svelte.ts";

export const [uploader, provideUploader] = createContext<Core["uploadCarBody"]>();

export const [importer, provideImporter] = createContext<Pick<Importing, "loading" | "load">>();
