const workerData = JSON.parse(process.argv[2]);
const { readFile } = require('node:fs/promises');

async function extract() {
  const buffer = await readFile(workerData.path);
  const ext = workerData.extension;
  if (['docx', 'xlsx', 'pptx'].includes(ext)) {
    const AdmZip = require('adm-zip');
    const entries = new AdmZip(buffer).getEntries();
    if (entries.length > 3000 || entries.reduce((n, e) => n + e.header.size, 0) > 80 * 1024 * 1024) throw new Error('Document exceeds indexing limits.');
  }
  if (ext === 'pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false });
    try {
      if (workerData.mode === 'preview') {
        const page = workerData.page;
        const info = await parser.getInfo({ parsePageInfo: true, partial: [page] });
        const dimensions = info.pages[0];
        if (!dimensions || !Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) throw new Error('Invalid page.');
        const scale = Math.min(1.5, 1000 / dimensions.width, 1400 / dimensions.height);
        const rendered = await parser.getScreenshot({ partial: [page], scale, imageDataUrl: false, imageBuffer: true });
        if (!rendered.pages[0]?.data?.length) throw new Error('Rendering failed.');
        return { image: rendered.pages[0].data, total: info.total };
      }
      return (await parser.getText({ first: 50 })).text;
    } finally { await parser.destroy(); }
  }
  if (ext === 'docx') return (await require('mammoth').extractRawText({ buffer })).value;
  if (ext === 'xlsx') {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    let text = '';
    workbook.eachSheet(sheet => {
      text += `\n# ${sheet.name}\n`;
      let rows = 0;
      sheet.eachRow(row => { if (++rows <= 500 && text.length < 100000) text += row.values.slice(1).map(v => typeof v === 'object' && v ? ('result' in v ? v.result : 'richText' in v ? v.richText.map(t => t.text).join('') : 'text' in v ? v.text : '') : v ?? '').join('\t') + '\n'; });
    });
    return text;
  }
  if (ext === 'pptx') {
    const AdmZip = require('adm-zip');
    const { XMLParser } = require('fast-xml-parser');
    const parser = new XMLParser({ ignoreAttributes: true, processEntities: false });
    const collect = value => {
      if (typeof value === 'string' || typeof value === 'number') return String(value);
      if (Array.isArray(value)) return value.map(collect).filter(Boolean).join('\n');
      if (!value || typeof value !== 'object') return '';
      return Object.entries(value).map(([key, v]) => key === 'a:t' ? collect(v) : typeof v === 'object' ? collect(v) : '').filter(Boolean).join('\n');
    };
    return new AdmZip(buffer).getEntries().filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName)).sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true })).slice(0, 100).map((e, i) => `Slide ${i + 1}\n${collect(parser.parse(e.getData().toString('utf8')))}`).join('\n\n');
  }
  return '';
}
function send(value) { if (process.send) process.send(value, () => process.exit(0)); else process.exit(1); }
extract().then(result => send(typeof result === 'string' ? { text: result.replace(/\u0000/g, '').slice(0, 100000) } : result)).catch(() => send({ error: workerData.mode === 'preview' ? 'This PDF page could not be rendered. Download the original to open it in a PDF reader.' : 'Text could not be extracted. The original file is still available.' }));
