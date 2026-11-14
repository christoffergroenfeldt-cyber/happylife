// Drawings at the top of each page (mockups "Tegninger øverst på hver side"
// and rainbow no. 2). Decorative only; colours are fixed and dimmed by CSS in
// dark mode.

const svg = (w, h, body, extra = '') =>
  `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false" ${extra}>${body}</svg>`;

// Front page: the sun in the corner and a rainbow from hill to hill
export const RAINBOW = svg(390, 290, `
  <circle cx="330" cy="58" r="44" fill="#FFE08A" opacity="0.5"/>
  <circle cx="330" cy="58" r="30" fill="#FFC24D"/>
  <g fill="none" stroke-width="9" stroke-linecap="round">
    <path d="M 150 250 A 110 110 0 0 1 370 250" stroke="#FF6B6B"/>
    <path d="M 159 250 A 101 101 0 0 1 361 250" stroke="#FF9F43"/>
    <path d="M 168 250 A 92 92 0 0 1 352 250" stroke="#FFD93D"/>
    <path d="M 177 250 A 83 83 0 0 1 343 250" stroke="#6BCB77"/>
    <path d="M 186 250 A 74 74 0 0 1 334 250" stroke="#4D96FF"/>
    <path d="M 195 250 A 65 65 0 0 1 325 250" stroke="#8B7CF6"/>
  </g>
  <ellipse cx="80" cy="300" rx="190" ry="80" fill="#B9E28F"/>
  <ellipse cx="330" cy="300" rx="170" ry="70" fill="#8FCB63"/>
  <rect x="38" y="196" width="9" height="28" rx="3" fill="#8A5A35"/>
  <circle cx="42" cy="188" r="20" fill="#4E9F37"/>
  <rect x="300" y="210" width="8" height="24" rx="3" fill="#8A5A35"/>
  <circle cx="304" cy="204" r="16" fill="#6BB84A"/>`, 'preserveAspectRatio="xMidYMax slice"');

// The same scene, cropped to the sun and the rainbow, for the slim page top
export const RAINBOW_SMALL = RAINBOW.replace('viewBox="0 0 390 290"', 'viewBox="130 10 260 250"')
  .replace('preserveAspectRatio="xMidYMax slice"', 'preserveAspectRatio="xMidYMid slice"');

