export function imageObject() {
  return {
    kind: 'image',
    id: 'image-1',
    position: { x: 20, y: 30 },
    width: 200,
    height: 100,
    title: 'Picture',
    assetId: 'asset-1',
  };
}
export function tableObject() {
  return {
    kind: 'table',
    id: 'table-1',
    position: { x: -100, y: 20 },
    columnWidths: [160, 120],
    borderRaw: '#111827',
    rows: [
      {
        minHeight: 48,
        cells: [
          [
            {
              align: 'left',
              runs: [
                {
                  text: 'Hello world',
                  fontSize: 24,
                  inkRaw: '#111827',
                  bold: true,
                  italic: false,
                  highlightRaw: '#fff176',
                },
              ],
            },
          ],
          [{ align: 'center', runs: [] }],
        ],
      },
      {
        minHeight: 64,
        cells: [
          [
            {
              align: 'right',
              runs: [
                { text: 'Second line', fontSize: 16, inkRaw: '#2563eb', bold: false, italic: true },
              ],
            },
          ],
          [{ align: 'left', runs: [] }],
        ],
      },
    ],
  };
}
