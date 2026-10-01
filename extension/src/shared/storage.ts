/**
 * Stable storage entry point.
 *
 * The persistence implementation lives in `storage_impl.ts`; this facade keeps
 * every existing `shared/storage` import path stable. Declare nothing here: a
 * local export would shadow the implementation's export of the same name and
 * let two public types or functions drift apart.
 */
export * from "./storage_impl";
