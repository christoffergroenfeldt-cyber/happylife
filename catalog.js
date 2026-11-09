// Happy Life – things to pick from on the "Find" page.
// Nearby places (takeaway, restaurants, cinemas, florists) come from OpenStreetMap
// via places.js; the lists below are hand-picked and need no address.

// Food types for takeaway/restaurants. `tags` are OpenStreetMap cuisine values;
// a place goes in the first group whose tag matches one of its cuisines.
export const CUISINES = [
  { key: 'pizza', icon: '🍕', tags: ['pizza'], da: 'Pizza', en: 'Pizza', fr: 'Pizza' },
  { key: 'italian', icon: '🇮🇹', tags: ['italian', 'pasta'], da: 'Italiensk', en: 'Italian', fr: 'Italien' },
  { key: 'burger', icon: '🍔', tags: ['burger'], da: 'Burger', en: 'Burgers', fr: 'Burgers' },
  { key: 'japanese', icon: '🇯🇵', tags: ['sushi', 'japanese', 'ramen'], da: 'Japansk & sushi', en: 'Japanese & sushi', fr: 'Japonais & sushis' },
  { key: 'chinese', icon: '🇨🇳', tags: ['chinese', 'dim_sum', 'cantonese', 'sichuan'], da: 'Kinesisk', en: 'Chinese', fr: 'Chinois' },
  { key: 'thai', icon: '🇹🇭', tags: ['thai'], da: 'Thai', en: 'Thai', fr: 'Thaï' },
  { key: 'vietnamese', icon: '🇻🇳', tags: ['vietnamese', 'pho', 'banh_mi'], da: 'Vietnamesisk', en: 'Vietnamese', fr: 'Vietnamien' },
  { key: 'korean', icon: '🇰🇷', tags: ['korean'], da: 'Koreansk', en: 'Korean', fr: 'Coréen' },
  { key: 'asian', icon: '🥢', tags: ['asian', 'wok', 'noodle', 'noodles', 'dumplings'], da: 'Asiatisk', en: 'Asian', fr: 'Asiatique' },
  { key: 'indian', icon: '🇮🇳', tags: ['indian', 'nepalese', 'pakistani', 'curry', 'sri_lankan'], da: 'Indisk & nepalesisk', en: 'Indian & Nepalese', fr: 'Indien & népalais' },
  { key: 'mideast', icon: '🥙', tags: ['kebab', 'turkish', 'shawarma', 'falafel', 'middle_eastern', 'lebanese', 'syrian', 'arab', 'persian', 'iranian'], da: 'Kebab & Mellemøsten', en: 'Kebab & Middle Eastern', fr: 'Kebab & Moyen-Orient' },
  { key: 'greek', icon: '🇬🇷', tags: ['greek', 'gyros'], da: 'Græsk', en: 'Greek', fr: 'Grec' },
  { key: 'mexican', icon: '🇲🇽', tags: ['mexican', 'tex-mex', 'burrito', 'tacos', 'taco'], da: 'Mexicansk', en: 'Mexican', fr: 'Mexicain' },
  { key: 'american', icon: '🇺🇸', tags: ['american', 'bbq', 'barbecue', 'diner', 'wings'], da: 'Amerikansk & grill', en: 'American & BBQ', fr: 'Américain & grill' },
  { key: 'chicken', icon: '🍗', tags: ['chicken', 'fried_chicken'], da: 'Kylling', en: 'Chicken', fr: 'Poulet' },
  { key: 'hotdog', icon: '🌭', tags: ['hot_dog', 'sausage'], da: 'Pølser', en: 'Hot dogs', fr: 'Hot-dogs' },
  { key: 'danish', icon: '🇩🇰', tags: ['danish', 'smørrebrød', 'smorrebrod', 'regional', 'nordic', 'scandinavian'], da: 'Dansk & smørrebrød', en: 'Danish & open sandwiches', fr: 'Danois & smørrebrød' },
  { key: 'fish', icon: '🐟', tags: ['fish_and_chips', 'seafood', 'fish'], da: 'Fisk & skaldyr', en: 'Fish & seafood', fr: 'Poisson & fruits de mer' },
  { key: 'french', icon: '🇫🇷', tags: ['french', 'bistro', 'crepe', 'crêpe'], da: 'Fransk', en: 'French', fr: 'Français' },
  { key: 'spanish', icon: '🇪🇸', tags: ['spanish', 'tapas'], da: 'Spansk & tapas', en: 'Spanish & tapas', fr: 'Espagnol & tapas' },
  { key: 'steak', icon: '🥩', tags: ['steak_house', 'steak', 'grill'], da: 'Steakhouse', en: 'Steakhouse', fr: 'Grill & steak' },
  { key: 'healthy', icon: '🥗', tags: ['sandwich', 'salad', 'poke', 'healthy', 'bagel', 'juice', 'vegan', 'vegetarian'], da: 'Sandwich, salat & poke', en: 'Sandwiches, salads & poke', fr: 'Sandwichs, salades & poke' },
  { key: 'sweet', icon: '🍦', tags: ['ice_cream', 'coffee_shop', 'cake', 'dessert', 'bakery', 'waffle', 'donut', 'frozen_yogurt'], da: 'Is, kaffe & kage', en: 'Ice cream, coffee & cake', fr: 'Glaces, café & gâteaux' },
  { key: 'other', icon: '🍽️', tags: [], da: 'Andet', en: 'Other', fr: 'Autre' },
];

