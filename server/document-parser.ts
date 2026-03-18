import officeParser from 'officeparser';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';
import JSZip from 'jszip';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// pdf-parse v2: 클래스 기반 API (PDFParse)
let PDFParseClass: (new (options: { data: Uint8Array }) => any) | null = null;

export interface ParsedDocument {
  text: string;
  pageCount: number;
  hasOcr: boolean;
  metadata?: Record<string, any>;
}

export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
}

const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  chunkSize: 500,
  chunkOverlap: 50,
};

export async function parseDocument(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<ParsedDocument> {
  const ext = path.extname(fileName).toLowerCase();
  
  try {
    switch (ext) {
      case '.pdf':
        return await parsePdf(buffer);
      case '.doc':
      case '.docx':
        return await parseWord(buffer);
      case '.ppt':
      case '.pptx':
        return await parsePowerPoint(buffer);
      default:
        throw new Error(`지원하지 않는 파일 형식입니다: ${ext}`);
    }
  } catch (error) {
    console.error('Document parsing error:', error);
    throw error;
  }
}

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  let pageCount = 1;

  try {
    // pdf-parse v2 클래스 기반 API
    if (!PDFParseClass) {
      const module = await import('pdf-parse');
      PDFParseClass = (module as any).PDFParse || (module as any).default?.PDFParse;
    }
    const parser = new PDFParseClass!({ data: new Uint8Array(buffer) });
    try {
      const textResult = await parser.getText();
      const text = textResult.text || '';
      pageCount = textResult.total || 1;

      // If we got meaningful text (more than 100 chars), use it
      if (text.trim().length > 100) {
        return {
          text: cleanText(text),
          pageCount,
          hasOcr: false,
          metadata: {
            pages: textResult.total,
          },
        };
      }

      // Text too short - likely image-based PDF, try OCR
      console.log('PDF appears to be image-based, attempting OCR...');
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    console.log('PDF text extraction failed, attempting OCR...', error);
  }
  
  // Try OCR for image-based PDF
  try {
    const ocrResult = await performOcrOnPdf(buffer, pageCount);
    if (ocrResult.text.trim().length > 0) {
      return {
        text: cleanText(ocrResult.text),
        pageCount: ocrResult.pageCount,
        hasOcr: true,
      };
    }
    throw new Error('OCR에서 텍스트를 추출할 수 없습니다.');
  } catch (ocrError) {
    console.error('OCR failed:', ocrError);
    throw new Error('PDF 파싱에 실패했습니다. 텍스트 추출과 OCR 모두 실패했습니다.');
  }
}

// Convert PDF to images using pdftoppm, then OCR each page
async function performOcrOnPdf(buffer: Buffer, estimatedPages: number): Promise<{ text: string; pageCount: number }> {
  const tempDir = `/tmp/ocr_${Date.now()}`;
  const pdfPath = path.join(tempDir, 'input.pdf');
  
  try {
    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(pdfPath, buffer);
    
    // Convert PDF to PNG images using pdftoppm
    const outputPrefix = path.join(tempDir, 'page');
    await execAsync(`pdftoppm -png -r 150 "${pdfPath}" "${outputPrefix}"`, { timeout: 60000 });
    
    // Find all generated image files
    const files = fs.readdirSync(tempDir).filter(f => f.startsWith('page') && f.endsWith('.png'));
    files.sort(); // Ensure pages are in order
    
    if (files.length === 0) {
      throw new Error('PDF를 이미지로 변환할 수 없습니다.');
    }
    
    // Create Tesseract worker for Korean + English
    const worker = await Tesseract.createWorker('kor+eng');
    
    try {
      const textParts: string[] = [];
      
      // OCR each page (limit to first 20 pages for performance)
      const pagesToProcess = files.slice(0, 20);
      for (const file of pagesToProcess) {
        const imagePath = path.join(tempDir, file);
        const result = await worker.recognize(imagePath);
        if (result.data.text.trim()) {
          textParts.push(result.data.text);
        }
      }
      
      return {
        text: textParts.join('\n\n'),
        pageCount: files.length,
      };
    } finally {
      await worker.terminate();
    }
  } finally {
    // Cleanup temp files
    try {
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
          fs.unlinkSync(path.join(tempDir, file));
        }
        fs.rmdirSync(tempDir);
      }
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    }
  }
}

async function parseWord(buffer: Buffer): Promise<ParsedDocument> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value || '';
    
    const paragraphs = text.split(/\n\n+/);
    const estimatedPages = Math.ceil(paragraphs.length / 20);
    
    return {
      text: cleanText(text),
      pageCount: estimatedPages,
      hasOcr: false,
    };
  } catch (error) {
    console.error('Word parsing error:', error);
    try {
      const result = await officeParser.parseOffice(buffer);
      const text = typeof result === 'string' ? result : (result as any).toString?.() || '';
      return {
        text: cleanText(text),
        pageCount: 1,
        hasOcr: false,
      };
    } catch (fallbackError) {
      throw new Error('Word 문서 파싱에 실패했습니다.');
    }
  }
}

