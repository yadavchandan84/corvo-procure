import { extractText, getDocumentProxy } from 'unpdf';

/** Extract plain text from a PDF (serverless-safe, no native deps). */
export async function pdfToText(data: ArrayBuffer | Uint8Array): Promise<string> {
  // pdf.js rejects Node Buffers, so always copy into a plain Uint8Array
  const bytes = data instanceof Uint8Array ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) : new Uint8Array(data);
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join('\n\n');
}

/** Text from an uploaded document: PDF, plain text, Markdown, CSV or JSON. */
export async function documentToText(fileName: string, data: ArrayBuffer): Promise<string> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return pdfToText(data);
  if (lower.endsWith('.docx')) {
    throw new Error('Word documents are not supported; please upload the amendment as PDF or text, or paste its text.');
  }
  return new TextDecoder('utf-8').decode(data);
}
