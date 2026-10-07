export const OTHER_NOT_LISTED = 'Other / Not Listed';

export interface CasteCatalogEntry {
  casteId: string;
  casteName: string;
  religions: readonly string[];
  subCastes: readonly string[];
}

const GENERIC_CASTES: readonly [string, string, string][] = [
  ['Hindu', 'Brahmin', 'hindu-brahmin'], ['Hindu', 'Kamma', 'hindu-kamma'],
  ['Hindu', 'Kapu', 'hindu-kapu'], ['Hindu', 'Raju', 'hindu-raju'],
  ['Hindu', 'Vysya', 'hindu-vysya'], ['Hindu', 'Balija', 'hindu-balija'],
  ['Hindu', 'Ezhava', 'hindu-ezhava'], ['Hindu', 'Gowda', 'hindu-gowda'],
  ['Hindu', 'Jat', 'hindu-jat'], ['Hindu', 'Kayastha', 'hindu-kayastha'],
  ['Hindu', 'Khatri', 'hindu-khatri'], ['Hindu', 'Lingayat', 'hindu-lingayat'],
  ['Hindu', 'Maratha', 'hindu-maratha'], ['Hindu', 'Nair', 'hindu-nair'],
  ['Hindu', 'Nadar', 'hindu-nadar'], ['Hindu', 'Patel', 'hindu-patel'],
  ['Hindu', 'Rajput', 'hindu-rajput'], ['Hindu', 'Yadav', 'hindu-yadav'],
  ['Hindu', 'Mudaliar', 'hindu-mudaliar'], ['Hindu', 'Chettiar', 'hindu-chettiar'],
  ['Hindu', 'Gupta', 'hindu-gupta'], ['Hindu', 'Agarwal', 'hindu-agarwal'],
  ['Hindu', 'Thevar', 'hindu-thevar'], ['Hindu', 'Vanniyar', 'hindu-vanniyar'],
  ['Hindu', 'Scheduled Caste', 'hindu-scheduled-caste'],
  ['Hindu', 'Scheduled Tribe', 'hindu-scheduled-tribe'],
  ['Muslim', 'Sunni', 'muslim-sunni'], ['Muslim', 'Shia', 'muslim-shia'],
  ['Muslim', 'Dawoodi Bohra', 'muslim-dawoodi-bohra'], ['Muslim', 'Ismaili', 'muslim-ismaili'],
  ['Muslim', 'Memon', 'muslim-memon'], ['Muslim', 'Ansari', 'muslim-ansari'],
  ['Christian', 'Roman Catholic', 'christian-roman-catholic'], ['Christian', 'Protestant', 'christian-protestant'],
  ['Christian', 'Orthodox', 'christian-orthodox'], ['Christian', 'Syrian Catholic', 'christian-syrian-catholic'],
  ['Christian', 'Syro Malabar', 'christian-syro-malabar'], ['Christian', 'Marthoma', 'christian-marthoma'],
  ['Christian', 'Pentecostal', 'christian-pentecostal'], ['Christian', 'Baptist', 'christian-baptist'],
  ['Sikh', 'Jat', 'sikh-jat'], ['Sikh', 'Khatri', 'sikh-khatri'],
  ['Sikh', 'Ramgarhia', 'sikh-ramgarhia'], ['Sikh', 'Arora', 'sikh-arora'],
  ['Sikh', 'Ahluwalia', 'sikh-ahluwalia'], ['Jain', 'Digambar', 'jain-digambar'],
  ['Jain', 'Shwetambar', 'jain-shwetambar'],
];

