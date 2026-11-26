//! HTTP Digest authentication with SHA-256 and `qop=auth` (RFC 7616), as Shelly's Gen2 devices
//! ask it: <https://shelly-api-docs.shelly.cloud/gen2/General/Authentication>.

use std::fmt::Write as _;

/// A host's `WWW-Authenticate` challenge that this core can answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Challenge {
    realm: String,
    nonce: String,
    opaque: Option<String>,
}

impl Challenge {
    /// The challenge in `header`; `None` unless a Digest with SHA-256 that offers `qop=auth`.
    #[must_use]
    pub fn parse(header: &str) -> Option<Self> {
        let rest = header.strip_prefix("Digest ")?;
        let mut realm = None;
        let mut nonce = None;
        let mut opaque = None;
        let mut algorithm = None;
        let mut qop = None;
        for (name, value) in params(rest) {
            match name.to_ascii_lowercase().as_str() {
                "realm" => realm = Some(value),
                "nonce" => nonce = Some(value),
                "opaque" => opaque = Some(value),
                "algorithm" => algorithm = Some(value),
                "qop" => qop = Some(value),
                _ => {}
            }
        }
        let auth = qop.is_some_and(|q| q.split(',').any(|q| q.trim() == "auth"));
        (auth && algorithm.as_deref() == Some("SHA-256")).then_some(())?;
        Some(Self {
            realm: realm?,
            nonce: nonce?,
            opaque,
        })
    }

    /// The `Authorization` header for `method` on `uri` as the first request under this nonce.
    #[must_use]
    pub fn answer(
        &self,
        (username, password): (&str, &str),
        method: &str,
        uri: &str,
        cnonce: &str,
    ) -> String {
        const NC: &str = "00000001";
        let Self {
            realm,
            nonce,
            opaque,
        } = self;
        let ha1 = sha256(&format!("{username}:{realm}:{password}"));
        let ha2 = sha256(&format!("{method}:{uri}"));
        let response = sha256(&format!("{ha1}:{nonce}:{NC}:{cnonce}:auth:{ha2}"));
        let mut header = format!(
            r#"Digest username="{username}", realm="{realm}", uri="{uri}", algorithm=SHA-256, nonce="{nonce}", nc={NC}, cnonce="{cnonce}", qop=auth, response="{response}""#
        );
        if let Some(opaque) = opaque {
            write!(header, r#", opaque="{opaque}""#).ok();
        }
        header
    }
}

/// The `name=value` and `name="value"` pairs of a challenge, in order.
fn params(mut rest: &str) -> Vec<(String, String)> {
    let mut found = Vec::new();
    loop {
        rest = rest.trim_start_matches([' ', ',']);
        let Some((name, after)) = rest.split_once('=') else {
            return found;
        };
        let (value, after) = if let Some(quoted) = after.strip_prefix('"') {
            let Some((value, after)) = quoted.split_once('"') else {
                return found;
            };
            (value, after)
        } else {
            after.split_once(',').unwrap_or((after, ""))
        };
        found.push((name.trim().to_owned(), value.trim().to_owned()));
        rest = after;
    }
}

fn sha256(text: &str) -> String {
    hex(ring::digest::digest(&ring::digest::SHA256, text.as_bytes()).as_ref())
}

/// `bytes` as lowercase hex.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut hex, byte| {
        write!(hex, "{byte:02x}").ok();
        hex
    })
}
