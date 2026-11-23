// Generated from crates/core/openapi.json by `bun run --cwd packages/scene types`. Do not edit.

/** The scene's JSON Schema (2020-12), as the core reads a stored scene. */
export const SCENE_SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$ref": "#/$defs/Scene",
  "$defs": {
    "Block": {
      "additionalProperties": false,
      "description": "A rectangular footprint with one roof. Its width runs along x and its depth along z from its\ncorner, before it turns.",
      "properties": {
        "depth": {
          "type": "number"
        },
        "eave": {
          "description": "The walls' height under the roof.",
          "type": "number"
        },
        "freeForm": {
          "oneOf": [
            {
              "$ref": "#/$defs/FreeForm",
              "description": "A polygon footprint under free-form roof faces; with it the corner, size, eave, rotation\nand roof above go unused."
            },
            {
              "type": "null"
            }
          ]
        },
        "open": {
          "description": "A carport: a post at each corner instead of walls.",
          "type": "boolean"
        },
        "overhang": {
          "$ref": "#/$defs/Overhang",
          "description": "How far the roof reaches past the walls; none when stored without it."
        },
        "roof": {
          "$ref": "#/$defs/Roof"
        },
        "roofColour": {
          "description": "`#rrggbb`; the generated finish's own colour without one.",
          "type": [
            "string",
            "null"
          ]
        },
        "rotation": {
          "description": "Degrees clockwise about the corner, seen from above.",
          "type": "number"
        },
        "wallColour": {
          "type": [
            "string",
            "null"
          ]
        },
        "width": {
          "type": "number"
        },
        "x": {
          "type": "number"
        },
        "z": {
          "type": "number"
        }
      },
      "required": [
        "x",
        "z",
        "width",
        "depth",
        "eave",
        "rotation",
        "roof"
      ],
      "type": "object"
    },
    "CarPlace": {
      "additionalProperties": false,
      "description": "A parking footprint: its width runs along x and its length along z from its corner, before\nit turns.",
      "properties": {
        "colour": {
          "description": "The default body's paint, `#rrggbb`; the browser's own grey without one.",
          "type": [
            "string",
            "null"
          ]
        },
        "device": {
          "description": "The EVCC loadpoint device's id (ADR 10).",
          "minimum": 0,
          "type": "integer"
        },
        "length": {
          "description": "An uploaded body is scaled to it.",
          "type": "number"
        },
        "model": {
          "description": "The uploaded GLB's id, its SHA-256 in hex; it replaces the default body.",
          "type": [
            "string",
            "null"
          ]
        },
        "rotation": {
          "description": "Degrees clockwise about the corner, seen from above.",
          "type": "number"
        },
        "width": {
          "type": "number"
        },
        "x": {
          "type": "number"
        },
        "z": {
          "type": "number"
        }
      },
      "required": [
        "device",
        "x",
        "z",
        "width",
        "length",
        "rotation"
      ],
      "type": "object"
    },
    "Chimney": {
      "additionalProperties": false,
      "description": "An upright box standing on a block's roof face, placed in the face's outline like its module\ngrid: metres across the slope and up it from the face's lowest corner on the left.",
      "properties": {
        "across": {
          "description": "Its centre on the face.",
          "type": "number"
        },
        "block": {
          "description": "The block's index in the scene.",
          "minimum": 0,
          "type": "integer"
        },
        "depth": {
          "type": "number"
        },
        "face": {
          "description": "The roof face's index in its block, as module grids name it.",
          "minimum": 0,
          "type": "integer"
        },
        "height": {
          "description": "Its level top stands this high over the roof where its upper side meets it.",
          "type": "number"
        },
        "up": {
          "type": "number"
        },
        "width": {
          "description": "Its level size: across the slope, and along the fall line seen from above.",
          "type": "number"
        }
      },
      "required": [
        "block",
        "face",
        "across",
        "up",
        "width",
        "depth",
        "height"
      ],
      "type": "object"
    },
    "Covering": {
      "description": "What a roof face is covered with.",
      "enum": [
        "tiles",
        "slate",
        "metal",
        "bitumen"
      ],
      "type": "string"
    },
    "Crown": {
      "description": "A tree's crown, by its leaves.",
      "enum": [
        "broadleaf",
        "conifer"
      ],
      "type": "string"
    },
    "Equipment": {
      "additionalProperties": false,
      "description": "A marker linked to its device, placed on a block's wall.",
      "properties": {
        "along": {
          "description": "Metres from the wall's left end, seen from outside.",
          "type": "number"
        },
        "block": {
          "description": "The block's index in the scene.",
          "minimum": 0,
          "type": "integer"
        },
        "device": {
          "description": "The device's id.",
          "minimum": 0,
          "type": "integer"
        },
        "inside": {
          "description": "Behind the wall, in the building.",
          "type": "boolean"
        },
        "kind": {
          "$ref": "#/$defs/EquipmentKind"
        },
        "wall": {
          "$ref": "#/$defs/Wall"
        }
      },
      "required": [
        "device",
        "kind",
        "block",
        "wall",
        "along",
        "inside"
      ],
      "type": "object"
    },
    "EquipmentKind": {
      "description": "What a marker stands for; a hybrid inverter may carry one of each.",
      "enum": [
        "inverter",
        "battery"
      ],
      "type": "string"
    },
    "FaceDetail": {
      "additionalProperties": false,
      "description": "A roof face's covering and pitch, named by block and face as a module grid names it.",
      "properties": {
        "block": {
          "description": "The block's index in the scene.",
          "minimum": 0,
          "type": "integer"
        },
        "covering": {
          "oneOf": [
            {
              "$ref": "#/$defs/Covering",
              "description": "Unknown without one."
            },
            {
              "type": "null"
            }
          ]
        },
        "face": {
          "description": "The roof face's index in its block, as module grids name it.",
          "minimum": 0,
          "type": "integer"
        },
        "pitchConfirmed": {
          "description": "Its pitch was confirmed, not estimated.",
          "type": "boolean"
        }
      },
      "required": [
        "block",
        "face"
      ],
      "type": "object"
    },
    "Fence": {
      "additionalProperties": false,
      "description": "A polyline on the ground through `points`.",
      "properties": {
        "finish": {
          "$ref": "#/$defs/FenceFinish"
        },
        "height": {
          "type": "number"
        },
        "points": {
          "items": {
            "$ref": "#/$defs/FencePoint"
          },
          "type": "array"
        }
      },
      "required": [
        "points",
        "height",
        "finish"
      ],
      "type": "object"
    },
    "FenceFinish": {
      "enum": [
        "wood",
        "metal",
        "wall"
      ],
      "type": "string"
    },
    "FencePoint": {
      "additionalProperties": false,
      "description": "A point on the ground in the scene's frame.",
      "properties": {
        "x": {
          "type": "number"
        },
        "z": {
          "type": "number"
        }
      },
      "required": [
        "x",
        "z"
      ],
      "type": "object"
    },
    "FreeForm": {
      "additionalProperties": false,
      "description": "A footprint and the faces over it, in the scene's frame before the compass turns it.",
      "properties": {
        "faces": {
          "description": "Each face's corners as x, y and z, in metres, counter-clockwise seen from above.",
          "items": {
            "items": {
              "items": {
                "type": "number"
              },
              "type": "array"
            },
            "type": "array"
          },
          "type": "array"
        },
        "footprint": {
          "description": "Corners as x and z, in metres.",
          "items": {
            "items": {
              "type": "number"
            },
            "type": "array"
          },
          "type": "array"
        },
        "traced": {
          "oneOf": [
            {
              "$ref": "#/$defs/Traced",
              "description": "The lines a traced roof's faces are derived from; none for faces entered as they are."
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "footprint",
        "faces"
      ],
      "type": "object"
    },
    "GridModule": {
      "additionalProperties": false,
      "description": "A module on a roof face.",
      "properties": {
        "across": {
          "description": "Its lower left corner across and up the face's outline, in metres, seen from the front.",
          "type": "number"
        },
        "landscape": {
          "description": "Long side across the slope.",
          "type": "boolean"
        },
        "optimized": {
          "type": "boolean"
        },
        "order": {
          "description": "Its place along its string's wiring, which runs through the string's modules from the\nlowest; a module without one follows them.",
          "minimum": 0,
          "type": [
            "integer",
            "null"
          ]
        },
        "string": {
          "description": "The string it is painted into; unassigned, it produces nothing.",
          "minimum": 0,
          "type": [
            "integer",
            "null"
          ]
        },
        "up": {
          "type": "number"
        }
      },
      "required": [
        "across",
        "up",
        "landscape"
      ],
      "type": "object"
    },
    "GroundFinish": {
      "enum": [
        "lawn",
        "paving",
        "driveway",
        "gravel",
        "path"
      ],
      "type": "string"
    },
    "GroundSurface": {
      "additionalProperties": false,
      "description": "A rectangle on the plot: its width runs along x and its depth along z from its corner,\nbefore it turns.",
      "properties": {
        "depth": {
          "type": "number"
        },
        "finish": {
          "$ref": "#/$defs/GroundFinish"
        },
        "rotation": {
          "description": "Degrees clockwise about the corner, seen from above.",
          "type": "number"
        },
        "width": {
          "type": "number"
        },
        "x": {
          "type": "number"
        },
        "z": {
          "type": "number"
        }
      },
      "required": [
        "x",
        "z",
        "width",
        "depth",
        "rotation",
        "finish"
      ],
      "type": "object"
    },
    "Light": {
      "description": "An opening's light at night (ADR 20 Night).",
      "enum": [
        "auto",
        "on",
        "off"
      ],
      "type": "string"
    },
    "ModuleGrid": {
      "additionalProperties": false,
      "description": "The modules on one roof face, all of one module type.",
      "properties": {
        "block": {
          "description": "The block's index in the scene.",
          "minimum": 0,
          "type": "integer"
        },
        "face": {
          "description": "The roof face's index in its block, in the order the `pv` crate lists a block's roof faces.",
          "minimum": 0,
          "type": "integer"
        },
        "landscape": {
          "description": "The orientation a new module takes: its long side across the slope.",
          "type": "boolean"
        },
        "moduleType": {
          "description": "The id of the module type, which sizes the modules.",
          "minimum": 0,
          "type": "integer"
        },
        "modules": {
          "items": {
            "$ref": "#/$defs/GridModule"
          },
          "type": "array"
        },
        "setback": {
          "description": "Metres kept free along every edge of the face.",
          "type": "number"
        }
      },
      "required": [
        "block",
        "face",
        "moduleType",
        "landscape",
        "setback",
        "modules"
      ],
      "type": "object"
    },
    "Obstacle": {
      "description": "Opaque things that cast shade. Positions are a box's corner, else the foot's centre.",
      "oneOf": [
        {
          "description": "A neighbour or a wall.",
          "properties": {
            "depth": {
              "type": "number"
            },
            "height": {
              "type": "number"
            },
            "kind": {
              "enum": [
                "box"
              ],
              "type": "string"
            },
            "rotation": {
              "type": "number"
            },
            "width": {
              "type": "number"
            },
            "x": {
              "type": "number"
            },
            "z": {
              "type": "number"
            }
          },
          "required": [
            "x",
            "z",
            "width",
            "depth",
            "height",
            "rotation",
            "kind"
          ],
          "type": "object"
        },
        {
          "description": "A chimney or a pole.",
          "properties": {
            "height": {
              "type": "number"
            },
            "kind": {
              "enum": [
                "cylinder"
              ],
              "type": "string"
            },
            "radius": {
              "type": "number"
            },
            "x": {
              "type": "number"
            },
            "z": {
              "type": "number"
            }
          },
          "required": [
            "x",
            "z",
            "radius",
            "height",
            "kind"
          ],
          "type": "object"
        },
        {
          "description": "A trunk under a crown of `radius` whose top is at `height`: a broadleaf's a sphere, a\nconifer's a cone from a fifth of the height.",
          "properties": {
            "crown": {
              "$ref": "#/$defs/Crown"
            },
            "height": {
              "type": "number"
            },
            "kind": {
              "enum": [
                "tree"
              ],
              "type": "string"
            },
            "radius": {
              "type": "number"
            },
            "x": {
              "type": "number"
            },
            "z": {
              "type": "number"
            }
          },
          "required": [
            "x",
            "z",
            "radius",
            "height",
            "kind"
          ],
          "type": "object"
        },
        {
          "description": "A straight row: a box whose length runs along x and its depth along z from its corner.",
          "properties": {
            "depth": {
              "type": "number"
            },
            "height": {
              "type": "number"
            },
            "kind": {
              "enum": [
                "hedge"
              ],
              "type": "string"
            },
            "length": {
              "type": "number"
            },
            "rotation": {
              "type": "number"
            },
            "x": {
              "type": "number"
            },
            "z": {
              "type": "number"
            }
          },
          "required": [
            "x",
            "z",
            "length",
            "depth",
            "height",
            "rotation",
            "kind"
          ],
          "type": "object"
        }
      ]
    },
    "Opening": {
      "additionalProperties": false,
      "description": "A window or a door in a block's wall.",
      "properties": {
        "along": {
          "description": "Metres from the wall's left end to the opening's left edge, seen from outside.",
          "type": "number"
        },
        "block": {
          "description": "The block's index in the scene.",
          "minimum": 0,
          "type": "integer"
        },
        "height": {
          "type": "number"
        },
        "kind": {
          "$ref": "#/$defs/OpeningKind"
        },
        "light": {
          "$ref": "#/$defs/Light",
          "description": "Whether it glows at night; the rule's choice is not stored, so a scene stored before the\nchoice existed loads and saves as it was."
        },
        "sill": {
          "description": "Metres from the ground to its lower edge; a door's is 0.",
          "type": "number"
        },
        "wall": {
          "$ref": "#/$defs/Wall"
        },
        "width": {
          "type": "number"
        }
      },
      "required": [
        "kind",
        "block",
        "wall",
        "along",
        "width",
        "height"
      ],
      "type": "object"
    },
    "OpeningKind": {
      "enum": [
        "window",
        "frenchWindow",
        "frontDoor",
        "garageDoor"
      ],
      "type": "string"
    },
    "Overhang": {
      "additionalProperties": false,
      "description": "Metres a roof reaches past the walls, measured level: at the eaves (Traufe) and at the gable\nends or verges (Ortgang). A flat or hip roof has eaves all round.",
      "properties": {
        "eave": {
          "type": "number"
        },
        "verge": {
          "type": "number"
        }
      },
      "required": [
        "eave",
        "verge"
      ],
      "type": "object"
    },
    "Roof": {
      "description": "Pitches in degrees from horizontal.",
      "oneOf": [
        {
          "properties": {
            "kind": {
              "enum": [
                "flat"
              ],
              "type": "string"
            }
          },
          "required": [
            "kind"
          ],
          "type": "object"
        },
        {
          "description": "Rises from the front eave (+z) to the back.",
          "properties": {
            "kind": {
              "enum": [
                "monoPitch"
              ],
              "type": "string"
            },
            "pitch": {
              "type": "number"
            }
          },
          "required": [
            "pitch",
            "kind"
          ],
          "type": "object"
        },
        {
          "description": "Its ridge runs along the width.",
          "properties": {
            "kind": {
              "enum": [
                "gable"
              ],
              "type": "string"
            },
            "pitch": {
              "type": "number"
            }
          },
          "required": [
            "pitch",
            "kind"
          ],
          "type": "object"
        },
        {
          "description": "Its ridge runs along the longer side.",
          "properties": {
            "kind": {
              "enum": [
                "hip"
              ],
              "type": "string"
            },
            "pitch": {
              "type": "number"
            }
          },
          "required": [
            "pitch",
            "kind"
          ],
          "type": "object"
        }
      ]
    },
    "RoofWindow": {
      "additionalProperties": false,
      "description": "A window lying flush in a block's roof face, placed in the face's outline like a chimney:\nmetres across the slope and up it from the face's lowest corner on the left.",
      "properties": {
        "across": {
          "description": "Its centre on the face.",
          "type": "number"
        },
        "block": {
          "description": "The block's index in the scene.",
          "minimum": 0,
          "type": "integer"
        },
        "face": {
          "description": "The roof face's index in its block, as module grids name it.",
          "minimum": 0,
          "type": "integer"
        },
        "length": {
          "type": "number"
        },
        "up": {
          "type": "number"
        },
        "width": {
          "description": "Its size: across the slope, and up it.",
          "type": "number"
        }
      },
      "required": [
        "block",
        "face",
        "across",
        "up",
        "width",
        "length"
      ],
      "type": "object"
    },
    "Scene": {
      "additionalProperties": false,
      "description": "The geometry of a plant and where its modules sit.",
      "properties": {
        "blocks": {
          "items": {
            "$ref": "#/$defs/Block"
          },
          "type": "array"
        },
        "carPlaces": {
          "items": {
            "$ref": "#/$defs/CarPlace"
          },
          "type": "array"
        },
        "chimneys": {
          "description": "Rectangular chimneys standing on roof faces.",
          "items": {
            "$ref": "#/$defs/Chimney"
          },
          "type": "array"
        },
        "equipment": {
          "description": "Markers for inverters and batteries.",
          "items": {
            "$ref": "#/$defs/Equipment"
          },
          "type": "array"
        },
        "faceDetails": {
          "description": "What is known of roof faces: their covering and whether their pitch is confirmed. A face\nwithout one has an unknown covering and an estimated pitch.",
          "items": {
            "$ref": "#/$defs/FaceDetail"
          },
          "type": "array"
        },
        "fences": {
          "description": "Drawn only; they never shade.",
          "items": {
            "$ref": "#/$defs/Fence"
          },
          "type": "array"
        },
        "grids": {
          "description": "At most one per roof face.",
          "items": {
            "$ref": "#/$defs/ModuleGrid"
          },
          "type": "array"
        },
        "north": {
          "description": "The compass bearing, in degrees clockwise from true north, of the scene's forward axis, −z.",
          "type": "number"
        },
        "obstacles": {
          "items": {
            "$ref": "#/$defs/Obstacle"
          },
          "type": "array"
        },
        "openings": {
          "description": "Windows and doors on the blocks' walls. Drawn only; they never shade.",
          "items": {
            "$ref": "#/$defs/Opening"
          },
          "type": "array"
        },
        "roofWindows": {
          "description": "Windows lying flush in roof faces. Drawn only; they never shade.",
          "items": {
            "$ref": "#/$defs/RoofWindow"
          },
          "type": "array"
        },
        "surfaces": {
          "description": "Drawn in order, each over the last; without any the plot is lawn. They never shade.",
          "items": {
            "$ref": "#/$defs/GroundSurface"
          },
          "type": "array"
        }
      },
      "required": [
        "north",
        "blocks",
        "obstacles"
      ],
      "type": "object"
    },
    "Traced": {
      "additionalProperties": false,
      "description": "A traced roof's source (ADR 20): its points and lines, and the points each face's corners are.",
      "properties": {
        "eaves": {
          "description": "The points the person made eaves: a pull of the eaves raises them.",
          "items": {
            "minimum": 0,
            "type": "integer"
          },
          "type": "array"
        },
        "faces": {
          "description": "For each face, in the order of the faces, the points its corners are.",
          "items": {
            "items": {
              "minimum": 0,
              "type": "integer"
            },
            "type": "array"
          },
          "type": "array"
        },
        "lines": {
          "description": "Each line's two points.",
          "items": {
            "items": {
              "minimum": 0,
              "type": "integer"
            },
            "type": "array"
          },
          "type": "array"
        },
        "points": {
          "description": "Each point as x, y and z, in metres; y is its height now.",
          "items": {
            "items": {
              "type": "number"
            },
            "type": "array"
          },
          "type": "array"
        },
        "ridges": {
          "description": "The points the person made ridges: a pull of the ridges raises them.",
          "items": {
            "minimum": 0,
            "type": "integer"
          },
          "type": "array"
        },
        "set": {
          "description": "The points whose height was set, by the person or by a surface: no pull changes it.",
          "items": {
            "minimum": 0,
            "type": "integer"
          },
          "type": "array"
        }
      },
      "required": [
        "points",
        "lines",
        "faces"
      ],
      "type": "object"
    },
    "Wall": {
      "description": "A side of a block's footprint: the front along +z, the right along +x.",
      "enum": [
        "front",
        "right",
        "back",
        "left"
      ],
      "type": "string"
    }
  }
};

/** The version of @sunreye/scene the schema was generated at. */
export const SCENE_SCHEMA_VERSION = "5.0.0";
