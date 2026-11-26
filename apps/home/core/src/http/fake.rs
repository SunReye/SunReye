//! An HTTP/1.1 host on a local port, for tests: it answers GETs with recorded vendor answers, and
//! with a password set asks for Digest authentication with SHA-256 as a Shelly Gen2 device does.

use std::fmt::Write as _;
use std::net::SocketAddr;
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Barrier, mpsc};
use tokio::task::JoinHandle;

const REALM: &str = "shellypro3em-c8f09e8a1b2c";
const NONCE: &str = "1731180000";

/// A GET the host received, and whether it carried a valid answer to its challenge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asked {
    pub path: String,
    pub authorized: bool,
}

#[derive(Debug)]
pub struct Fake {
    pub address: SocketAddr,
    pub asked: mpsc::UnboundedReceiver<Asked>,
    listener: JoinHandle<()>,
}

impl Drop for Fake {
    fn drop(&mut self) {
        self.listener.abort();
    }
}

/// How the host answers.
pub struct Answers {
    /// Each path with its JSON answer; any other path is 404.
    pub bodies: Vec<(String, String)>,
    /// The password of user `admin`; none answers without a challenge.
    pub password: Option<String>,
    /// Holds each answer until this many GETs are open at once.
    pub together: usize,
}

/// Serves `answers` on a free local port.
///
/// # Panics
/// No local port is free.
pub async fn serve(answers: Answers) -> Fake {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (tx, asked) = mpsc::unbounded_channel();
    let barrier = Arc::new(Barrier::new(answers.together.max(1)));
    let answers = Arc::new(answers);
    let listener = tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let (tx, answers, barrier) = (tx.clone(), Arc::clone(&answers), Arc::clone(&barrier));
            tokio::spawn(async move { session(stream, &answers, &barrier, &tx).await });
        }
    });
    Fake {
        address,
        asked,
        listener,
    }
}

async fn session(
    mut stream: TcpStream,
    answers: &Answers,
    barrier: &Barrier,
    tx: &mpsc::UnboundedSender<Asked>,
) {
    let mut head = Vec::new();
    let mut byte = [0];
    while !head.ends_with(b"\r\n\r\n") {
        if stream.read(&mut byte).await.unwrap_or(0) == 0 {
            return;
        }
        head.push(byte[0]);
    }
    let head = String::from_utf8_lossy(&head).into_owned();
    let path = head.split(' ').nth(1).unwrap_or_default().to_owned();
    let authorization = head.lines().find_map(|l| {
        l.strip_prefix("authorization: ")
            .or_else(|| l.strip_prefix("Authorization: "))
    });
    let authorized = match (&answers.password, authorization) {
        (Some(password), Some(header)) => valid(header, &path, password),
        (Some(_), None) => false,
        (None, _) => true,
    };
    tx.send(Asked {
        path: path.clone(),
        authorized,
    })
    .ok();
    barrier.wait().await;
    let reply = if authorized {
        match answers.bodies.iter().find(|(p, _)| *p == path) {
            Some((_, body)) => format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            ),
            None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_owned(),
        }
    } else {
        format!(
            "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Digest qop=\"auth\", realm=\"{REALM}\", nonce=\"{NONCE}\", algorithm=SHA-256\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )
    };
    stream.write_all(reply.as_bytes()).await.ok();
    stream.shutdown().await.ok();
}

/// Whether `header` answers the challenge for user `admin` on `path`, as Shelly computes it.
fn valid(header: &str, path: &str, password: &str) -> bool {
    let field = |name: &str| {
        header.split(", ").find_map(|pair| {
            let value = pair
                .trim_start_matches("Digest ")
                .strip_prefix(name)?
                .strip_prefix('=')?;
            Some(value.trim_matches('"').to_owned())
        })
    };
    let (Some(nc), Some(cnonce), Some(response)) =
        (field("nc"), field("cnonce"), field("response"))
    else {
        return false;
    };
    let ha1 = hex(&format!("admin:{REALM}:{password}"));
    let ha2 = hex(&format!("GET:{path}"));
    field("username").as_deref() == Some("admin")
        && field("uri").as_deref() == Some(path)
        && response == hex(&format!("{ha1}:{NONCE}:{nc}:{cnonce}:auth:{ha2}"))
}

fn hex(text: &str) -> String {
    let hash = ring::digest::digest(&ring::digest::SHA256, text.as_bytes());
    hash.as_ref().iter().fold(String::new(), |mut hex, b| {
        write!(hex, "{b:02x}").ok();
        hex
    })
}
