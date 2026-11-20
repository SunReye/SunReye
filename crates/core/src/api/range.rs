//! What history, statistics and forecasts share (ADR 9): `series` repeated, 1 to 16 of one
//! device, each read on its own so one refused names itself and refuses the request.

use axum::extract::Query;
use axum::extract::rejection::QueryRejection;
use axum::http::StatusCode;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

use super::{Code, Problem, Refused};
use crate::bus::Series;

/// The most series one request reads.
const MOST: usize = 16;

const QUERY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestQuery,
};

/// A range read's query: `series` repeated, each other key once, as `P`.
pub fn query<P: DeserializeOwned>(
    query: Result<Query<Vec<(String, String)>>, QueryRejection>,
) -> Result<P, Problem> {
    let Query(pairs) = query.map_err(|_| QUERY)?;
    let mut fields = Map::new();
    let mut series = Vec::new();
    for (key, value) in pairs {
        if key == "series" {
            series.push(Value::String(value));
        } else if fields.insert(key, Value::String(value)).is_some() {
            return Err(QUERY);
        }
    }
    fields.insert("series".to_owned(), Value::Array(series));
    serde_json::from_value(Value::Object(fields)).map_err(|_| QUERY)
}

/// Each name parsed, 1 to 16 of them; the first malformed one refuses them all.
pub fn parse(names: &[String]) -> Result<Vec<(String, Series)>, Refused> {
    if names.is_empty() || names.len() > MOST {
        return Err(QUERY.into());
    }
    names
        .iter()
        .map(|name| {
            Series::parse(name)
                .map(|series| (name.clone(), series))
                .ok_or_else(|| named(QUERY, name))
        })
        .collect()
}

/// `problem`, naming the series it refuses.
pub fn named(problem: Problem, series: &str) -> Refused {
    Refused {
        problem,
        pointer: None,
        series: Some(series.to_owned()),
    }
}
