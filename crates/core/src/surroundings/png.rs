//! The PNG a terrain tile comes as, read by hand: 8 bits a channel, red, green and blue with or
//! without alpha, not interlaced. Its checksums are not checked: a damaged tile is terrain a
//! little off, and the admin lines the surroundings up by eye.

use std::io::Read as _;

const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
/// The most pixels a side: a terrain tile has 256.
const SIDE: usize = 4096;

/// The pixels row by row, three bytes each; `None` for anything but such a PNG.
pub fn rgb(png: &[u8]) -> Option<Vec<u8>> {
    let mut rest = png.strip_prefix(SIGNATURE)?;
    let (mut header, mut data) = (None, Vec::new());
    while let Some((kind, body, after)) = chunk(rest) {
        match kind {
            b"IHDR" => header = Some(Header::read(body)?),
            b"IDAT" => data.extend_from_slice(body),
            _ => {}
        }
        rest = after;
    }
    let header = header?;
    let row = header.width * header.channels;
    let mut raw = Vec::new();
    let most = u64::try_from((row + 1) * header.height).ok()?;
    flate2::read::ZlibDecoder::new(data.as_slice())
        .take(most)
        .read_to_end(&mut raw)
        .ok()?;
    if raw.len() != (row + 1) * header.height {
        return None;
    }
    let mut pixels = Vec::with_capacity(header.width * header.height * 3);
    let mut above = vec![0_u8; row];
    for line in raw.chunks_exact(row + 1) {
        let (&filter, line) = line.split_first()?;
        let line = unfilter(filter, line, &above, header.channels)?;
        for pixel in line.chunks_exact(header.channels) {
            pixels.extend(pixel.iter().take(3));
        }
        above = line;
    }
    Some(pixels)
}

/// The next chunk's type and data, and what follows its checksum.
fn chunk(bytes: &[u8]) -> Option<(&[u8], &[u8], &[u8])> {
    let (length, rest) = bytes.split_first_chunk::<4>()?;
    let (kind, rest) = rest.split_first_chunk::<4>()?;
    let length = usize::try_from(u32::from_be_bytes(*length)).ok()?;
    let body = rest.get(..length)?;
    Some((kind, body, rest.get(length + 4..)?))
}

struct Header {
    width: usize,
    height: usize,
    /// Bytes a pixel: 3, or 4 with alpha.
    channels: usize,
}

impl Header {
    fn read(body: &[u8]) -> Option<Self> {
        let (width, rest) = body.split_first_chunk::<4>()?;
        let (height, rest) = rest.split_first_chunk::<4>()?;
        let side = |bytes: &[u8; 4]| {
            let side = usize::try_from(u32::from_be_bytes(*bytes)).ok()?;
            (1..=SIDE).contains(&side).then_some(side)
        };
        let channels = match *rest {
            [8, 2, 0, 0, 0] => 3,
            [8, 6, 0, 0, 0] => 4,
            _ => return None,
        };
        Some(Self {
            width: side(width)?,
            height: side(height)?,
            channels,
        })
    }
}

/// A row with its filter undone: each byte was stored less a guess from the byte `step` to its
/// left, the one above, or both.
fn unfilter(filter: u8, line: &[u8], above: &[u8], step: usize) -> Option<Vec<u8>> {
    let mut out: Vec<u8> = Vec::with_capacity(line.len());
    for (at, (&byte, &up)) in line.iter().zip(above).enumerate() {
        let before = |row: &[u8]| at.checked_sub(step).and_then(|i| row.get(i)).copied();
        let (left, corner) = (before(&out).unwrap_or(0), before(above).unwrap_or(0));
        let guess = match filter {
            0 => 0,
            1 => left,
            2 => up,
            3 => u8::try_from(u16::midpoint(u16::from(left), u16::from(up))).ok()?,
            4 => paeth(left, up, corner),
            _ => return None,
        };
        out.push(byte.wrapping_add(guess));
    }
    Some(out)
}

/// Whichever of the three neighbours is nearest to left + up − corner (Paeth 1991).
fn paeth(left: u8, up: u8, corner: u8) -> u8 {
    let (a, b, c) = (i16::from(left), i16::from(up), i16::from(corner));
    let (pa, pb, pc) = ((b - c).abs(), (a - c).abs(), (a + b - 2 * c).abs());
    if pa <= pb && pa <= pc {
        left
    } else if pb <= pc {
        up
    } else {
        corner
    }
}
