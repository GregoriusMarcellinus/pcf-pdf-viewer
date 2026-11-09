const fs = require('fs');
const path = require('path');

// Generates a valid, multi-line test PDF with Helvetica text
function generateSamplePdf() {
  const contentStream = 
`BT
/F1 26 Tf
50 720 Td
(Power Apps PCF - PDF Viewer) Tj
0 -36 Td
/F1 16 Tf
(Mozilla pdf.js Open Source Integration) Tj
0 -28 Td
/F1 13 Tf
(Test Document: Verified Base64 Decoding Pipeline) Tj
0 -22 Td
(Features Verified:) Tj
0 -18 Td
(- Raw base64 and data URI handling) Tj
0 -18 Td
(- Surrounding quotes from Power Fx JSON(...)) Tj
0 -18 Td
(- Responsive zoom, page navigation, and download) Tj
0 -18 Td
(- Blob URL Web Worker with main-thread fallback) Tj
0 -36 Td
/F1 12 Tf
(Generated for Antigravity PCF Test Harness) Tj
ET`;

  const streamLength = Buffer.byteLength(contentStream, 'utf8');

  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const obj3 = 
`3 0 obj
<<
  /Type /Page
  /Parent 2 0 R
  /MediaBox [0 0 612 792]
  /Resources <<
    /Font <<
      /F1 <<
        /Type /Font
        /Subtype /Type1
        /BaseFont /Helvetica
      >>
    >>
  >>
  /Contents 4 0 R
>>
endobj
`;
  const obj4 = `4 0 obj\n<< /Length ${streamLength} >>\nstream\n${contentStream}\nendstream\nendobj\n`;

  const header = '%PDF-1.4\n';
  const offset1 = Buffer.byteLength(header, 'utf8');
  const offset2 = offset1 + Buffer.byteLength(obj1, 'utf8');
  const offset3 = offset2 + Buffer.byteLength(obj2, 'utf8');
  const offset4 = offset3 + Buffer.byteLength(obj3, 'utf8');
  const xrefOffset = offset4 + Buffer.byteLength(obj4, 'utf8');

  function pad(num) {
    return String(num).padStart(10, '0');
  }

  const xref = 
`xref
0 5
0000000000 65535 f \r
${pad(offset1)} 00000 n \r
${pad(offset2)} 00000 n \r
${pad(offset3)} 00000 n \r
${pad(offset4)} 00000 n \r
trailer
<<
  /Size 5
  /Root 1 0 R
>>
startxref
${xrefOffset}
%%EOF
`;

  return header + obj1 + obj2 + obj3 + obj4 + xref;
}

const pdfContent = generateSamplePdf();
const pdfBuffer = Buffer.from(pdfContent, 'utf8');
const rawBase64 = pdfBuffer.toString('base64');
const dataUri = `data:application/pdf;base64,${rawBase64}`;
const quotedDataUri = `"${dataUri}"`;

const rootDir = path.resolve(__dirname, '..');
const sampleFilePath = path.join(rootDir, 'sample-base64.txt');

const outputDoc = `=============================================================================
SAMPLE BASE64 PDF TEST FIXTURES FOR PCF TEST HARNESS
=============================================================================

1. Raw Base64 (copy and paste into 'PdfSource' input):
-----------------------------------------------------------------------------
${rawBase64}

2. Data URI (starts with data:application/pdf;base64,...):
-----------------------------------------------------------------------------
${dataUri}

3. Quoted Data URI (Power Fx JSON(Attachment, JSONFormat.IncludeBinaryData)):
-----------------------------------------------------------------------------
${quotedDataUri}
`;

fs.writeFileSync(sampleFilePath, outputDoc, 'utf8');
console.log(`[generate-sample-pdf] Created sample fixture at: ${sampleFilePath}`);
