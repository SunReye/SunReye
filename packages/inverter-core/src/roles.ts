// The role catalogue lives in the Rust core (`crates/sunreye/src/role.rs`) and is generated into
// `profile.gen.ts`; this is the only way the engine and the profile SDK reach it.
export { ROLE_CATALOG, ROLE_NAMES, type CanonicalRole, type RoleSpec } from "./profile.gen";
