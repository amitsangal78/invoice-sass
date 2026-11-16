import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../../../', import.meta.url));
const documentsDir = resolve(rootDir, process.env.LOCAL_DOCUMENTS_DIR ?? '.local/documents');

export function createMinimalPdf(title: string, details: [string, string][], items: { name: string; qty: number; amount: number }[] = []): Buffer {
  const rows = [title, '', ...details.map(([key,value])=>`${key}: ${value}`), '', ...items.map(item=>`${item.name} x ${item.qty} = INR ${item.amount.toFixed(2)}`)];
  const pages: string[][]=[];
  for(let i=0;i<rows.length;i+=45) pages.push(rows.slice(i,i+45));
  const objects: string[]=[];
  const pageIds=pages.map((_,i)=>4+i*2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for(const lines of pages){
    const stream=`BT\n/F1 11 Tf\n50 790 Td\n16 TL\n${lines.map(line=>`(${escapePdfText(line.replace(/[^\x20-\x7E]/g,'?'))}) Tj\nT*`).join('\n')}\nET\n`;
    const pageId=objects.length+1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${pageId+1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  let pdf='%PDF-1.4\n';const offsets=[0];
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function escapePdfText(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

export async function storeDocument(vendorId: string, prefix: string, buffer: Buffer, mimeType = 'application/pdf') {
  const hash = createHash('sha256').update(buffer).digest();
  const id = randomBytes(16).toString('hex');
  const objectKey = `${vendorId}/${prefix}/${id}.pdf`;
  const fullPath = resolve(documentsDir, objectKey);
  await mkdir(dirname(fullPath), { recursive: true, mode: 0o700 });
  await writeFile(fullPath, buffer, { mode: 0o600 });
  return { objectKey, byteSize: buffer.length, contentHash: hash, mimeType };
}

export async function retrieveDocument(objectKey: string): Promise<Buffer | null> {
  const fullPath = resolve(documentsDir, objectKey);
  if (!fullPath.startsWith(documentsDir+sep)) return null;
  try {
    return await readFile(fullPath);
  } catch {
    return null;
  }
}
