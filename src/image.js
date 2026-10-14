// -----------------------------------------------------------------------------
// Camera pictures, without any image library: SimpliSafe resizes them itself
// (the `width` of a snapshot address, the `x` of the live view), so the
// integration only asks for a smaller one when a picture is over the limit of
// Gladys, checks what it got, and cuts the first picture out of a live MJPEG
// stream.
// -----------------------------------------------------------------------------

// Gladys takes a camera image of 150 KB at most, `image/jpg;base64,` included:
// base64 makes 4 characters of 3 bytes.
export const MAX_IMAGE_CHARS = 150 * 1024;
const PREFIX = 'image/jpg;base64,';
export const MAX_JPEG_BYTES = Math.floor(((MAX_IMAGE_CHARS - PREFIX.length) * 3) / 4);

// Widths asked in turn until a picture fits.
export const IMAGE_WIDTHS = [640, 480, 320];

// The bearer token of the account goes to the SimpliSafe cloud only: an
// address of an event that would point elsewhere is never fetched.
const SIMPLISAFE_HOST = /(^|\.)simplisafe\.com$/;

/** True for an https address of the SimpliSafe cloud. */
export function isSimpliSafeUrl(address) {
  try {
    const url = new URL(address);
    return url.protocol === 'https:' && SIMPLISAFE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * The address of a snapshot at a width. SimpliSafe gives a URI template
 * (`…/snapshot{&width}`, RFC 6570): the `width` is filled in, any other
 * variable dropped.
 */
export function snapshotUrl(template, width) {
  if (typeof template !== 'string' || !template) return null;
  let address = template.replace(/\{[?&]?width\}/, (match) => {
    const joiner = match.startsWith('{?') || !template.includes('?') ? '?' : '&';
    return `${joiner}width=${width}`;
  });
  address = address.replace(/\{[^}]*\}/g, '');
  return isSimpliSafeUrl(address) ? address : null;
}

/** The live picture of a camera (the MJPEG stream of media.simplisafe.com). */
export function liveUrl(uuid, width) {
  return `https://media.simplisafe.com/v1/${encodeURIComponent(uuid)}/mjpg?x=${width}&fr=1`;
}

const isRestart = (marker) => marker >= 0xd0 && marker <= 0xd7;

/**
 * Where the JPEG picture starting at `start` ends (after its EOI marker), -1
 * while it is incomplete. Walks the segments by their length rather than
 * looking for the first FF D9: the EXIF thumbnail of a picture carries one.
 */
function jpegEnd(buffer, start) {
  let i = start + 2;
  while (i + 1 < buffer.length) {
    if (buffer[i] !== 0xff) return -1;
    const marker = buffer[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
    } else if (marker === 0xd9) {
      return i + 2;
    } else if (marker === 0x01 || isRestart(marker)) {
      i += 2;
    } else {
      if (i + 3 >= buffer.length) return -1;
      const next = i + 2 + buffer.readUInt16BE(i + 2);
      if (marker !== 0xda) {
        i = next;
      } else {
        // Entropy-coded data: runs to the next marker that is neither a
        // stuffed 00 nor a restart marker.
        let j = next;
        while (
          j + 1 < buffer.length &&
          !(buffer[j] === 0xff && buffer[j + 1] !== 0x00 && !isRestart(buffer[j + 1]))
        ) {
          j += 1;
        }
        if (j + 1 >= buffer.length) return -1;
        i = j;
      }
    }
  }
  return -1;
}

/**
 * The first complete JPEG picture of a buffer (a JPEG file, or the beginning
 * of an MJPEG stream), null when there is none yet.
 */
export function firstJpegOf(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  const start = buffer.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  if (start < 0) return null;
  const end = jpegEnd(buffer, start);
  return end < 0 ? null : buffer.subarray(start, end);
}

/**
 * The first JPEG picture of a buffer as Gladys takes it, null when there is
 * none or it is too large.
 */
export function toCameraImage(bytes) {
  const picture = firstJpegOf(bytes);
  if (!picture || picture.length > MAX_JPEG_BYTES) return null;
  return `${PREFIX}${picture.toString('base64')}`;
}
