/**
 * The pixel comparison, shared by the capture run and the redraw tool.
 *
 * Kept in one place because the score and the picture have to come from the
 * same arithmetic — a redraw that disagreed with the run that produced the
 * number would make the diff image evidence for a different measurement.
 */

export /**
 * How far apart two pixels must be before they count as different.
 *
 * Compared as a squared distance in RGB, so this is ~12 per channel. Below
 * that sits antialiasing, subpixel text rendering and JPEG-ish gradient noise
 * — real differences that no amount of correct CSS removes. Counting them
 * would floor every score around 90 and make the last ten points unreachable,
 * which is precisely the range a migration needs to work in.
 */
const PIXEL_THRESHOLD_SQ = 3 * 12 * 12;

export /**
 * Compare two screenshots and render a diff, entirely inside a page.
 *
 * Both images are drawn at the breakpoint width onto canvases sized to the
 * *taller* of the two, so a rebuild that runs short does not silently score
 * well by being compared only against its own height — the missing region
 * counts as difference, which is what a person looking at the two would say.
 *
 * The diff image dims the reference to grey and paints differing pixels
 * magenta. Magenta because it collides with almost nothing in real design
 * work, so what is wrong reads instantly against what is merely there.
 */
const COMPARE_IN_PAGE = `
(async ({ referenceUrl, rebuildUrl, width, threshold }) => {
  const load = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });

  const [a, b] = await Promise.all([load(referenceUrl), load(rebuildUrl)]);
  const h = Math.max(a.height, b.height);

  const draw = (img) => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, h);
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, width, h);
  };

  const refData = draw(a);
  const rebData = draw(b);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = h;
  const outCtx = out.getContext('2d');
  const outData = outCtx.createImageData(width, h);

  let differing = 0;
  const total = width * h;
  for (let i = 0; i < refData.data.length; i += 4) {
    const dr = refData.data[i] - rebData.data[i];
    const dg = refData.data[i + 1] - rebData.data[i + 1];
    const db = refData.data[i + 2] - rebData.data[i + 2];
    const dist = dr * dr + dg * dg + db * db;

    if (dist > threshold) {
      differing++;
      outData.data[i] = 255;
      outData.data[i + 1] = 0;
      outData.data[i + 2] = 200;
      outData.data[i + 3] = 255;
    } else {
      /*
       * Ghost of the reference, so the diff still reads as a page rather than
       * as marks floating in space.
       *
       * The range matters more than it looks. Compressing the reference into
       * 200–251 leaves black body text at 200 against a 251 background, which
       * on a light page is invisible — the first version of this produced a
       * diff that looked blank and hid the very marks it exists to show.
       * 170–245 keeps the layout legible while staying clearly subordinate to
       * the magenta.
       */
      const grey =
        0.299 * refData.data[i] + 0.587 * refData.data[i + 1] + 0.114 * refData.data[i + 2];
      const flat = Math.round(170 + grey * 0.294);
      outData.data[i] = flat;
      outData.data[i + 1] = flat;
      outData.data[i + 2] = flat;
      outData.data[i + 3] = 255;
    }
  }
  outCtx.putImageData(outData, 0, 0);

  return {
    score: Number((100 * (1 - differing / total)).toFixed(2)),
    differingPixels: differing,
    totalPixels: total,
    width,
    height: h,
    referenceHeight: a.height,
    rebuildHeight: b.height,
    diff: out.toDataURL('image/png').split(',')[1],
  };
})
`;
