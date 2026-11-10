//! The SDK's TypeScript types are generated from the document types (ADR 5).

use std::path::Path;

use ts_rs::{Config, TS};

use crate::document::{
    ActivateDoc, BlockDoc, DelayDoc, ExprDoc, HeartbeatDoc, IdentifyDoc, Kind, LiveControlDoc,
    MaskedDoc, PreconditionDoc, ProfileDoc, PublishDoc, QuantityDoc, Range, ReadBackDoc,
    RegisterDoc, RelockDoc, SettingDoc, StepDoc, ToggleDoc, UnlockDoc,
};
use crate::{Block, CAPABILITIES, Inverter, Mppt, Schemas, Support, Unit};

fn declarations() -> String {
    let cfg = Config::new().with_large_int("number");
    let capability = CAPABILITIES
        .iter()
        .map(|name| format!("{name:?}"))
        .collect::<Vec<_>>()
        .join(" | ");
    let decls = [
        format!("type Capability = {capability};"),
        ProfileDoc::decl(&cfg),
        QuantityDoc::decl(&cfg),
        Kind::decl(&cfg),
        Range::decl(&cfg),
        ExprDoc::decl(&cfg),
        IdentifyDoc::decl(&cfg),
        Inverter::decl(&cfg),
        Mppt::decl(&cfg),
        SettingDoc::decl(&cfg),
        LiveControlDoc::decl(&cfg),
        HeartbeatDoc::decl(&cfg),
        Unit::decl(&cfg),
        StepDoc::decl(&cfg),
        RegisterDoc::decl(&cfg),
        BlockDoc::decl(&cfg),
        DelayDoc::decl(&cfg),
        ActivateDoc::decl(&cfg),
        PreconditionDoc::decl(&cfg),
        PublishDoc::decl(&cfg),
        UnlockDoc::decl(&cfg),
        RelockDoc::decl(&cfg),
        ToggleDoc::decl(&cfg),
        MaskedDoc::decl(&cfg),
        ReadBackDoc::decl(&cfg),
        Block::decl(&cfg),
        Support::decl(&cfg),
        Schemas::decl(&cfg),
    ];
    let body: Vec<String> = decls.iter().map(|d| format!("export {d}\n")).collect();
    format!(
        "// Generated from crates/profile by `bun run --cwd packages/sdk types`. Do not edit.\n\n{}",
        body.join("\n")
    )
}

/// A document type changed without regenerating the SDK's types fails here.
/// `SUNREYE_UPDATE_TYPES=1` rewrites them.
#[test]
fn the_committed_sdk_types_are_the_generated_ones() {
    let generated = declarations();
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/sdk/src/generated.ts");

    if std::env::var_os("SUNREYE_UPDATE_TYPES").is_some() {
        std::fs::write(&path, &generated).unwrap();
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();

    assert!(
        committed == generated,
        "{} is stale: run `bun run --cwd packages/sdk types`",
        path.display()
    );
}
