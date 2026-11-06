//! The archive container: a ustar stream inside gzip, its NDJSON members gzipped again. Read front to back,
//! one member at a time, so memory never holds more than one line.

use std::fs::File;
use std::io::{self, BufRead, BufReader, Read};
use std::path::Path;

use flate2::read::GzDecoder;

use super::ImportError;

const BLOCK: u64 = 512;
/// The longest line or JSON member read; a 3.x reading line is under 200 bytes, `config.json` a few KiB.
const LIMIT: u64 = 16 << 20;
/// What a member's name is reported as when the container itself is cut short.
pub const CONTAINER: &str = "archive";

pub struct Container {
    tar: GzDecoder<BufReader<File>>,
    /// Body bytes of the current member not yet read, then its padding.
    left: u64,
    pad: u64,
}

fn broken(member: &str, reason: impl std::fmt::Display) -> ImportError {
    ImportError::Member { member: member.to_owned(), reason: reason.to_string() }
}

impl Container {
    pub fn open(path: &Path) -> Result<Self, ImportError> {
        let file = File::open(path).map_err(|e| broken(CONTAINER, e))?;
        Ok(Self { tar: GzDecoder::new(BufReader::new(file)), left: 0, pad: 0 })
    }

    /// The next member's name, its body ready to read; none after the end marker.
    pub fn next_member(&mut self) -> Result<Option<Member<'_>>, ImportError> {
        let skip = self.left + self.pad;
        let skipped =
            io::copy(&mut (&mut self.tar).take(skip), &mut io::sink()).map_err(|e| broken(CONTAINER, e))?;
        if skipped < skip {
            return Err(broken(CONTAINER, "the archive is cut short"));
        }
        let mut block = [0_u8; 512];
        self.tar.read_exact(&mut block).map_err(|e| match e.kind() {
            io::ErrorKind::UnexpectedEof => broken(CONTAINER, "the archive is cut short"),
            _ => broken(CONTAINER, e),
        })?;
        if block.iter().all(|&b| b == 0) {
            return Ok(None);
        }
        let (name, size) = header(&block)?;
        self.left = size;
        self.pad = size.next_multiple_of(BLOCK) - size;
        Ok(Some(Member { name, body: Body(self) }))
    }
}

/// A ustar header's name and size, its checksum held.
fn header(block: &[u8; 512]) -> Result<(String, u64), ImportError> {
    let field = |range: std::ops::Range<usize>| {
        let bytes = &block[range];
        let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
        String::from_utf8_lossy(&bytes[..end]).trim().to_owned()
    };
    let name = field(0..100);
    let stored = u32::from_str_radix(&field(148..156), 8).ok();
    let sum: u32 =
        block.iter().enumerate().map(|(i, &b)| if (148..156).contains(&i) { 32 } else { u32::from(b) }).sum();
    if stored != Some(sum) {
        return Err(broken(CONTAINER, "a member header is corrupt"));
    }
    let size =
        u64::from_str_radix(&field(124..136), 8).map_err(|_| broken(&name, "its size is unreadable"))?;
    Ok((name, size))
}

struct Body<'a>(&'a mut Container);

impl Read for Body<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let want = usize::try_from(self.0.left).unwrap_or(usize::MAX).min(buf.len());
        if want == 0 {
            return Ok(0);
        }
        let got = self.0.tar.read(&mut buf[..want])?;
        if got == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "the member is cut short"));
        }
        self.0.left -= got as u64;
        Ok(got)
    }
}

pub struct Member<'a> {
    pub name: String,
    body: Body<'a>,
}

impl<'a> Member<'a> {
    /// The whole member as UTF-8 text, for the small JSON ones.
    pub fn text(self) -> Result<String, ImportError> {
        let name = self.name;
        let mut bytes = Vec::new();
        self.body.take(LIMIT + 1).read_to_end(&mut bytes).map_err(|e| broken(&name, e))?;
        if bytes.len() as u64 > LIMIT {
            return Err(broken(&name, format!("larger than {LIMIT} bytes")));
        }
        String::from_utf8(bytes).map_err(|_| broken(&name, "not UTF-8"))
    }

    /// The member's lines, gunzipped when its name ends in `.gz`.
    pub fn lines(self) -> Lines<'a> {
        let read: Box<dyn BufRead + Send + 'a> =
            if Path::new(&self.name).extension().is_some_and(|e| e.eq_ignore_ascii_case("gz")) {
                Box::new(BufReader::new(GzDecoder::new(self.body)))
            } else {
                Box::new(BufReader::new(self.body))
            };
        Lines { name: self.name, read, number: 0, buf: Vec::new() }
    }
}