export function cuisineGroup(cuisine) {
  const parts = String(cuisine || '').toLowerCase().split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  for (const p of parts) {
    const g = CUISINES.find((c) => c.tags.includes(p));
    if (g) return g.key;
  }
  return 'other';
}

// Hand-picked lists. Group names are translated; place names are proper nouns.
const G = (icon, da, en, fr, items) => ({ icon, label: { da, en, fr }, items });

export const CATALOG = {
  themepark: [
    G('🎡', 'Sjælland & øerne', 'Zealand & islands', 'Seeland & îles', [
      ['Tivoli', 'København'], ['Bakken', 'Klampenborg'], ['BonBon-Land', 'Holme-Olstrup'],
      ['Sommerland Sjælland', 'Nykøbing Sj.'], ['Knuthenborg Safaripark', 'Maribo'], ['Joboland', 'Bornholm'],
      ['Lalandia Rødby', 'Lolland']]),
    G('🎢', 'Jylland & Fyn', 'Jutland & Funen', 'Jutland & Fionie', [
      ['Legoland', 'Billund'], ['Lalandia Billund', 'Billund'], ['Djurs Sommerland', 'Nimtofte'],
      ['Fårup Sommerland', 'Blokhus'], ['Tivoli Friheden', 'Aarhus'], ['Jesperhus', 'Mors'],
      ['Givskud Zoo', 'Givskud'], ['Egeskov Slot', 'Fyn']]),
    G('🇸🇪', 'Sverige', 'Sweden', 'Suède', [
      ['Liseberg', 'Göteborg'], ['Gröna Lund', 'Stockholm'], ['Astrid Lindgrens Värld', 'Vimmerby'],
      ['Skånes Djurpark', 'Höör']]),
    G('🌍', 'Længere væk', 'Further away', 'Plus loin', [
      ['Hansa-Park', 'Tyskland'], ['Heide Park', 'Tyskland'], ['Legoland Deutschland', 'Tyskland'],
      ['Europa-Park', 'Tyskland'], ['Phantasialand', 'Tyskland'], ['Efteling', 'Holland'],
      ['Disneyland Paris', 'Frankrig'], ['PortAventura', 'Spanien']]),
  ],
  vacation: [
    G('🏖️', 'Badeferie', 'Beach holiday', 'Vacances à la plage', [
      ['Mallorca', 'Spanien'], ['Gran Canaria', 'Spanien'], ['Costa del Sol', 'Spanien'], ['Algarve', 'Portugal'],
      ['Kreta', 'Grækenland'], ['Rhodos', 'Grækenland'], ['Cypern', ''], ['Antalya', 'Tyrkiet'], ['Sardinien', 'Italien']]),
    G('⛷️', 'Skiferie', 'Ski holiday', 'Vacances au ski', [
      ['Trysil', 'Norge'], ['Hemsedal', 'Norge'], ['Sälen', 'Sverige'], ['Tyrol', 'Østrig'],
      ['Dolomitterne', 'Italien'], ['Les Alpes', 'Frankrig']]),
    G('🏙️', 'Storby', 'City break', 'Grande ville', [
      ['London', 'England'], ['Paris', 'Frankrig'], ['Rom', 'Italien'], ['Barcelona', 'Spanien'], ['Berlin', 'Tyskland'],
      ['Amsterdam', 'Holland'], ['Prag', 'Tjekkiet'], ['Lissabon', 'Portugal']]),
    G('🏔️', 'Natur & roadtrip', 'Nature & road trip', 'Nature & road trip', [
      ['Fjordene', 'Norge'], ['Småland', 'Sverige'], ['Skotland', ''], ['Island', ''], ['Gardasøen', 'Italien'], ['Toscana', 'Italien']]),
    G('🇩🇰', 'Danmark', 'Denmark', 'Danemark', [
      ['Skagen', ''], ['Bornholm', ''], ['Vestkysten', ''], ['Ærø', ''], ['Møn', ''], ['Rømø', '']]),
    G('✈️', 'Langrejse', 'Long-haul', 'Long-courrier', [
      ['Thailand', ''], ['Florida', 'USA'], ['Dubai', ''], ['Bali', 'Indonesien'], ['Mauritius', '']]),
  ],
  weekend: [
    G('🇩🇰', 'Danmark', 'Denmark', 'Danemark', [
      ['Sommerhus i Nordsjælland', ''], ['Skagen', ''], ['Bornholm', ''], ['Møns Klint', ''], ['Vadehavet & Rømø', ''],
      ['Aarhus', ''], ['Odense', ''], ['Ribe', ''], ['Lalandia', '']]),
    G('🚆', 'Nabolande', 'Neighbouring countries', 'Pays voisins', [
      ['Malmö', 'Sverige'], ['Göteborg', 'Sverige'], ['Hamburg', 'Tyskland'], ['Berlin', 'Tyskland'],
      ['Oslo med DFDS', 'Norge'], ['Stockholm', 'Sverige']]),
    G('🏕️', 'Oplevelser', 'Experiences', 'Expériences', [
      ['Shelter-tur', ''], ['Hotel med pool', ''], ['Kanotur på Gudenåen', ''], ['Bondegårdsferie', ''], ['Hyttetur', '']]),
  ],
};
CATALOG.trip = [...CATALOG.weekend, ...CATALOG.vacation];

// Which nearby categories each moment type searches, in display order
export const NEARBY = {
  takeaway: ['takeaway'], restaurant: ['restaurant'], date: ['restaurant', 'cinema', 'theatre'],
  movie: ['cinema'], flowers: ['florist'],
};
