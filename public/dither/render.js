export function serializeChevronSvg({
  width,
  height,
  ground,
  includeGround,
  pair,
  centerX,
  centerY,
  marks,
}) {
  let head = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  if (includeGround) {
    head += `<rect width="${width}" height="${height}" fill="${ground}"/>`;
  }
  head += `<clipPath id="cp"><rect width="${width}" height="${height}"/></clipPath><g clip-path="url(#cp)">`;

  let body = "";
  for (const mark of marks) {
    const degrees = (mark.a * 180 / Math.PI).toFixed(2);
    body += `<path d="${pair}" transform="translate(${mark.x.toFixed(1)},${mark.y.toFixed(1)}) rotate(${degrees}) scale(${mark.s.toFixed(4)}) translate(${-centerX},${-centerY})" fill="${mark.color}" fill-rule="evenodd"/>`;
  }

  return head + body + "</g></svg>";
}
