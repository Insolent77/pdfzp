// Retain the supplied template with its visible content and styles, removing Google round-trip metadata.
import fs from 'node:fs';
import PizZip from 'pizzip';
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw Error('Usage: node scripts/retain-template.mjs input.docx output.docx');
const zip = new PizZip(fs.readFileSync(input));
for (const file of Object.keys(zip.files))
  if (file.startsWith('customXML/') || file.startsWith('docProps/')) zip.remove(file);
for (const file of ['word/_rels/document.xml.rels', '_rels/.rels']) {
  const text = zip.file(file)?.asText();
  if (text)
    zip.file(
      file,
      text.replace(
        /<Relationship\b[^>]*(?:customXml|metadata\/core-properties|extended-properties)[^>]*\/>/g,
        '',
      ),
    );
}
const content = zip.file('[Content_Types].xml').asText();
zip.file(
  '[Content_Types].xml',
  content.replace(/<Override\b[^>]*(?:customXML|docProps)[^>]*\/>/g, ''),
);
fs.mkdirSync(new URL('../templates/', import.meta.url), { recursive: true });
fs.writeFileSync(output, zip.generate({ type: 'nodebuffer' }));
