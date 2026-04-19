export enum SkinTone {
  TRES_CLAIRE = 'tres_claire',
  CLAIRE = 'claire',
  CLAIRE_MOYENNE = 'claire_moyenne',
  MATE = 'mate',
  FONCEE = 'foncee',
  TRES_FONCEE = 'tres_foncee',
}

export type SkinToneOption = {
  value: SkinTone,
  label: string,
  previewHex: string,
};

export const SKIN_TONE_OPTIONS: SkinToneOption[] = [
  {
    value: SkinTone.TRES_CLAIRE,
    label: 'Tres claire',
    previewHex: '#F6E1D3',
  },
  {
    value: SkinTone.CLAIRE,
    label: 'Claire',
    previewHex: '#EAC8AF',
  },
  {
    value: SkinTone.CLAIRE_MOYENNE,
    label: 'Claire moyenne',
    previewHex: '#D7A889',
  },
  {
    value: SkinTone.MATE,
    label: 'Mate',
    previewHex: '#B8815E',
  },
  {
    value: SkinTone.FONCEE,
    label: 'Foncee',
    previewHex: '#8C5A3C',
  },
  {
    value: SkinTone.TRES_FONCEE,
    label: 'Tres foncee',
    previewHex: '#5F3B28',
  },
];

export const SKIN_REQUIRED_PRESTATIONS: string[] = [
  'TATTOO',
  'RETOUCHE',
  'PROJET',
];
