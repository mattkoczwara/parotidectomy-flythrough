/**
 * Orientation glyph (plan §4): a line-drawn head seen from above, face up, with a marker for where the viewer
 * stands. Azimuth 0 is the patient's right side; positive azimuth moves toward the face. Decorative for assistive
 * technology: each plate's scene description states the view in words.
 */
const R = 23;

export function updateGlyph(svg: SVGSVGElement | null, azimuth: number, elevation: number) {
  if (!svg) return;
  const eye = svg.querySelector<SVGGElement>('.orient-eye');
  if (eye) eye.setAttribute('transform', `rotate(${(-azimuth).toFixed(1)})`);
  const tilt = svg.querySelector<SVGTextElement>('.orient-tilt');
  if (tilt) tilt.textContent = Math.abs(elevation) >= 8 ? (elevation > 0 ? 'from above' : 'from below') : '';
}

/** Static markup, rendered by the page: head outline (face up), ears, and the viewer marker on a circle. */
export const glyphMarkup = `
  <g class="orient-head">
    <ellipse rx="10.5" ry="13" />
    <path d="M -3.2 -12.4 L 0 -16.5 L 3.2 -12.4" />
    <path d="M -10.5 -2 q -3 2 0 5" /><path d="M 10.5 -2 q 3 2 0 5" />
  </g>
  <g class="orient-eye">
    <circle cx="${R}" cy="0" r="2.6" />
    <path d="M ${R - 4} 0 L ${R - 9} 0 M ${R - 9} 0 l 3 -2.2 M ${R - 9} 0 l 3 2.2" />
  </g>
  <text class="orient-tilt" x="0" y="${R + 9}" text-anchor="middle"></text>`;