/** Commonly reported labels, not an official or universal classification. */
const GENERIC_SUBCASTES: Record<string, readonly string[]> = {
  Brahmin: ['Vaidiki', 'Niyogi', 'Madhwa', 'Smartha', 'Deshastha', 'Konkanastha', 'Other / Not Listed'],
  Kamma: ['Chowdary', 'Naidu', 'Kamma', 'Other / Not Listed'],
  Kapu: ['Telaga', 'Balija', 'Ontari', 'Munnuru Kapu', 'Turpu Kapu', 'Other / Not Listed'],
  Raju: ['Kshatriya Raju', 'Perika Raju', 'Other / Not Listed'],
  Vysya: ['Arya Vysya', 'Komati', 'Balija Vysya', 'Other / Not Listed'],
  Balija: ['Balija Naidu', 'Setty Balija', 'Gajula Balija', 'Other / Not Listed'],
  Ezhava: ['Thiyya', 'Ezhava', 'Other / Not Listed'], Gowda: ['Gowda', 'Vokkaliga', 'Lingayat Gowda', 'Other / Not Listed'],
  Jat: ['Jat Sikh', 'Jat Hindu', 'Jat Muslim', 'Other / Not Listed'], Kayastha: ['Srivastava', 'Mathur', 'Bhatnagar', 'Other / Not Listed'],
  Khatri: ['Khatri', 'Arora', 'Sood', 'Other / Not Listed'], Lingayat: ['Panchamasaali', 'Veerashaiva', 'Banajiga', 'Other / Not Listed'],
  Maratha: ['96 Kuli', 'Kunbi', 'Deshmukh', 'Other / Not Listed'], Nair: ['Menon', 'Pillai', 'Kurup', 'Panicker', 'Other / Not Listed'],
  Nadar: ['Shanar', 'Gramani', 'Other / Not Listed'], Patel: ['Leuva Patel', 'Kadva Patel', 'Other / Not Listed'],
  Rajput: ['Sisodia', 'Rathore', 'Chauhan', 'Solanki', 'Other / Not Listed'], Yadav: ['Ahir', 'Golla', 'Gavli', 'Other / Not Listed'],
  Mudaliar: ['Kaikolar', 'Sengunthar', 'Thondaimandala', 'Other / Not Listed'], Chettiar: ['Nattukottai', 'Devanga', 'Vellalar', 'Other / Not Listed'],
  Gupta: ['Bania', 'Agarwal', 'Khatri', 'Other / Not Listed'], Agarwal: ['Bisa Agarwal', 'Dasa Agarwal', 'Other / Not Listed'],
  Thevar: ['Maravar', 'Kallar', 'Agamudayar', 'Other / Not Listed'], Vanniyar: ['Vanniyar', 'Palli', 'Padayachi', 'Other / Not Listed'],
  'Scheduled Caste': ['Adi Andhra', 'Mala', 'Madiga', 'Chamar', 'Jatav', 'Other / Not Listed'],
  'Scheduled Tribe': ['Gond', 'Koya', 'Lambada / Banjara', 'Chenchu', 'Other / Not Listed'],
  Sunni: ['Hanafi', 'Shafi', 'Ahl-e-Hadith', 'Other / Not Listed'], Shia: ['Ithna Ashari', 'Ismaili', 'Bohra', 'Other / Not Listed'],
  'Dawoodi Bohra': ['Dawoodi Bohra', 'Other / Not Listed'], Ismaili: ['Khoja', 'Bohra', 'Other / Not Listed'],
  Memon: ['Halai Memon', 'Kutchi Memon', 'Other / Not Listed'], Ansari: ['Julaha', 'Momin', 'Other / Not Listed'],
  'Roman Catholic': ['Latin Catholic', 'Syro-Malabar Catholic', 'Other / Not Listed'], Protestant: ['Anglican', 'Baptist', 'Methodist', 'Other / Not Listed'],
  Orthodox: ['Malankara Orthodox', 'Jacobite', 'Other / Not Listed'], 'Syrian Catholic': ['Syro-Malabar', 'Syro-Malankara', 'Other / Not Listed'],
  'Syro Malabar': ['Syro-Malabar', 'Other / Not Listed'], Marthoma: ['Mar Thoma', 'Other / Not Listed'], Pentecostal: ['Assemblies of God', 'Church of God', 'Other / Not Listed'], Baptist: ['Southern Baptist', 'Independent Baptist', 'Other / Not Listed'],
  'Digambar': ['Bisapanthi', 'Terapanthi', 'Taranpanthi', 'Other / Not Listed'], Shwetambar: ['Murtipujaka', 'Sthanakvasi', 'Terapanthi', 'Other / Not Listed'],
};
export const CASTE_CATALOG: readonly CasteCatalogEntry[] = [
  {
    casteId: 'hindu-reddy',
    casteName: 'Reddy',
    religions: ['Hindu'],
    subCastes: [
      'Panta Reddy', 'Pakanati Reddy', 'Motati Reddy', 'Pedakanti Reddy',
      'Velanati Reddy', 'Murikinati Reddy', 'Desuru Reddy', 'Pokanati Reddy',
      'Gudati / Gurati Reddy', 'Gone Reddy / Gone Kapu', 'Gandla Reddy',
      'Palle Reddy', 'Palnati Reddy', 'Nanugonda Reddy', 'Neravati Reddy',
      'Vadde Reddy', 'Konda Reddy', 'Arava Reddy', 'Ayodhi Reddy', 'Reddy Kapu',
      OTHER_NOT_LISTED,
    ],
  },
  {
    casteId: 'hindu-velama',
    casteName: 'Velama',
    religions: ['Hindu'],
    subCastes: [
      'Padmanayaka Velama / Padma Velama', 'Koppula Velama', 'Polinati Velama',
      'Adi Velama', 'Kamma Velama', 'Thoththala / Koppala Velama',
      'Katcha-Katha Velama', 'Pedda Velama', 'Yanadi Velama', 'Ponnēti Velama',
      'Kapu Velama / Gūna Velama', OTHER_NOT_LISTED,
    ],
  },
  ...GENERIC_CASTES.map(([religion, casteName, casteId]) => ({
    casteId,
    casteName,
    religions: [religion],
    subCastes: GENERIC_SUBCASTES[casteName] ?? [OTHER_NOT_LISTED],
  })),
];

export function casteCatalogResponse() {
  return CASTE_CATALOG.map(({ casteId, casteName, religions, subCastes }) => ({
    casteId,
    casteName,
    religions,
    subCastes: subCastes.map((subCasteName, index) => ({
      subCasteId: `${casteId}-${index + 1}`,
      subCasteName,
      active: true,
    })),
  }));
}

export function findCaste(casteName: string) {
  return CASTE_CATALOG.find((entry) => entry.casteName === casteName);
}

export function isKnownSubCaste(casteName: string, subCasteName: string) {
  const caste = findCaste(casteName);
  const isKnownLabel = CASTE_CATALOG.some((entry) => entry.subCastes.includes(subCasteName));
  return !caste || !isKnownLabel || caste.subCastes.includes(subCasteName);
}