pub struct Lines<'a> {
    pub name: String,
    read: Box<dyn BufRead + Send + 'a>,
    number: usize,
    buf: Vec<u8>,
}

impl Lines<'_> {
    /// The next line that is not blank, with its 1-based number; none at the member's end. A last line
    /// without its newline is a line.
    pub fn next_line(&mut self) -> Result<Option<(usize, &str)>, ImportError> {
        loop {
            self.buf.clear();
            let read = (&mut self.read).take(LIMIT).read_until(b'\n', &mut self.buf);
            let got = read.map_err(|e| broken(&self.name, e))?;
            if got == 0 {
                return Ok(None);
            }
            self.number += 1;
            if self.buf.last() != Some(&b'\n') && got as u64 == LIMIT {
                return Err(self.at("longer than the line limit"));
            }
            let Ok(text) = std::str::from_utf8(&self.buf) else { return Err(self.at("not UTF-8")) };
            if !text.trim().is_empty() {
                let text = std::str::from_utf8(&self.buf).unwrap_or_default().trim_end();
                return Ok(Some((self.number, text)));
            }
        }
    }

    /// An error naming this member and the current line.
    pub fn at(&self, reason: impl std::fmt::Display) -> ImportError {
        broken(&self.name, format!("line {}: {reason}", self.number))
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::{file, gz, tar};
    use super::*;

    type Read = Vec<(String, Vec<String>)>;

    fn members(bytes: &[u8]) -> Result<Read, ImportError> {
        let mut container = Container::open(&file(bytes))?;
        let mut out = Vec::new();
        while let Some(member) = container.next_member()? {
            let mut lines = member.lines();
            let mut seen = Vec::new();
            while let Some((number, line)) = lines.next_line()? {
                seen.push(format!("{number}:{line}"));
            }
            out.push((lines.name, seen));
        }
        Ok(out)
    }

    fn refusal(bytes: &[u8]) -> String {
        members(bytes).expect_err("refused").to_string()
    }

    #[test]
    fn members_read_in_order_gunzipped_skipping_blank_lines() {
        let archive =
            gz(&tar(&[("manifest.json", b"{}\n".to_vec()), ("readings.ndjson.gz", gz(b"a\n\n  \nb"))]));
        let read = members(&archive).expect("read");
        assert_eq!(
            read,
            [
                ("manifest.json".to_owned(), vec!["1:{}".to_owned()]),
                ("readings.ndjson.gz".to_owned(), vec!["1:a".to_owned(), "4:b".to_owned()]),
            ]
        );
    }

    #[test]
    fn an_empty_file_is_cut_short() {
        assert_eq!(refusal(b""), "archive: the archive is cut short");
    }

    #[test]
    fn a_container_cut_inside_a_member_names_the_member() {
        let whole = tar(&[("readings.ndjson.gz", gz(&b"x\n".repeat(400)))]);
        let cut = gz(&whole[..520]);
        assert!(refusal(&cut).starts_with("readings.ndjson.gz: "), "{}", refusal(&cut));
    }

    #[test]
    fn a_gzip_member_cut_mid_stream_names_the_member() {
        let body = gz(&b"{\"value\":1}\n".repeat(50));
        let archive = gz(&tar(&[("readings.ndjson.gz", body[..body.len() - 9].to_vec())]));
        assert!(refusal(&archive).starts_with("readings.ndjson.gz: "), "{}", refusal(&archive));
    }

    #[test]
    fn a_non_utf8_byte_names_the_member_and_line() {
        let archive = gz(&tar(&[("config-log.ndjson.gz", gz(b"ok\n\xff\n"))]));
        assert_eq!(refusal(&archive), "config-log.ndjson.gz: line 2: not UTF-8");
    }

    #[test]
    fn a_corrupt_header_is_refused() {
        let mut whole = tar(&[("manifest.json", b"{}".to_vec())]);
        whole[0] = b'X';
        assert_eq!(refusal(&gz(&whole)), "archive: a member header is corrupt");
    }

    #[test]
    fn a_missing_end_marker_is_cut_short() {
        let whole = tar(&[("manifest.json", b"{}".to_vec())]);
        assert_eq!(refusal(&gz(&whole[..1024])), "archive: the archive is cut short");
    }
}
