import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { extractText, uploadDirectory } from "../src/services/documentProcessing.js";

function createPdf(text) {
  const newline = "\r\n";
  const escapedText = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT${newline}/F1 12 Tf${newline}72 720 Td${newline}(${escapedText}) Tj${newline}ET${newline}`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>${newline}stream${newline}${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = `%PDF-1.4${newline}`;
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj${newline}${objects[index]}${newline}endobj${newline}`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref${newline}0 ${objects.length + 1}${newline}0000000000 65535 f ${newline}`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n ${newline}`;
  }
  pdf += `trailer${newline}<< /Size ${objects.length + 1} /Root 1 0 R >>${newline}startxref${newline}${xrefOffset}${newline}%%EOF`;
  return pdf;
}

test("supports a configurable persistent upload directory and preserves the local default", () => {
  const previousUploadDirectory = process.env.UPLOAD_DIR;
  try {
    delete process.env.UPLOAD_DIR;
    assert.equal(uploadDirectory(), path.resolve(process.cwd(), "uploads"));

    process.env.UPLOAD_DIR = path.join(os.tmpdir(), "rag-configured-uploads");
    assert.equal(uploadDirectory(), path.resolve(process.env.UPLOAD_DIR));
  } finally {
    if (previousUploadDirectory === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploadDirectory;
  }
});

test("extracts text from PDF, DOCX and TXT uploads", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rag-extraction-test-"));
  try {
    const pdfPath = path.join(directory, "fixture.pdf");
    const textPath = path.join(directory, "fixture.txt");
    await writeFile(pdfPath, createPdf("PDF extraction marker."));
    await writeFile(textPath, "TXT extraction marker.", "utf8");

    const docxPath = fileURLToPath(
      new URL("../../node_modules/mammoth/test/test-data/single-paragraph.docx", import.meta.url),
    );
    const pdfText = await extractText(pdfPath, ".pdf");
    const docxText = await extractText(docxPath, ".docx");
    const text = await extractText(textPath, ".txt");

    assert.match(pdfText, /PDF extraction marker/);
    assert.ok(docxText.trim().length > 0);
    assert.match(text, /TXT extraction marker/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects malformed, empty, and unextractable documents with client errors", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rag-invalid-document-test-"));
  try {
    const malformedPdf = path.join(directory, "malformed.pdf");
    const malformedDocx = path.join(directory, "malformed.docx");
    const emptyText = path.join(directory, "empty.txt");
    await writeFile(malformedPdf, "%PDF-this is not a valid PDF");
    await writeFile(malformedDocx, "not a DOCX archive");
    await writeFile(emptyText, " \r\n\t", "utf8");

    await assert.rejects(extractText(malformedPdf, ".pdf"), { status: 422 });
    await assert.rejects(extractText(malformedDocx, ".docx"), { status: 422 });
    await assert.rejects(extractText(emptyText, ".txt"), { status: 422 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
