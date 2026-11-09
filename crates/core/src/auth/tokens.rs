//! Bearer tokens for integrations (ADR 9), scoped `read` or `admin`. A token is shown once, when
//! it is created; only its SHA-256 is kept, which suffices for 256 random bits.

use std::collections::HashMap;
use std::time::SystemTime;

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::sessions::{hex, random_token};
use super::{Auth, BODY, INTERNAL, PATH};
use crate::api::{Clock, Code, Problem, ProblemDetails};
use crate::changes::{self, Action, Entry, Subject};

const ACTOR: &str = "admin";
/// The longest name, in bytes.
const LONGEST_NAME: usize = 64;

const NONE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::TokenNone,
};
const VALUE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::TokenValue,
};

/// What a token may do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    /// What a viewer reads: live values and history.
    Read,
    /// Everything the admin does.
    Admin,
}

/// Every token's hash, with its id and scope: a request reads memory, never SQLite.
pub type Known = HashMap<String, (u32, Scope)>;

/// The SHA-256 of `token`, as hex.
pub fn digest(token: &str) -> String {
    hex(ring::digest::digest(&ring::digest::SHA256, token.as_bytes()).as_ref())
}

/// # Errors
/// The file cannot be read.
pub fn load(db: &Connection) -> rusqlite::Result<Known> {
    db.prepare("SELECT hash, id, scope FROM token")?
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                (row.get(1)?, Scope::stored(&row.get::<_, String>(2)?)),
            ))
        })?
        .collect()
}

/// A token as the admin creates it.
#[derive(Deserialize, ToSchema)]
pub struct TokenDraft {
    /// What it is for, such as `evcc`.
    name: String,
    scope: Scope,
}

/// A token as the API reads it: never the token.
#[derive(Serialize, ToSchema)]
pub struct Token {
    id: u32,
    name: String,
    scope: Scope,
}

/// A token just created: the only time the token is shown.
#[derive(Serialize, ToSchema)]
pub struct Created {
    #[serde(flatten)]
    #[schema(inline)]
    described: Token,
    /// Sent as `Authorization: Bearer <token>`.
    token: String,
}

#[derive(Serialize, ToSchema)]
pub struct Tokens {
    tokens: Vec<Token>,
}

type TokensState = State<(Auth, Clock)>;

#[utoipa::path(get, path = "/api/v1/tokens", responses(
    (status = 200, body = Tokens),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
pub async fn list(State((auth, _)): TokensState) -> Result<Json<Tokens>, Problem> {
    let tokens = auth
        .0
        .database
        .run(|db| {
            db.prepare("SELECT id, name, scope FROM token ORDER BY id")?
                .query_map([], |row| {
                    Ok(Token {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        scope: Scope::stored(&row.get::<_, String>(2)?),
                    })
                })?
                .collect()
        })
        .await
        .map_err(|_| INTERNAL)?;
    Ok(Json(Tokens { tokens }))
}

/// Creates a token and shows it, once.
#[utoipa::path(post, path = "/api/v1/tokens", request_body = TokenDraft, responses(
    (status = 201, body = Created),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
pub async fn add(
    State((auth, clock)): TokensState,
    body: Result<Json<TokenDraft>, JsonRejection>,
) -> Result<(StatusCode, Json<Created>), Problem> {
    let Json(TokenDraft { name, scope }) = body.map_err(|_| BODY)?;
    if name.trim().is_empty() || name.len() > LONGEST_NAME {
        return Err(VALUE);
    }
    let token = random_token().ok_or(INTERNAL)?;
    let hash = digest(&token);
    let stored = hash.clone();
    let changed = clock();
    let described = auth
        .0
        .database
        .run(move |db| insert(db, name, scope, &stored, changed))
        .await
        .map_err(|_| INTERNAL)?;
    auth.tokens().insert(hash, (described.id, scope));
    Ok((StatusCode::CREATED, Json(Created { described, token })))
}

fn insert(
    db: &Connection,
    name: String,
    scope: Scope,
    hash: &str,
    changed: SystemTime,
) -> rusqlite::Result<Token> {
    let tx = db.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO token (name, scope, hash) VALUES (?1, ?2, ?3)",
        params![name, scope.name(), hash],
    )?;
    let id = u32::try_from(tx.last_insert_rowid()).unwrap_or(u32::MAX);
    let token = Token { id, name, scope };
    changes::append(
        &tx,
        &Entry {
            subject: Subject::Token,
            id,
            action: Action::Add,
            state: serde_json::to_value(&token).ok(),
            actor: ACTOR,
            changed,
            applies_from: changed,
        },
    )?;
    tx.commit()?;
    Ok(token)
}

impl Scope {
    const fn name(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Admin => "admin",
        }
    }

    /// A stored scope; the table's check admits only the two names.
    fn stored(name: &str) -> Self {
        if name == "admin" {
            Self::Admin
        } else {
            Self::Read
        }
    }
}

/// Removes a token; a request carrying it is refused from now on.
#[utoipa::path(delete, path = "/api/v1/tokens/{id}", params(("id" = u32, Path)), responses(
    (status = 204),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
pub async fn remove(
    State((auth, clock)): TokensState,
    id: Result<Path<u32>, PathRejection>,
) -> Result<StatusCode, Problem> {
    let Path(id) = id.map_err(|_| PATH)?;
    let changed = clock();
    let removed = auth
        .0
        .database
        .run(move |db| {
            let tx = db.unchecked_transaction()?;
            if tx.execute("DELETE FROM token WHERE id = ?1", [id])? == 0 {
                return Ok(false);
            }
            changes::append(
                &tx,
                &Entry {
                    subject: Subject::Token,
                    id,
                    action: Action::Remove,
                    state: None,
                    actor: ACTOR,
                    changed,
                    applies_from: changed,
                },
            )?;
            tx.commit()?;
            Ok(true)
        })
        .await
        .map_err(|_| INTERNAL)?;
    if !removed {
        return Err(NONE);
    }
    auth.tokens().retain(|_, (token, _)| *token != id);
    Ok(StatusCode::NO_CONTENT)
}
