export type QuestionFormat = 'written' | 'mc' | 'mixed';
export type Preset = {
  id: string;
  label: string;
  minutes: number;
  format: QuestionFormat;
  source: string;
  examSystem: string | null;
  year: number | null;
};

const framework = (subject: string, file: string) =>
  `https://www.hkeaa.edu.hk/DocLibrary/HKDSE/Subject_Information/${subject}/2026hkdse-${file}.pdf`;

export const PRESETS: Preset[] = [
  {
    id: 'custom',
    label: 'Custom time limit',
    minutes: 60,
    format: 'written',
    source: '',
    examSystem: null,
    year: null,
  },
  ...(
    [
      ['math1', 'Mathematics · Paper 1', 135, 'written', 'math', 'e-math'],
      ['math2', 'Mathematics · Paper 2', 75, 'mc', 'math', 'e-math'],
      ['m1', 'Mathematics · M1', 150, 'written', 'math', 'e-math'],
      ['m2', 'Mathematics · M2', 150, 'written', 'math', 'e-math'],
      ['eng1', 'English · Paper 1', 90, 'mixed', 'eng_lang', 'e-elang'],
      ['eng2', 'English · Paper 2', 120, 'written', 'eng_lang', 'e-elang'],
      ['chi1', 'Chinese · Paper 1', 90, 'mixed', 'chi_lang', 'c-clang'],
      ['chi2', 'Chinese · Paper 2', 135, 'written', 'chi_lang', 'c-clang'],
      ['phy1', 'Physics · Paper 1', 150, 'mixed', 'phy', 'e-phy'],
      ['phy2', 'Physics · Paper 2', 60, 'mixed', 'phy', 'e-phy'],
      ['chem1', 'Chemistry · Paper 1', 150, 'mixed', 'chem', 'e-chem'],
      ['chem2', 'Chemistry · Paper 2', 60, 'written', 'chem', 'e-chem'],
      ['bio1', 'Biology · Paper 1', 150, 'mixed', 'bio', 'e-bio'],
      ['bio2', 'Biology · Paper 2', 60, 'written', 'bio', 'e-bio'],
      ['econ1', 'Economics · Paper 1', 60, 'mc', 'econ', 'e-econ'],
      ['econ2', 'Economics · Paper 2', 150, 'written', 'econ', 'e-econ'],
    ] as [string, string, number, QuestionFormat, string, string][]
  ).map(([id, label, minutes, format, subject, file]) => ({
    id,
    label,
    minutes,
    format,
    source: framework(subject, file),
    examSystem: 'HKDSE',
    year: 2026,
  })),
];
