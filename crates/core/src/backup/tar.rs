//! The ustar subset a backup is written in: regular files, names under 100 bytes, mode 0600.

use std::io::{self, Read, Write};
use std::ops::Range;

const BLOCK: usize = 512;
const NAME: Range<usize> = 0..100;
const SIZE: Range<usize> = 124..136;
const SUM: Range<usize> = 148..156;
const TYPE: usize = 156;
static ZEROS: [u8; BLOCK] = [0; BLOCK];

/// Appends the file `name` of `size` bytes read from `body`.
///
/// # Errors
/// `InvalidInput` for a name of 100 bytes or more, `UnexpectedEof` for a body short of `size`.
pub fn append(out: &mut impl Write, name: &str, size: u64, body: &mut impl Read) -> io::Result<()> {
    if name.len() >= NAME.end {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    let mut header = [0_u8; BLOCK];
    let size_field = format!("{size:011o}\0");
    for (at, field) in [
        (NAME.start, name.as_bytes()),
        (100, b"0000600\0".as_slice()),
        (108, b"0000000\0"),
        (116, b"0000000\0"),
        (SIZE.start, size_field.as_bytes()),
        (136, b"00000000000\0"),
        (TYPE, b"0"),
        (257, b"ustar\0"),
        (263, b"00"),
    ] {
        put(&mut header, at, field);
    }
    let sum = checksum(&header);
    put(&mut header, SUM.start, format!("{sum:06o}\0 ").as_bytes());
    out.write_all(&header)?;
    if io::copy(&mut body.take(size), out)? != size {
        return Err(io::Error::from(io::ErrorKind::UnexpectedEof));
    }
    out.write_all(ZEROS.get(..padding(size)).unwrap_or_default())
}

/// Ends the archive with its two zero blocks.
pub fn end(out: &mut impl Write) -> io::Result<()> {
    out.write_all(&ZEROS)?;
    out.write_all(&ZEROS)
}

/// Hands each member's name and body to `each`, in order.
///
/// # Errors
/// `InvalidData` for a header that is not a regular file of this subset, `UnexpectedEof` for a
/// short archive, or `each`'s error.
pub fn read<E: From<io::Error>>(
    mut input: impl Read,
    mut each: impl FnMut(&str, &mut dyn Read) -> Result<(), E>,
) -> Result<(), E> {
    loop {
        let mut header = [0_u8; BLOCK];
        input.read_exact(&mut header)?;
        if header == ZEROS {
            return Ok(());
        }
        let (name, size) =
            parse(&header).ok_or_else(|| io::Error::from(io::ErrorKind::InvalidData))?;
        let mut body = (&mut input).take(size);
        each(&name, &mut body)?;
        // What `each` left unread, then the padding.
        io::copy(&mut body, &mut io::sink())?;
        let pad = padding(size) as u64;
        if io::copy(&mut (&mut input).take(pad), &mut io::sink())? != pad {
            return Err(io::Error::from(io::ErrorKind::UnexpectedEof).into());
        }
    }
}

/// Writes `bytes` into `header` from `at`; every field written fits.
fn put(header: &mut [u8; BLOCK], at: usize, bytes: &[u8]) {
    if let Some(field) = header.get_mut(at..at + bytes.len()) {
        field.copy_from_slice(bytes);
    }
}

/// The header's byte sum, its checksum field counted as spaces.
fn checksum(header: &[u8; BLOCK]) -> u32 {
    header
        .iter()
        .enumerate()
        .map(|(i, &b)| if SUM.contains(&i) { 32 } else { u32::from(b) })
        .sum()
}

/// The name and size of a regular file's header whose checksum holds.
fn parse(header: &[u8; BLOCK]) -> Option<(String, u64)> {
    let field = |range: Range<usize>| {
        let text = header.get(range)?.split(|&b| b == 0).next()?;
        std::str::from_utf8(text).ok()
    };
    let stored = u32::from_str_radix(field(SUM)?.trim(), 8).ok()?;
    let regular = matches!(header.get(TYPE), Some(b'0' | 0));
    let size = u64::from_str_radix(field(SIZE)?.trim(), 8).ok()?;
    (checksum(header) == stored && regular).then(|| Some((field(NAME)?.to_owned(), size)))?
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "the remainder is below one block"
)]
const fn padding(size: u64) -> usize {
    (BLOCK - (size % BLOCK as u64) as usize) % BLOCK
}