export const PAGE_ART = {
  // a school bag under the sun
  today: svg(170, 140, `
    <circle cx="130" cy="34" r="22" fill="#FFC24D"/>
    <g stroke="#FFC24D" stroke-width="4" stroke-linecap="round"><path d="M130 2v6M162 34h-6M152 12l-4 4M108 12l4 4"/></g>
    <path d="M52 42c0-14 12-22 24-22s24 8 24 22" fill="none" stroke="#B8402F" stroke-width="7" stroke-linecap="round"/>
    <rect x="34" y="42" width="84" height="88" rx="22" fill="#E8553D"/>
    <rect x="48" y="82" width="56" height="34" rx="10" fill="#FF8A6B"/>
    <rect x="70" y="78" width="12" height="10" rx="3" fill="#FFD93D"/>
    <path d="M6 132h158" stroke="#8FCB63" stroke-width="6" stroke-linecap="round"/>`),
  // a clipboard with ticks
  tasks: svg(170, 140, `
    <rect x="40" y="16" width="90" height="118" rx="14" fill="#C98A52"/>
    <rect x="50" y="28" width="70" height="98" rx="8" fill="#FFFFFF"/>
    <rect x="66" y="10" width="38" height="16" rx="6" fill="#8A5A35"/>
    <g stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M58 50l6 6 10-12" stroke="#3E9B30" stroke-width="5"/>
      <path d="M58 76l6 6 10-12" stroke="#3E9B30" stroke-width="5"/>
      <rect x="58" y="94" width="14" height="14" rx="4" stroke="#8FCB63" stroke-width="3"/>
      <path d="M82 52h28M82 78h28M82 101h22" stroke="#C9D8B8" stroke-width="5"/>
    </g>
    <circle cx="146" cy="34" r="10" fill="#FFD93D"/>
    <path d="M146 18v4M146 46v4M130 34h4M158 34h4" stroke="#FFD93D" stroke-width="3" stroke-linecap="round"/>`),
  // the house with a garden
  house: svg(170, 140, `
    <path d="M8 130h156" stroke="#8FCB63" stroke-width="8" stroke-linecap="round"/>
    <rect x="30" y="64" width="84" height="64" fill="#FFF3C4"/>
    <path d="M20 68L72 26l52 42z" fill="#E8553D"/>
    <rect x="62" y="92" width="20" height="36" rx="4" fill="#8A5A35"/>
    <rect x="38" y="78" width="18" height="16" rx="3" fill="#6CB4FF"/>
    <rect x="88" y="78" width="18" height="16" rx="3" fill="#6CB4FF"/>
    <rect x="92" y="34" width="10" height="20" fill="#B8402F"/>
    <rect x="138" y="94" width="8" height="34" fill="#8A5A35"/>
    <circle cx="142" cy="84" r="18" fill="#4E9F37"/>
    <circle cx="134" cy="72" r="12" fill="#6BB84A"/>
    <circle cx="40" cy="126" r="5" fill="#FF8A7A"/><circle cx="52" cy="126" r="5" fill="#FFD93D"/>`),
  // the family hand in hand under a heart
  moments: svg(190, 140, `
    <path d="M95 30c-6-10-22-8-22 4 0 10 22 22 22 22s22-12 22-22c0-12-16-14-22-4z" fill="#D9536A"/>
    <path d="M6 134h178" stroke="#8FCB63" stroke-width="6" stroke-linecap="round"/>
    <g stroke="#F2B88C" stroke-width="5" stroke-linecap="round">
      <path d="M34 92l14 8M62 92l14 6M90 104l14-4M118 98l14-6M148 100l14-8"/>
    </g>
    <circle cx="26" cy="64" r="11" fill="#F5C9A0"/>
    <path d="M14 80q12-8 24 0v52h-24z" fill="#3E9B30"/>
    <circle cx="56" cy="80" r="9" fill="#F5C9A0"/>
    <path d="M46 93q10-6 20 0v39h-20z" fill="#FFC24D"/>
    <circle cx="84" cy="88" r="8" fill="#F5C9A0"/>
    <path d="M75 100q9-5 18 0v32h-18z" fill="#6CB4FF"/>
    <circle cx="112" cy="84" r="8.5" fill="#F5C9A0"/>
    <path d="M103 96q9-5 18 0v36h-18z" fill="#A78BFA"/>
    <circle cx="166" cy="64" r="11" fill="#F5C9A0"/>
    <path d="M152 80q14-8 28 0l6 52h-40z" fill="#FF8A7A"/>
    <path d="M155 58q11-14 22 0" fill="#8A5A35"/>
    <path d="M103 82q9-8 18 0" fill="#C98A52"/>`),
  // a calendar page with a star
  calendar: svg(170, 140, `
    <rect x="28" y="24" width="114" height="108" rx="16" fill="#FFFFFF" stroke="#C9D8B8" stroke-width="3"/>
    <path d="M28 40a16 16 0 0 1 16-16h82a16 16 0 0 1 16 16v14H28z" fill="#3E9B30"/>
    <rect x="52" y="12" width="8" height="24" rx="4" fill="#2F6B2A"/>
    <rect x="110" y="12" width="8" height="24" rx="4" fill="#2F6B2A"/>
    <g fill="#DDF2CC">
      <rect x="40" y="64" width="18" height="16" rx="4"/><rect x="64" y="64" width="18" height="16" rx="4"/><rect x="88" y="64" width="18" height="16" rx="4"/><rect x="112" y="64" width="18" height="16" rx="4"/>
      <rect x="40" y="88" width="18" height="16" rx="4"/><rect x="88" y="88" width="18" height="16" rx="4"/><rect x="112" y="88" width="18" height="16" rx="4"/>
      <rect x="40" y="110" width="18" height="14" rx="4"/><rect x="64" y="110" width="18" height="14" rx="4"/>
    </g>
    <path d="M73 84l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill="#FFC24D"/>`),
  // Setup: a cog with a small plant
  family: svg(170, 140, `
    <g transform="translate(70 76)">
      <g fill="#8FCB63">
        <rect x="-8" y="-50" width="16" height="18" rx="4"/>
        <rect x="-8" y="32" width="16" height="18" rx="4"/>
        <rect x="-50" y="-8" width="18" height="16" rx="4"/>
        <rect x="32" y="-8" width="18" height="16" rx="4"/>
        <rect x="-8" y="-50" width="16" height="18" rx="4" transform="rotate(45)"/>
        <rect x="-8" y="-50" width="16" height="18" rx="4" transform="rotate(-45)"/>
        <rect x="-8" y="32" width="16" height="18" rx="4" transform="rotate(45)"/>
        <rect x="-8" y="32" width="16" height="18" rx="4" transform="rotate(-45)"/>
      </g>
      <circle r="36" fill="#8FCB63"/>
      <circle r="16" fill="#F3F9E8"/>
    </g>
    <path d="M138 132v-34" stroke="#3E9B30" stroke-width="5" stroke-linecap="round"/>
    <path d="M138 106c-16 0-22-12-22-22 14 0 22 8 22 22z" fill="#6BB84A"/>
    <path d="M138 96c14 0 20-10 20-20-12 0-20 8-20 20z" fill="#4E9F37"/>
    <path d="M118 132h40" stroke="#8A5A35" stroke-width="6" stroke-linecap="round"/>`),
};
PAGE_ART.plan = PAGE_ART.house;

// Price watch: a price tag under the sun
PAGE_ART.prices = svg(170, 140, `
  <circle cx="132" cy="32" r="20" fill="#FFC24D"/>
  <path d="M34 62l46-34h52v52l-46 34a8 8 0 0 1-11 0L34 73a8 8 0 0 1 0-11z" fill="#6BB84A" transform="rotate(8 85 75)"/>
  <circle cx="112" cy="50" r="7" fill="#F3F9E8" transform="rotate(8 85 75)"/>
  <path d="M70 86l26-26M74 66h.01M92 82h.01" stroke="#F3F9E8" stroke-width="6" stroke-linecap="round" transform="rotate(8 85 75)"/>
  <path d="M8 132q40-18 80-6t74-4" stroke="#8A5A35" stroke-width="5" fill="none" stroke-linecap="round"/>`);
