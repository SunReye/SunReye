use serde_json::{Value, json};

use crate::modules::{Datasheet, bundled};
use crate::{Invalid, Sheet};

/// AIKO's A450 as its datasheet `DS_EN_2405_V1.5` prints it.
fn sheet() -> Value {
    json!({
        "maker": "AIKO", "series": "Neostar 2S+",
        "source": { "title": "Neostar 2S+ AIKO-A-MAH54Db 440-470W", "revision": "DS_EN_2405_V1.5",
            "url": "https://aikosolar.com/datasheet.pdf" },
        "modules": [{
            "name": "AIKO-A450-MAH54Db", "pmax": 450.0, "vmp": 34.5, "imp": 13.05, "voc": 40.94,
            "isc": 14.12, "powerCoefficient": -0.26, "voltageCoefficient": -0.22,
            "currentCoefficient": 0.05, "width": 1.134, "height": 1.757, "bypassDiodes": 3,
        }],
    })
}

fn refused(sheet: &Value) -> Invalid {
    Sheet::parse(&sheet.to_string()).unwrap_err()
}

#[test]
fn a_sheet_copied_from_its_datasheet_loads() {
    let parsed = Sheet::parse(&sheet().to_string()).unwrap();

    assert_eq!(parsed.modules[0].name, "AIKO-A450-MAH54Db");
    assert_eq!(parsed.source.revision, "DS_EN_2405_V1.5");
    assert_eq!(serde_json::to_value(&parsed).unwrap(), sheet());
}

#[test]
fn a_module_sheet_without_its_maker_or_series_is_refused() {
    for member in ["maker", "series"] {
        let mut unnamed = sheet();
        unnamed.as_object_mut().unwrap().remove(member);
        assert_eq!(refused(&unnamed), Invalid::Source, "{member}");

        let mut blank = sheet();
        blank[member] = json!(" ");
        assert_eq!(refused(&blank), Invalid::Source, "{member}");
    }
}

#[test]
fn a_value_out_of_its_range_is_refused() {
    let out_of_range = [
        ("vmp", json!(41.0)),   // above Voc
        ("imp", json!(14.5)),   // above Isc
        ("pmax", json!(500.0)), // not Vmp × Imp
        ("powerCoefficient", json!(0.26)),
        ("voltageCoefficient", json!(-2.2)),
        ("currentCoefficient", json!(-0.05)),
        ("height", json!(1757.0)), // millimetres, not metres
        ("width", json!(0.0)),
        ("bypassDiodes", json!(0)),
    ];
    for (field, value) in out_of_range {
        let mut bad = sheet();
        bad["modules"][0][field] = value;
        let typed: Datasheet = serde_json::from_value(bad["modules"][0].clone()).unwrap();
        let invalid = Invalid::Value {
            model: "AIKO-A450-MAH54Db".into(),
            field: field.into(),
        };
        assert_eq!(typed.check(), Err(invalid.clone()), "{field}");
        assert_eq!(refused(&bad), invalid, "{field}");
    }
}

#[test]
fn a_module_typed_from_its_datasheet_passes() {
    let typed: Datasheet = serde_json::from_value(sheet()["modules"][0].clone()).unwrap();

    assert_eq!(typed.check(), Ok(()));
}

#[test]
fn a_sheet_without_its_source_or_modules_is_refused() {
    let mut untitled = sheet();
    untitled["source"]["revision"] = json!("");
    assert!(matches!(refused(&untitled), Invalid::Source));

    let mut empty = sheet();
    empty["modules"] = json!([]);
    assert!(matches!(refused(&empty), Invalid::Source));

    let mut unsourced = sheet();
    unsourced.as_object_mut().unwrap().remove("source");
    assert!(matches!(refused(&unsourced), Invalid::Json(_)));
}

#[test]
fn every_bundled_sheet_loads_and_names_its_datasheet() {
    let sheets = bundled().unwrap();
    let files = std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/modules")).unwrap();

    assert_eq!(sheets.len(), files.count());

    assert!(
        sheets
            .iter()
            .any(|s| s.maker.as_deref() == Some("AIKO")
                && s.series.as_deref() == Some("Neostar 2S+"))
    );
    for sheet in &sheets {
        assert!(
            sheet.source.url.starts_with("https://"),
            "{}",
            sheet.source.title
        );
    }
}
