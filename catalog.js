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
      ['Tivoli', 'København', 'https://www.tivoli.dk'], ['Bakken', 'Klampenborg', 'https://www.bakken.dk'], ['BonBon-Land', 'Holme-Olstrup', 'https://www.bonbonland.dk'],
      ['Sommerland Sjælland', 'Nykøbing Sj.', 'https://www.sommerlandsj.dk'], ['Knuthenborg Safaripark', 'Maribo', 'https://www.knuthenborg.dk'], ['Joboland', 'Bornholm', 'https://www.joboland.dk'],
      ['Lalandia Rødby', 'Lolland', 'https://www.lalandia.dk']]),
    G('🎢', 'Jylland & Fyn', 'Jutland & Funen', 'Jutland & Fionie', [
      ['Legoland', 'Billund', 'https://www.legoland.dk'], ['Lalandia Billund', 'Billund', 'https://www.lalandia.dk'], ['Djurs Sommerland', 'Nimtofte', 'https://www.djurssommerland.dk'],
      ['Fårup Sommerland', 'Blokhus', 'https://www.faarupsommerland.dk'], ['Tivoli Friheden', 'Aarhus', 'https://www.friheden.dk'], ['Jesperhus', 'Mors', 'https://www.jesperhus.dk'],
      ['Givskud Zoo', 'Givskud', 'https://www.givskudzoo.dk'], ['Egeskov Slot', 'Fyn', 'https://www.egeskov.dk']]),
    G('🇸🇪', 'Sverige', 'Sweden', 'Suède', [
      ['Liseberg', 'Göteborg', 'https://www.liseberg.se'], ['Gröna Lund', 'Stockholm', 'https://www.gronalund.com'], ['Astrid Lindgrens Värld', 'Vimmerby', 'https://www.alv.se'],
      ['Skånes Djurpark', 'Höör', 'https://www.skanesdjurpark.se']]),
    G('🌍', 'Længere væk', 'Further away', 'Plus loin', [
      ['Hansa-Park', 'Tyskland', 'https://www.hansapark.de'], ['Heide Park', 'Tyskland', 'https://www.heide-park.de'], ['Legoland Deutschland', 'Tyskland', 'https://www.legoland.de'],
      ['Europa-Park', 'Tyskland', 'https://www.europapark.de'], ['Phantasialand', 'Tyskland', 'https://www.phantasialand.de'], ['Efteling', 'Holland', 'https://www.efteling.com'],
      ['Disneyland Paris', 'Frankrig', 'https://www.disneylandparis.com'], ['PortAventura', 'Spanien', 'https://www.portaventuraworld.com']]),
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

// Book or order online, per moment type: [name, url, short description da/en/fr].
// Checked November 2026 (Just Eat left Denmark in April 2026; Uber Eats arrived).
const L = (name, url, da, en, fr) => ({ name, url, about: { da, en, fr } });
const ONLINE = {
  flowers: [
    L('Interflora', 'https://www.interflora.dk', 'Blomster leveret samme dag', 'Same-day flower delivery', 'Fleurs livrées le jour même'),
    L('Euroflorist', 'https://www.euroflorist.dk', 'Buketter med levering', 'Bouquets delivered', 'Bouquets livrés'),
  ],
  takeaway: [
    L('Wolt', 'https://wolt.com/da/dnk', 'Takeaway leveret til døren', 'Takeaway delivered', 'Plats livrés à domicile'),
    L('Uber Eats', 'https://www.ubereats.com/dk', 'Takeaway leveret (større byer)', 'Takeaway delivered (larger cities)', 'Plats livrés (grandes villes)'),
  ],
  restaurant: [
    L('DinnerBooking', 'https://www.dinnerbooking.com', 'Book bord online', 'Book a table online', 'Réserver une table'),
  ],
  movie: [
    L('Kino.dk', 'https://www.kino.dk', 'Alle film og biografer – køb billet', 'All films and cinemas – buy tickets', 'Tous les films et cinémas – billets'),
    L('Nordisk Film Biografer', 'https://www.nfbio.dk', 'Billetter og spilletider', 'Tickets and showtimes', 'Billets et séances'),
  ],
  surprise: [
    L('OpdagDanmark', 'https://www.opdagdanmark.dk', 'Ophold og oplevelser – også som gave', 'Stays and experiences – also as gifts', 'Séjours et expériences – aussi en cadeau'),
    L('Smartbox', 'https://www.smartbox.com/dk/', 'Oplevelsesgaver', 'Experience gift boxes', 'Coffrets cadeaux'),
    L('Interflora', 'https://www.interflora.dk', 'Blomster og gaver leveret', 'Flowers and gifts delivered', 'Fleurs et cadeaux livrés'),
  ],
  date: [
    L('DinnerBooking', 'https://www.dinnerbooking.com', 'Book bord online', 'Book a table online', 'Réserver une table'),
    L('Kino.dk', 'https://www.kino.dk', 'Biografbilletter', 'Cinema tickets', 'Billets de cinéma'),
    L('Ticketmaster', 'https://www.ticketmaster.dk', 'Koncerter, teater og shows', 'Concerts, theatre and shows', 'Concerts, théâtre et spectacles'),
  ],
  vacation: [
    L('Spies', 'https://www.spies.dk', 'Charter- og pakkerejser', 'Package holidays', 'Voyages organisés'),
    L('TUI', 'https://www.tui.dk', 'Charter- og pakkerejser', 'Package holidays', 'Voyages organisés'),
    L('Apollo', 'https://www.apollorejser.dk', 'Charter- og pakkerejser', 'Package holidays', 'Voyages organisés'),
    L('Bravo Tours', 'https://www.bravotours.dk', 'Charter- og pakkerejser', 'Package holidays', 'Voyages organisés'),
    L('momondo', 'https://www.momondo.dk', 'Sammenlign fly og hoteller', 'Compare flights and hotels', 'Comparer vols et hôtels'),
  ],
  weekend: [
    L('Booking.com', 'https://www.booking.com', 'Hoteller og ophold', 'Hotels and stays', 'Hôtels et séjours'),
    L('Airbnb', 'https://www.airbnb.dk', 'Huse og lejligheder', 'Homes and flats', 'Maisons et appartements'),
    L('Novasol', 'https://www.novasol.dk', 'Sommerhuse', 'Holiday cottages', 'Maisons de vacances'),
    L('OpdagDanmark', 'https://www.opdagdanmark.dk', 'Ophold og oplevelser i Danmark', 'Stays and experiences in Denmark', 'Séjours et expériences au Danemark'),
  ],
  trip: [
    L('momondo', 'https://www.momondo.dk', 'Sammenlign fly og hoteller', 'Compare flights and hotels', 'Comparer vols et hôtels'),
    L('Booking.com', 'https://www.booking.com', 'Hoteller og ophold', 'Hotels and stays', 'Hôtels et séjours'),
    L('Airbnb', 'https://www.airbnb.dk', 'Huse og lejligheder', 'Homes and flats', 'Maisons et appartements'),
  ],
  themepark: [],
  custom: [
    L('OpdagDanmark', 'https://www.opdagdanmark.dk', 'Oplevelser i hele Danmark', 'Experiences all over Denmark', 'Expériences dans tout le Danemark'),
  ],
};
export const onlineLinks = (kind) => ONLINE[kind] || [];

// What to search for on the map around home, per moment type
export const MAP_QUERY = {
  flowers: 'blomsterbutik', takeaway: 'takeaway', restaurant: 'restaurant', date: 'restaurant',
  movie: 'biograf', themepark: 'forlystelsespark', weekend: 'hotel', surprise: 'gavebutik',
};
