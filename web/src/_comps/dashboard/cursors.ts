function quill(shaft: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'>` +
    `<line x1='5' y1='35' x2='24' y2='12' stroke='${shaft}' stroke-width='3' stroke-linecap='round'/>` +
    `<ellipse cx='27' cy='11' rx='5.5' ry='12' transform='rotate(42 27 11)' fill='#B86830' stroke='#F2ECD4' stroke-width='1'/>` +
    `<line x1='24' y1='12' x2='31' y2='6' stroke='#F2ECD4' stroke-width='1'/>` +
    `<circle cx='5' cy='35' r='2' fill='${shaft}'/>` +
    `</svg>`;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 5 35, auto`;
}

export const QUILL_LIGHT = quill("#EDE7CF");
export const QUILL_DARK = quill("#1B2420");
