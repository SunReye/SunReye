//! Identify-probe variants (ADR 5): each the family's base with its overrides, loaded as a whole
//! profile so every rule of the format holds for it.

use serde_json::{Map, Value};

use crate::document::{VariantDoc, VariantIdentifyDoc};
use crate::profile::{LoadError, Profile};

/// The longest variant id.
const ID: usize = 16;

/// Each of `docs`, the variants of the profile file `base`, in file order.
pub fn compile(base: &Value, docs: &[VariantDoc]) -> Result<Vec<Profile>, LoadError> {
    let raws = base.get("variants").and_then(Value::as_array);
    let mut variants: Vec<Profile> = Vec::with_capacity(docs.len());
    for (doc, raw) in docs.iter().zip(raws.into_iter().flatten()) {
        let refuse = |problem: String| LoadError::Variant {
            id: doc.id.clone(),
            problem,
        };
        if !is_id(&doc.id) {
            return Err(refuse(format!(
                "an id is 1 to {ID} lowercase letters, digits or hyphens"
            )));
        }
        if variants
            .iter()
            .any(|v| v.variant() == Some(doc.id.as_str()))
        {
            return Err(refuse("the id is declared twice".into()));
        }
        let merged = merge(base, doc, raw).map_err(refuse)?;
        let variant = Profile::load_variant(&merged, &doc.id).map_err(|e| refuse(e.to_string()))?;
        if let Some(other) = variants.iter().find(|v| v.overlaps(&variant)) {
            let other = other.variant().unwrap_or_default();
            return Err(refuse(format!(
                "its identify values overlap variant `{other}`'s"
            )));
        }
        variants.push(variant);
    }
    Ok(variants)
}

fn is_id(id: &str) -> bool {
    (1..=ID).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// The base file `base` with the overrides of `doc`, whose file is `raw`.
fn merge(base: &Value, doc: &VariantDoc, raw: &Value) -> Result<Value, String> {
    let mut merged = base.clone();
    let Some(object) = merged.as_object_mut() else {
        return Err("a profile is an object".into());
    };
    object.remove("variants");
    object.insert("name".into(), Value::String(doc.name.clone()));
    if let Some(inverter) = raw.get("inverter") {
        object.insert("inverter".into(), inverter.clone());
    }
    for field in doc.identify.iter().flatten() {
        identify(object, field)?;
    }
    let ranges = raw.get("settings").and_then(Value::as_object);
    for (key, range) in ranges.into_iter().flatten() {
        setting(object, key, range)?;
    }
    quantities(object, doc, raw)?;
    Ok(merged)
}

/// The element of the array `field` of `object` whose `name` is `value`.
fn find<'a>(
    object: &'a mut Map<String, Value>,
    field: &str,
    name: &str,
    value: &Value,
) -> Option<&'a mut Map<String, Value>> {
    object
        .get_mut(field)?
        .as_array_mut()?
        .iter_mut()
        .filter_map(Value::as_object_mut)
        .find(|element| element.get(name) == Some(value))
}

fn identify(object: &mut Map<String, Value>, field: &VariantIdentifyDoc) -> Result<(), String> {
    let register = Value::from(field.register);
    let Some(base) = find(object, "identify", "register", &register) else {
        return Err(format!(
            "identify register {} is not a field of the base",
            field.register
        ));
    };
    base.insert("values".into(), Value::from(field.values.clone()));
    Ok(())
}

fn setting(object: &mut Map<String, Value>, key: &str, range: &Value) -> Result<(), String> {
    let Some(setting) = find(object, "settings", "key", &Value::from(key)) else {
        return Err(format!("setting `{key}` is not the base's"));
    };
    if !setting.contains_key("range") {
        return Err(format!("setting `{key}` takes values, not a range"));
    }
    setting.insert("range".into(), range.clone());
    Ok(())
}

/// The base's quantities without those `doc` drops, with those it adds: one under a dropped key
/// in its place, the rest after the base's.
fn quantities(
    object: &mut Map<String, Value>,
    doc: &VariantDoc,
    raw: &Value,
) -> Result<(), String> {
    let base = object
        .get_mut("quantities")
        .and_then(Value::as_array_mut)
        .map(std::mem::take)
        .unwrap_or_default();
    let mut slots: Vec<(String, Option<Value>)> =
        base.into_iter().map(|q| (key(&q), Some(q))).collect();
    for dropped in doc.drop.iter().flatten() {
        let Some(slot) = slots.iter_mut().find(|(k, q)| k == dropped && q.is_some()) else {
            return Err(format!("quantity `{dropped}` is not the base's"));
        };
        slot.1 = None;
    }
    let added = raw.get("add").and_then(Value::as_array);
    for quantity in added.into_iter().flatten() {
        let key = key(quantity);
        match slots.iter_mut().find(|(k, q)| *k == key && q.is_none()) {
            Some(slot) => slot.1 = Some(quantity.clone()),
            None => slots.push((key, Some(quantity.clone()))),
        }
    }
    let kept: Vec<Value> = slots.into_iter().filter_map(|(_, q)| q).collect();
    object.insert("quantities".into(), Value::Array(kept));
    Ok(())
}

fn key(quantity: &Value) -> String {
    quantity
        .get("key")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}
