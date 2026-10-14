// -----------------------------------------------------------------------------
// The HTTP seam of the SimpliSafe client: one function, `request`, over the
// global fetch of Node 22+. The tests replace it with the fake cloud of
// test/helpers/fakeCloud.js; nothing else in the code touches the network.
//
//   request({ method, url, headers, json, timeoutMs, maxBytes, firstJpeg })
//     → { status, body: Buffer }
//
// `json` is sent as application/json. `firstJpeg` stops reading as soon as a
// complete JPEG picture arrived (the live view of a camera is an endless
// MJPEG stream). A network failure throws a NetworkError with a `code`
// (ENOTFOUND, ECONNREFUSED, TIMEOUT…).
// -----------------------------------------------------------------------------

import { firstJpegOf } from '../image.js';

const DEFAULT_TIMEOUT_MS = 20_000;
// A camera picture is a few hundred kilobytes at most, the API answers a few
// dozen; the sandbox has 256 MB.
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export class NetworkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NetworkError';
    this.code = code;
  }
}

async function readBody(response, { maxBytes, firstJpeg, controller }) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    chunks.push(Buffer.from(chunk));
    if (firstJpeg) {
      const picture = firstJpegOf(Buffer.concat(chunks));
      if (picture) {
        controller.abort();
        return picture;
      }
    }
    if (size > maxBytes) {
      controller.abort();
      throw new NetworkError('TOO_LARGE', `Answer larger than ${maxBytes} bytes`);
    }
  }
  return Buffer.concat(chunks);
}

/** The production request, over fetch. */
export async function httpRequest({
  method = 'GET',
  url,
  headers = {},
  json,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  firstJpeg = false,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  timer.unref?.();
  const init = { method, headers: { ...headers }, redirect: 'manual', signal: controller.signal };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers['Content-Type'] = 'application/json; charset=utf-8';
  }
  try {
    let response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      if (controller.signal.aborted) {
        throw new NetworkError('TIMEOUT', `No answer within ${timeoutMs / 1000} s`);
      }
      const code = err.cause?.code ?? err.code ?? 'NETWORK';
      throw new NetworkError(code, code);
    }
    try {
      return {
        status: response.status,
        body: await readBody(response, { maxBytes, firstJpeg, controller }),
      };
    } catch (err) {
      if (err instanceof NetworkError) throw err;
      throw new NetworkError('TIMEOUT', `Answer interrupted: ${err.name}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