// JSZip 기반 PPTX 파서: 슬라이드별 텍스트 + 발표자 노트 추출
async function parsePptxWithJszip(buffer: Buffer): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(buffer);

  // 슬라이드 파일 목록 수집 및 정렬
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/i)?.[1] || '0');
      const numB = parseInt(b.match(/slide(\d+)/i)?.[1] || '0');
      return numA - numB;
    });

  if (slideFiles.length === 0) {
    throw new Error('PPTX에서 슬라이드를 찾을 수 없습니다');
  }

  // 노트 파일 매핑
  const notesFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(f));

  const extractTextFromXml = (xml: string): string => {
    // <a:t> 태그에서 텍스트만 추출
    const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
    const text = matches
      .map(m => m.replace(/<\/?a:t[^>]*>/g, ''))
      .filter(t => t.trim().length > 0)
      .join(' ')
      .trim();
    // 혹시 남은 XML 태그 완전 제거
    return text.replace(/<[^>]+>/g, '').trim();
  };

  const textParts: string[] = [];

  for (let i = 0; i < slideFiles.length; i++) {
    const slideXml = await zip.files[slideFiles[i]].async('text');
    const slideText = extractTextFromXml(slideXml);

    let noteText = '';
    const noteFile = `ppt/notesSlides/notesSlide${i + 1}.xml`;
    if (zip.files[noteFile]) {
      const noteXml = await zip.files[noteFile].async('text');
      noteText = extractTextFromXml(noteXml);
    }

    let slideContent = `[슬라이드 ${i + 1}]\n${slideText}`;
    if (noteText) {
      slideContent += `\n[노트] ${noteText}`;
    }
    textParts.push(slideContent);
  }

  const fullText = textParts.join('\n\n');
  return {
    text: cleanText(fullText),
    pageCount: slideFiles.length,
    hasOcr: false,
  };
}

// officeparser 폴백 (구형 .ppt 또는 jszip 실패 시)
async function parsePptxWithOfficeparser(buffer: Buffer): Promise<ParsedDocument> {
  const result = await officeParser.parseOffice(buffer);
  const text = typeof result === 'string' ? result : (result as any).toString?.() || '';
  const slides = text.split(/\n{3,}/).filter((s: string) => s.trim());
  return {
    text: cleanText(text),
    pageCount: slides.length || 1,
    hasOcr: false,
  };
}

async function parsePowerPoint(buffer: Buffer): Promise<ParsedDocument> {
  // jszip 기반 파서 시도 → 실패 시 officeparser 폴백
  try {
    return await parsePptxWithJszip(buffer);
  } catch (jszipError) {
    console.log('JSZip PPTX 파싱 실패, officeparser 폴백:', jszipError);
    try {
      return await parsePptxWithOfficeparser(buffer);
    } catch (fallbackError) {
      console.error('PowerPoint 파싱 완전 실패:', fallbackError);
      throw new Error('PowerPoint 파싱에 실패했습니다.');
    }
  }
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')  // XML/HTML 태그 제거
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ +/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkText(
  text: string,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS
): string[] {
  const { chunkSize, chunkOverlap } = options;
  
  const sentences = text.split(/(?<=[.!?。！？])\s+/);
  const chunks: string[] = [];
  let currentChunk = '';
  let currentLength = 0;
  
  for (const sentence of sentences) {
    const sentenceLength = sentence.length;
    
    if (currentLength + sentenceLength > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());
      
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.ceil(chunkOverlap / 5));
      currentChunk = overlapWords.join(' ') + ' ' + sentence;
      currentLength = currentChunk.length;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
      currentLength += sentenceLength + 1;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  if (chunks.length === 0 && text.trim()) {
    const words = text.split(/\s+/);
    let chunk = '';
    for (const word of words) {
      if (chunk.length + word.length + 1 > chunkSize) {
        if (chunk) chunks.push(chunk);
        chunk = word;
      } else {
        chunk += (chunk ? ' ' : '') + word;
      }
    }
    if (chunk) chunks.push(chunk);
  }
  
  return chunks;
}

export function getFileType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const typeMap: Record<string, string> = {
    '.pdf': 'pdf',
    '.doc': 'doc',
    '.docx': 'docx',
    '.ppt': 'ppt',
    '.pptx': 'pptx',
  };
  return typeMap[ext] || 'unknown';
}

export function isValidFileType(fileName: string): boolean {
  const validTypes = ['.pdf', '.doc', '.docx', '.ppt', '.pptx'];
  const ext = path.extname(fileName).toLowerCase();
  return validTypes.includes(ext);
}
