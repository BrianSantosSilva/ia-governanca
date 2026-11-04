export interface CsvParsedRow {
  lineNumber: number;
  data: Record<string, string>;
  raw: string[];
}

export interface CsvParseResult {
  headers: string[];
  rows: CsvParsedRow[];
  totalLines: number;
}

/**
 * Divide o conteúdo CSV em tokens/linhas considerando aspas RFC 4180 e vírgulas.
 */
export function parseCsvString(csvContent: string): CsvParseResult {
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  const content = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // pular aspa duplicada
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (char === '\n' && !insideQuotes) {
      currentRow.push(currentField.trim());
      // Apenas adicionar se a linha não for totalmente vazia
      if (currentRow.some((f) => f.length > 0)) {
        lines.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  // Último campo/linha se arquivo não terminar com quebra de linha
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f.length > 0)) {
      lines.push(currentRow);
    }
  }

  if (lines.length === 0) {
    return { headers: [], rows: [], totalLines: 0 };
  }

  const rawHeaders = lines[0] ?? [];
  const headers = rawHeaders.map((h) => h.toLowerCase().trim().replace(/[\s-]+/g, '_'));

  const rows: CsvParsedRow[] = [];
  for (let idx = 1; idx < lines.length; idx++) {
    const rowValues = lines[idx] ?? [];
    const data: Record<string, string> = {};

    headers.forEach((header, colIdx) => {
      data[header] = rowValues[colIdx] ?? '';
    });

    rows.push({
      lineNumber: idx + 1, // 1-indexado considerando que a linha 1 é o cabeçalho
      data,
      raw: rowValues,
    });
  }

  return {
    headers,
    rows,
    totalLines: lines.length,
  };
}
