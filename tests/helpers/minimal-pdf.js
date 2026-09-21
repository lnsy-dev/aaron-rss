/**
 * Minimal PDF Builder (test helper)
 *
 * Assembles a small but structurally valid single-page PDF from a list
 * of text-showing operations, with a correct xref table, so tests can
 * exercise real PDF parsing (unpdf/pdf.js) without a binary fixture.
 *
 * @param {object} [options]
 * @param {string[]} [options.lines] - Text lines to draw, one `Tj` each
 * @param {string} [options.title] - Document Info title
 * @param {string} [options.author] - Document Info author
 * @param {string} [options.contentStream] - Overrides the generated stream
 * @returns {Uint8Array} The encoded PDF document
 */
export function buildMinimalPDF({
  lines = ['Hello PDF World.'],
  title = '',
  author = '',
  contentStream = null,
} = {}) {
  // One Tj per line with a leading move-down; parentheses and backslashes
  // are escaped per the PDF literal-string rules.
  const ops =
    contentStream !== null
      ? contentStream
      : `BT /F1 18 Tf 72 720 Td\n${lines
          .map((line, i) => {
            const literal = line.replace(/([()\\])/g, '\\$1');
            return i === 0 ? `(${literal}) Tj` : `0 -24 Td (${literal}) Tj`;
          })
          .join('\n')}\nET`;

  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>';
  objects[4] = `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`;
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const infoEntries = [
    title ? ` /Title (${title.replace(/([()\\])/g, '\\$1')})` : '',
    author ? ` /Author (${author.replace(/([()\\])/g, '\\$1')})` : '',
  ].join('');
  if (infoEntries) {
    objects[6] = `<<${infoEntries} >>`;
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R${
    infoEntries ? ' /Info 6 0 R' : ''
  } >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}
