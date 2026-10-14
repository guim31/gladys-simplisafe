// -----------------------------------------------------------------------------
// Camera pictures: the snapshot address of an event at a width, the bearer
// token kept for the SimpliSafe cloud, the first picture of an MJPEG stream
// (by its segments: an EXIF thumbnail carries an FF D9 of its own), and the
// 150 KB limit of Gladys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_IMAGE_CHARS,
  firstJpegOf,
  isSimpliSafeUrl,
  liveUrl,
  snapshotUrl,
  toCameraImage,
} from '../src/image.js';
import { fakeJpeg, fixture } from './helpers/fakeCloud.js';

test('the snapshot template gets its width; other variables are dropped', () => {
  const links = fixture('ws-motion-event-data.json').video['0a1b2c3d4e5f60718293a4b5c6d7e8f9']
    ._links;
  const mjpg = links['snapshot/mjpg'].href;
  assert.match(snapshotUrl(mjpg, 640), /\?account=000000000000&region=us-east-1$/);
  assert.equal(
    snapshotUrl('https://remix.us-east-1.prd.cam.simplisafe.com/v1/snap{&width}', 480),
    'https://remix.us-east-1.prd.cam.simplisafe.com/v1/snap?width=480',
  );
  assert.equal(
    snapshotUrl('https://remix.prd.cam.simplisafe.com/v1/snap?a=1{&width}', 320),
    'https://remix.prd.cam.simplisafe.com/v1/snap?a=1&width=320',
  );
  assert.equal(liveUrl('abc', 640), 'https://media.simplisafe.com/v1/abc/mjpg?x=640&fr=1');
});

test('the token of the account goes to the SimpliSafe cloud only', () => {
  assert.equal(isSimpliSafeUrl('https://media.simplisafe.com/v1/x'), true);
  assert.equal(isSimpliSafeUrl('https://chronicle.us-east-1.prd.cam.simplisafe.com/v1/x'), true);
  assert.equal(isSimpliSafeUrl('http://media.simplisafe.com/v1/x'), false);
  assert.equal(isSimpliSafeUrl('https://simplisafe.com.example.net/x'), false);
  assert.equal(isSimpliSafeUrl('https://evilsimplisafe.com/x'), false);
  // The placeholder addresses of the fixture are not followed.
  assert.equal(snapshotUrl('https://image-url{&width}', 640), null);
  assert.equal(snapshotUrl(null, 640), null);
});

test('the first picture of an MJPEG stream, whole, despite its thumbnail', () => {
  const picture = fakeJpeg(300);
  const boundary = Buffer.from('--frame\r\nContent-Type: image/jpeg\r\n\r\n');
  const stream = Buffer.concat([boundary, picture, boundary, fakeJpeg(200, 0x11)]);
  assert.deepEqual(firstJpegOf(stream), picture);
  // Incomplete: wait for more bytes.
  assert.equal(firstJpegOf(Buffer.concat([boundary, picture.subarray(0, 100)])), null);
  assert.equal(firstJpegOf(Buffer.from('not a picture')), null);
  assert.equal(firstJpegOf('text'), null);
});

test('a camera image fits the 150 KB of Gladys, or is refused', () => {
  const image = toCameraImage(fakeJpeg(1000));
  assert.match(image, /^image\/jpg;base64,\/9j/);
  assert.ok(image.length <= MAX_IMAGE_CHARS);
  const big = fakeJpeg(115 * 1024);
  assert.equal(toCameraImage(big), null);
  assert.equal(toCameraImage(Buffer.from('<html>error</html>')), null);
});
