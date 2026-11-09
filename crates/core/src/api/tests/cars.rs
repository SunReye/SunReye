//! Uploaded car bodies (ADR 20): a GLB of at most 20 MB whose buffers and images are embedded,
//! stored in the data directory under its SHA-256 and read back by viewers.
//!
//! GLB is glTF 2.0's binary container, <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#glb-file-format-specification>:
//! a 12-byte header (`glTF`, version 2, total length), then chunks of length, type and data,
//! the first `JSON`, an optional `BIN\0` after it, each 4-byte aligned.

use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode, header};
use futures_util::stream;
use serde_json::{Value, json};

use super::viewers::login;
use super::{Core, HOME, from, get, problem, with_cookie};

const JSON: u32 = 0x4E4F_534A;
const BIN: u32 = 0x004E_4942;

/// A GLB around `document` and `bin`, padded as the format requires.
fn glb(document: &Value, bin: &[u8]) -> Vec<u8> {
    let pad = |mut data: Vec<u8>, with: u8| {
        while !data.len().is_multiple_of(4) {
            data.push(with);
        }
        data
    };
    let chunk = |kind: u32, data: Vec<u8>| {
        let mut out = u32::try_from(data.len()).unwrap().to_le_bytes().to_vec();
        out.extend(kind.to_le_bytes());
        out.extend(data);
        out
    };
    let mut body = chunk(JSON, pad(document.to_string().into_bytes(), b' '));
    if !bin.is_empty() {
        body.extend(chunk(BIN, pad(bin.to_vec(), 0)));
    }
    let mut out = b"glTF".to_vec();
    out.extend(2_u32.to_le_bytes());
    out.extend(u32::try_from(12 + body.len()).unwrap().to_le_bytes());
    out.extend(body);
    out
}

/// A one-triangle mesh whose buffer is the GLB's own binary chunk.
fn triangle(buffer: &Value) -> Value {
    json!({
        "asset": { "version": "2.0" },
        "buffers": [buffer],
        "bufferViews": [{ "buffer": 0, "byteLength": 36 }],
        "accessors": [{ "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3" }],
        "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 } }] }],
        "nodes": [{ "mesh": 0 }],
        "scenes": [{ "nodes": [0] }],
    })
}

fn embedded() -> Vec<u8> {
    glb(&triangle(&json!({ "byteLength": 36 })), &[0; 36])
}

fn upload(body: Body) -> Request<Body> {
    let request = Request::post("/api/v1/car-bodies")
        .header(header::CONTENT_TYPE, "model/gltf-binary")
        .body(body)
        .unwrap();
    from(HOME, request)
}

#[tokio::test]
async fn an_uploaded_glb_is_stored_in_the_data_directory_and_viewers_read_it_back() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.viewer(&admin, "grandma", "sunny days").await;
    let viewer = core.sign_in(login("grandma", "sunny days")).await;

    let (status, body) = core.ask(&admin, upload(Body::from(embedded()))).await;
    let id = body["id"].as_str().unwrap().to_owned();
    let read = core
        .send(with_cookie(
            &viewer,
            get(&format!("/api/v1/car-bodies/{id}")),
        ))
        .await;
    let refused = core
        .send(with_cookie(&viewer, upload(Body::from(embedded()))))
        .await;

    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(id.len(), 64);
    assert_eq!(
        std::fs::read(dir.path().join("cars").join(format!("{id}.glb"))).unwrap(),
        embedded()
    );
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(read.headers()[header::CONTENT_TYPE], "model/gltf-binary");
    let bytes = axum::body::to_bytes(read.into_body(), 1 << 20)
        .await
        .unwrap();
    assert_eq!(bytes, embedded());
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn an_upload_past_20_mb_is_refused_while_it_streams() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let large = glb(
        &triangle(&json!({ "byteLength": 19 << 20 })),
        &vec![0; 19 << 20],
    );
    // Endless: the answer comes only if the core stops reading at the cap.
    let endless = stream::repeat_with(|| Ok::<_, std::io::Error>(Bytes::from(vec![0; 1 << 20])));

    let response = core
        .send(with_cookie(&admin, upload(Body::from_stream(endless))))
        .await;

    let (stored, _) = core.ask(&admin, upload(Body::from(large))).await;

    assert_eq!(
        problem(response).await,
        (StatusCode::PAYLOAD_TOO_LARGE, "car.size".to_owned())
    );
    assert_eq!(stored, StatusCode::CREATED);
}

#[tokio::test]
async fn a_glb_with_an_external_uri_or_a_broken_container_is_refused_and_nothing_stored() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let external = glb(
        &triangle(&json!({ "byteLength": 36, "uri": "https://example.com/car.bin" })),
        &[],
    );
    let mut image = triangle(&json!({ "byteLength": 36 }));
    image["images"] = json!([{ "uri": "paint.png" }]);
    let image = glb(&image, &[0; 36]);
    let mut short = embedded();
    short.truncate(short.len() - 4);
    let mut version = embedded();
    version[4] = 1;
    let not_json = {
        let mut bytes = embedded();
        bytes[20] = b'{' + 1;
        bytes
    };

    let mut refusals = Vec::new();
    for body in [
        external,
        image,
        short,
        version,
        not_json,
        b"PK\x03\x04".to_vec(),
    ] {
        let response = core
            .send(with_cookie(&admin, upload(Body::from(body))))
            .await;
        refusals.push(problem(response).await);
    }

    let unprocessable = |code: &str| (StatusCode::UNPROCESSABLE_ENTITY, code.to_owned());
    assert_eq!(
        refusals,
        [
            unprocessable("car.uri"),
            unprocessable("car.uri"),
            unprocessable("car.file"),
            unprocessable("car.file"),
            unprocessable("car.file"),
            unprocessable("car.file"),
        ]
    );
    let stored = std::fs::read_dir(dir.path().join("cars")).map_or(0, Iterator::count);
    assert_eq!(stored, 0);
}

#[tokio::test]
async fn an_unknown_body_is_a_problem() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;

    for id in ["0".repeat(64), "..%2Fcore.sqlite".to_owned()] {
        let response = core
            .send(with_cookie(
                &admin,
                get(&format!("/api/v1/car-bodies/{id}")),
            ))
            .await;
        assert_eq!(
            problem(response).await,
            (StatusCode::NOT_FOUND, "car.none".to_owned())
        );
    }
}
