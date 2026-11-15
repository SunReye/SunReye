//! Identify-probe variants (ADR 5): each the family's base with its overrides, loaded as a whole
//! profile so every rule of the format holds for it.

use std::sync::Arc;

use crate::document::{ProfileDoc, QuantityDoc, Range, VariantDoc, VariantIdentifyDoc};
use crate::profile::{Inverter, LoadError, Mppt, Profile};

/// The longest variant id.
const ID: usize = 16;

/// Each of `docs`, the variants of the family whose base is `base`, in file order.
pub fn compile(base: &ProfileDoc, docs: Vec<VariantDoc>) -> Result<Vec<Arc<Profile>>, LoadError> {
    let mut variants: Vec<Arc<Profile>> = Vec::with_capacity(docs.len());
    for doc in docs {
        let id = doc.id.clone();
        let refuse = |problem: String| LoadError::Variant {
            id: id.clone(),
            problem,
        };
        if !is_id(&id) {
            return Err(refuse(format!(
                "an id is 1 to {ID} lowercase letters, digits or hyphens"
            )));
        }
        if variants.iter().any(|v| v.variant() == Some(id.as_str())) {
            return Err(refuse("the id is declared twice".into()));
        }
        let merged = merge(base.clone(), doc).map_err(refuse)?;
        let variant = Profile::load_variant(merged, &id).map_err(|e| refuse(e.to_string()))?;
        if let Some((base, own)) = base.inverter.as_ref().zip(variant.inverter())
            && let Some(problem) = exceeds(base, own)
        {
            return Err(refuse(problem));
        }
        if let Some(other) = variants.iter().find(|v| v.overlaps(&variant)) {
            let other = other.variant().unwrap_or_default();
            return Err(refuse(format!(
                "its identify values overlap variant `{other}`'s"
            )));
        }
        variants.push(Arc::new(variant));
    }
    Ok(variants)
}

fn is_id(id: &str) -> bool {
    (1..=ID).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// How `own`, a variant's limits, exceed `base`'s: the base serves a device that matches no
/// variant, so it holds the family's largest (ADR 5). No rating is no cap; an input the base does
/// not declare has no limit there.
fn exceeds(base: &Inverter, own: &Inverter) -> Option<String> {
    let cap = |inverter: &Inverter| inverter.ac_rating.unwrap_or(f64::INFINITY);
    if cap(own) > cap(base) {
        return Some("its AC rating exceeds the base's".into());
    }
    if own.max_input_voltage > base.max_input_voltage {
        return Some("its maximum input voltage exceeds the base's".into());
    }
    let wider = |(own, base): &(&Mppt, &Mppt)| {
        own.max_current > base.max_current
            || own.max_voltage > base.max_voltage
            || own.min_voltage < base.min_voltage
            || own.start_voltage < base.start_voltage
    };
    let input = own
        .mppt
        .iter()
        .zip(&base.mppt)
        .position(|pair| wider(&pair))?;
    Some(format!(
        "MPPT input {} exceeds the base's limits",
        input + 1
    ))
}

/// `base` with the overrides of `doc`.
fn merge(mut base: ProfileDoc, doc: VariantDoc) -> Result<ProfileDoc, String> {
    base.name = doc.name;
    if doc.inverter.is_some() {
        base.inverter = doc.inverter;
    }
    for field in doc.identify.into_iter().flatten() {
        identify(&mut base, field)?;
    }
    for (key, range) in doc.settings.into_iter().flatten() {
        setting(&mut base, &key, range)?;
    }
    let (dropped, added) = (doc.drop.unwrap_or_default(), doc.add.unwrap_or_default());
    base.quantities = quantities(std::mem::take(&mut base.quantities), &dropped, added)?;
    Ok(base)
}

fn identify(base: &mut ProfileDoc, field: VariantIdentifyDoc) -> Result<(), String> {
    let fields = base.identify.iter_mut().flatten();
    let Some(of_base) = fields.into_iter().find(|f| f.register == field.register) else {
        return Err(format!(
            "identify register {} is not a field of the base",
            field.register
        ));
    };
    of_base.values = Some(field.values);
    Ok(())
}

fn setting(base: &mut ProfileDoc, key: &str, range: Range) -> Result<(), String> {
    let Some(setting) = base.settings.iter_mut().find(|s| s.key == key) else {
        return Err(format!("setting `{key}` is not the base's"));
    };
    if setting.range.is_none() {
        return Err(format!("setting `{key}` takes values, not a range"));
    }
    setting.range = Some(range);
    Ok(())
}

/// The quantities of `base` without the `dropped`, with the `added`: one under a dropped key in
/// its place, the rest after the base's.
fn quantities(
    base: Vec<QuantityDoc>,
    dropped: &[String],
    added: Vec<QuantityDoc>,
) -> Result<Vec<QuantityDoc>, String> {
    let mut slots: Vec<(String, Option<QuantityDoc>)> =
        base.into_iter().map(|q| (q.key.clone(), Some(q))).collect();
    for key in dropped {
        let Some(slot) = slots.iter_mut().find(|(k, q)| k == key && q.is_some()) else {
            return Err(format!("quantity `{key}` is not the base's"));
        };
        slot.1 = None;
    }
    for quantity in added {
        match slots
            .iter_mut()
            .find(|(k, q)| *k == quantity.key && q.is_none())
        {
            Some(slot) => slot.1 = Some(quantity),
            None => slots.push((quantity.key.clone(), Some(quantity))),
        }
    }
    Ok(slots.into_iter().filter_map(|(_, q)| q).collect())
}
