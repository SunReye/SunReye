// Who stores an uploaded car body: the builder's core, handed to the forms below it (ADR 20).
import { createContext } from "svelte";
import type { Core } from "../api/core.ts";

export const [uploader, provideUploader] = createContext<Core["uploadCarBody"]>();
