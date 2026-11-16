export function textObject(overrides = {}) {
  return {
    id: 'text-1',
    position: { x: 20, y: 30 },
    paragraphs: [
      {
        align: 'left',
        runs: [{ text: 'Hello', fontSize: 32, inkRaw: '#111827', bold: false, italic: false }],
      },
    ],
    ...overrides,
  };
}
