// Happy Life – ready-made routines for children aged about 7, 10 and 13.
// A parent picks child(ren), age and routines; the app creates normal plans
// with normal tasks, which can then be edited or deleted like any other.
// Morning and after-school routines repeat on weekdays, bedtime every day.

export const AGES = [7, 10, 13];
export const ROUTINES = ['morning', 'afterschool', 'bedtime'];
export const ROUTINE_REC = { morning: 'weekdays', afterschool: 'weekdays', bedtime: 'daily' };
// Suggested reminder times (only used if the parent ticks "reminders")
export const ROUTINE_TIME = {
  morning: { 7: '07:00', 10: '07:00', 13: '06:45' },
  afterschool: { 7: '15:30', 10: '16:00', 13: '16:30' },
  bedtime: { 7: '19:00', 10: '20:00', 13: '21:00' },
};

export const TEMPLATES = {
  da: {
    7: {
      morning: ['Stå op og tag tøj på', 'Spis morgenmad', 'Børst tænder', 'Red seng',
        'Tjek at madkasse og drikkedunk er i tasken', 'Jakke og sko på uden at blive mindet om det'],
      afterschool: ['Hæng jakken op og stil skoene på plads', 'Tøm skoletasken og giv madkassen til en voksen',
        'Lektier eller læsning i 15 minutter', 'Ryd legetøjet op', 'Hjælp med at dække bord'],
      bedtime: ['Tag bad eller vask dig', 'Tag nattøj på', 'Børst tænder', 'Læg tøj frem til i morgen',
        'Læs eller hør en godnathistorie', 'Lys slukket kl. 19.30'],
    },
    10: {
      morning: ['Stå op, når vækkeuret ringer', 'Red seng', 'Spis morgenmad og sæt tallerkenen i opvaskeren',
        'Børst tænder', 'Tjek skemaet og pak tasken', 'Smør madpakke (gerne med lidt hjælp)'],
      afterschool: ['Tøm tasken og sæt madkassen i opvasken', 'Lav lektier', 'Læs 20 minutter',
        'Øv instrument eller sport', 'Skærm først, når lektierne er lavet', 'Hjælp med aftensmaden eller dæk bord'],
      bedtime: ['Tag bad', 'Børst tænder', 'Pak tasken til i morgen', 'Læg tøj frem',
        'Tablet/telefon til opladning uden for værelset', 'Læs 20 minutter', 'Lys slukket kl. 20.30'],
    },
    13: {
      morning: ['Stå op selv uden at blive vækket', 'Red seng og luft ud', 'Spis morgenmad – og ryd op efter dig',
        'Tandbørstning og deodorant', 'Smør din egen madpakke', 'Tjek Aula og dagens skema'],
      afterschool: ['Lektier og afleveringer', 'Tøm tasken og sæt madkassen i opvasken',
        'Én huslig opgave (tøm opvaskeren eller tag skrald ud)', 'Træning eller fritidsaktivitet', 'Læs 20 minutter'],
      bedtime: ['Tag bad', 'Børst tænder', 'Pak tasken og tjek morgendagens skema', 'Snavsetøj i vasketøjskurven',
        'Telefon til opladning i køkkenet kl. 21', 'Lys slukket kl. 21.30'],
    },
  },
  en: {
    7: {
      morning: ['Get up and get dressed', 'Eat breakfast', 'Brush your teeth', 'Make your bed',
        'Check lunchbox and water bottle are in your bag', 'Coat and shoes on without being reminded'],
      afterschool: ['Hang up your coat and put your shoes away', 'Empty your school bag and hand the lunchbox to a grown-up',
        'Homework or reading for 15 minutes', 'Tidy up your toys', 'Help set the table'],
      bedtime: ['Bath or wash', 'Put on pyjamas', 'Brush your teeth', 'Lay out clothes for tomorrow',
        'Read or listen to a bedtime story', 'Lights out at 7.30 pm'],
    },
    10: {
      morning: ['Get up when the alarm goes off', 'Make your bed', 'Eat breakfast and put your plate in the dishwasher',
        'Brush your teeth', 'Check the timetable and pack your bag', 'Make your packed lunch (a little help is fine)'],
      afterschool: ['Empty your bag and put the lunchbox in the sink', 'Do your homework', 'Read for 20 minutes',
        'Practise an instrument or sport', 'Screens only after homework', 'Help with dinner or set the table'],
      bedtime: ['Shower', 'Brush your teeth', 'Pack your bag for tomorrow', 'Lay out clothes',
        'Tablet/phone charging outside your room', 'Read for 20 minutes', 'Lights out at 8.30 pm'],
    },
    13: {
      morning: ['Get up on your own', 'Make your bed and open the window', 'Eat breakfast – and clean up after yourself',
        'Teeth and deodorant', 'Make your own packed lunch', 'Check the school app and today’s timetable'],
      afterschool: ['Homework and assignments', 'Empty your bag and put the lunchbox in the sink',
        'One household chore (empty the dishwasher or take out the rubbish)', 'Training or after-school activity', 'Read for 20 minutes'],
      bedtime: ['Shower', 'Brush your teeth', 'Pack your bag and check tomorrow’s timetable', 'Dirty clothes in the laundry basket',
        'Phone charging in the kitchen at 9 pm', 'Lights out at 9.30 pm'],
    },
  },
  fr: {
    7: {
      morning: ['Se lever et s’habiller', 'Prendre le petit-déjeuner', 'Se brosser les dents', 'Faire son lit',
        'Vérifier la boîte à goûter et la gourde dans le sac', 'Manteau et chaussures sans qu’on le rappelle'],
      afterschool: ['Accrocher son manteau et ranger ses chaussures', 'Vider son cartable et donner la boîte à goûter à un adulte',
        'Devoirs ou lecture 15 minutes', 'Ranger ses jouets', 'Aider à mettre la table'],
      bedtime: ['Bain ou toilette', 'Mettre son pyjama', 'Se brosser les dents', 'Préparer ses vêtements pour demain',
        'Lire ou écouter une histoire', 'Lumière éteinte à 19 h 30'],
    },
    10: {
      morning: ['Se lever quand le réveil sonne', 'Faire son lit', 'Prendre le petit-déjeuner et mettre son assiette au lave-vaisselle',
        'Se brosser les dents', 'Vérifier l’emploi du temps et faire son sac', 'Préparer son déjeuner (un peu d’aide, c’est bien)'],
      afterschool: ['Vider son sac et mettre la boîte à goûter dans l’évier', 'Faire ses devoirs', 'Lire 20 minutes',
        'S’entraîner (instrument ou sport)', 'Écrans seulement après les devoirs', 'Aider au dîner ou mettre la table'],
      bedtime: ['Douche', 'Se brosser les dents', 'Préparer son sac pour demain', 'Préparer ses vêtements',
        'Tablette/téléphone en charge hors de la chambre', 'Lire 20 minutes', 'Lumière éteinte à 20 h 30'],
    },
    13: {
      morning: ['Se lever seul', 'Faire son lit et aérer', 'Petit-déjeuner – et ranger derrière soi',
        'Dents et déodorant', 'Préparer son propre déjeuner', 'Vérifier l’ENT et l’emploi du temps'],
      afterschool: ['Devoirs et rendus', 'Vider son sac et mettre la boîte à goûter dans l’évier',
        'Une tâche ménagère (vider le lave-vaisselle ou sortir les poubelles)', 'Entraînement ou activité', 'Lire 20 minutes'],
      bedtime: ['Douche', 'Se brosser les dents', 'Préparer son sac et vérifier l’emploi du temps de demain', 'Linge sale dans le panier',
        'Téléphone en charge dans la cuisine à 21 h', 'Lumière éteinte à 21 h 30'],
    },
  },
};
