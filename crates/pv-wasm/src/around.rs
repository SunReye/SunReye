//! A scene's imported surroundings (ADR 20) for the browser: the document stood where the scene
//! puts it, and the import a scene starts with when the admin loads one.

use serde::Deserialize;
use serde_json::{Value, json};
use sunreye_pv::{Import, Imported, Scene};

use crate::{face, solid};

/// A scene and the document its import names.
#[derive(Deserialize)]
pub struct Around {
    scene: Scene,
    document: Imported,
}

impl Around {
    /// The buildings, each with its id and whether it is hidden, the hedges, the trees' solids,
    /// the ground draped on the terrain and the terrain's grid, in the shading frame; null for
    /// a scene without an import.
    pub fn reply(&self) -> Value {
        let Some(around) = self.scene.around(&self.document) else {
            return Value::Null;
        };
        let buildings: Vec<Value> = around
            .buildings
            .iter()
            .map(|b| {
                let faces: Vec<Value> = b.faces.iter().map(face).collect();
                json!({ "id": b.id, "hidden": b.hidden, "faces": faces })
            })
            .collect();
        let grounds: Vec<Value> = around
            .grounds
            .iter()
            .map(|g| json!({ "finish": g.finish, "width": g.width, "points": g.points }))
            .collect();
        let terrain = &around.terrain;
        json!({
            "buildings": buildings,
            "hedges": around.hedges.iter().map(face).collect::<Vec<_>>(),
            "trees": around.trees.iter().map(solid).collect::<Vec<_>>(),
            "grounds": grounds,
            "terrain": {
                "origin": terrain.origin, "across": terrain.across, "along": terrain.along,
                "side": terrain.side, "heights": terrain.heights,
            },
            "credits": self.document.credits,
        })
    }
}

/// A document just fetched, by its id, for a scene to draw.
#[derive(Deserialize)]
pub struct Loaded {
    id: String,
    scene: Scene,
    document: Imported,
}

impl Loaded {
    /// The import the scene starts with: the document's centre on the scene's origin, and the
    /// building under the blocks hidden.
    pub fn reply(&self) -> Value {
        json!(Import::load(&self.id, &self.scene, &self.document))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use crate::edited;

    use super::{Around, Loaded};

    const ID: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    /// A 10 by 8 m block at the origin; a document with the building under it, a neighbour
    /// 30 m east, a tree, a road and level terrain.
    fn input() -> Value {
        let square = |east: f64| {
            json!([
                [east, -9.0],
                [east + 11.0, -9.0],
                [east + 11.0, 1.0],
                [east, 1.0]
            ])
        };
        json!({
            "id": ID,
            "scene": {
                "north": 0.0,
                "blocks": [{ "x": 0.0, "z": 0.0, "width": 10.0, "depth": 8.0, "eave": 3.0,
                    "rotation": 0.0, "roof": { "kind": "flat" } }],
                "obstacles": [],
            },
            "document": {
                "radius": 100.0,
                "buildings": [
                    { "id": 0, "outline": square(-0.5), "eave": 6.0, "roof": { "kind": "flat" } },
                    { "id": 1, "outline": square(30.0), "eave": 6.0, "roof": { "kind": "flat" } },
                ],
                "trees": [{ "at": [-20.0, 0.0], "height": 8.0, "radius": 2.0, "crown": "conifer" }],
                "hedges": [],
                "grounds": [{ "finish": "road", "outline": [[-50.0, 20.0], [50.0, 20.0]], "width": 5.0 }],
                "terrain": { "step": 100.0, "side": 3, "heights": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0] },
                "credits": ["© OpenStreetMap contributors"],
            },
        })
    }

    fn reply<T: serde::de::DeserializeOwned>(input: &Value, reply: impl Fn(&T) -> Value) -> Value {
        let text = edited(input.to_string().as_bytes(), reply);
        serde_json::from_str::<Value>(&text).unwrap()["ok"].clone()
    }

    #[test]
    fn a_loaded_document_lies_on_the_scenes_origin_with_the_building_under_the_blocks_hidden() {
        let import = reply(&input(), Loaded::reply);

        assert_eq!(
            import,
            json!({ "document": ID, "x": 0.0, "z": 0.0, "turn": 0.0, "hidden": [0] })
        );
    }

    #[test]
    fn the_browser_draws_what_the_scene_stands_around_its_blocks() {
        let mut input = input();
        let none = reply(&input, Around::reply);
        input["scene"]["imported"] =
            json!({ "document": ID, "x": 0.0, "z": 0.0, "turn": 0.0, "hidden": [0] });

        let around = reply(&input, Around::reply);

        assert_eq!(none, Value::Null);
        let hidden: Vec<_> = around["buildings"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| {
                (
                    b["id"].clone(),
                    b["hidden"].clone(),
                    b["faces"].as_array().unwrap().len(),
                )
            })
            .collect();
        // Four walls and a lid of two triangles each.
        assert_eq!(
            hidden,
            vec![(json!(0), json!(true), 6), (json!(1), json!(false), 6)]
        );
        assert_eq!(around["buildings"][1]["faces"][0]["surface"], "wall");
        assert_eq!(around["trees"][0]["kind"], "cylinder");
        assert_eq!(around["trees"][1]["kind"], "cone");
        assert_eq!(
            around["grounds"],
            json!([{ "finish": "road", "width": 5.0,
                "points": [[-50.0, 20.0, 0.0], [50.0, 20.0, 0.0]] }])
        );
        assert_eq!(around["terrain"]["side"], 3);
        assert_eq!(around["terrain"]["origin"], json!([-100.0, -100.0, 0.0]));
        assert_eq!(around["terrain"]["across"], json!([100.0, 0.0, 0.0]));
        assert_eq!(around["terrain"]["heights"].as_array().unwrap().len(), 9);
        assert_eq!(around["credits"], json!(["© OpenStreetMap contributors"]));
    }
}
