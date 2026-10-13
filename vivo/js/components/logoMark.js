/** Vivo's icon mark: layered teal wave + circle, matching the brand gradient. Colorful (not currentColor) so it reads correctly on both the dark sidebar and light landing header without a separate reversed asset. */
export function vivoMarkSvg(size = 28) {
  const h = Math.round((size * 44) / 56);
  return `<svg class="vivo-mark" width="${size}" height="${h}" viewBox="0 0 56 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="vivoGradA" x1="2" y1="40" x2="46" y2="4" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#0B2D2B"/>
        <stop offset="1" stop-color="#14B8A6"/>
      </linearGradient>
      <linearGradient id="vivoGradB" x1="2" y1="40" x2="47" y2="8" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#0E6F64"/>
        <stop offset="1" stop-color="#5ED1BE"/>
      </linearGradient>
      <linearGradient id="vivoGradC" x1="2" y1="38" x2="49" y2="14" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#14B8A6"/>
        <stop offset="1" stop-color="#A7E3D8"/>
      </linearGradient>
      <linearGradient id="vivoGradDot" x1="40" y1="2" x2="52" y2="14" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#5ED1BE"/>
        <stop offset="1" stop-color="#0B8577"/>
      </linearGradient>
    </defs>
    <path d="M2,34 C10,16 18,8 26,18 C31,24 27,29 34,26 C40,23 43,12 46,4 L46,40 L2,40 Z" fill="url(#vivoGradA)"/>
    <path d="M2,37 C12,22 21,16 28,24 C32,29 27,32 35,30 C41,28 44,18 47,10 L47,40 L2,40 Z" fill="url(#vivoGradB)"/>
    <path d="M2,40 C14,28 24,24 31,30 C35,34 30,36 38,35 C44,34 47,25 49,18 L49,40 L2,40 Z" fill="url(#vivoGradC)"/>
    <circle cx="46" cy="9" r="6" fill="url(#vivoGradDot)"/>
  </svg>`;
}
