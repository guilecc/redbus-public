import fs from 'fs';
import path from 'path';
import tesseract from 'tesseract.js';
const { PDFParse } = require('pdf-parse');
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';

export async function readLocalFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  try {
    switch (ext) {
      case '.txt':
      case '.md':
      case '.csv':
        return fs.readFileSync(filePath, 'utf8');
      
      case '.json':
        // Read JSON and format it nicely
        const jsonContent = fs.readFileSync(filePath, 'utf8');
        try {
          return JSON.stringify(JSON.parse(jsonContent), null, 2);
        } catch {
          return jsonContent; // Return as text if not valid JSON
        }
      
      case '.pdf': {
        const pdfBuffer = fs.readFileSync(filePath);
        const parser = new PDFParse({ data: pdfBuffer });
        const pdfData = await parser.getText();
        await parser.destroy();
        return pdfData.text;
      }
      
      case '.docx':
        const docxBuffer = fs.readFileSync(filePath);
        const docxData = await mammoth.extractRawText({ buffer: docxBuffer });
        return docxData.value;
      
      case '.xlsx':
      case '.xls':
        const workbook = xlsx.readFile(filePath);
        let sheetText = '';
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          sheetText += `\n--- Sheet: ${sheetName} ---\n`;
          sheetText += xlsx.utils.sheet_to_csv(sheet);
        }
        return sheetText.trim();
      
      case '.png':
      case '.jpg':
      case '.jpeg':
        const imgBuffer = fs.readFileSync(filePath);
        const { data: { text } } = await tesseract.recognize(imgBuffer, 'eng+por', {
          logger: () => {} // disable logs
        });
        return text;
      
      default:
        // Attempt to read as UTF-8 fallback
        return fs.readFileSync(filePath, 'utf8');
    }
  } catch (error) {
    throw new Error(`Error reading file ${path.basename(filePath)}: ${String(error)}`);
  }
}
