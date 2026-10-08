import { readFile } from "node:fs/promises";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "binary");

export function inspectWal(wal) {
  if (wal.length < 32) throw new Error("WAL truncado antes do cabecalho");
  const magic = wal.readUInt32BE(0);
  if (![0x377f0682, 0x377f0683].includes(magic)) throw new Error("magic WAL invalido");
  const pageSize = wal.readUInt32BE(8);
  const frameSize = pageSize + 24;
  const frameCount = Math.floor((wal.length - 32) / frameSize);
  const littleEndianWords = magic === 0x377f0682;
  const checksum = (parts, seed) => {
    let [sum1, sum2] = seed;
    for (const part of parts) {
      for (let offset = 0; offset < part.length; offset += 8) {
        const word1 = littleEndianWords ? part.readUInt32LE(offset) : part.readUInt32BE(offset);
        const word2 = littleEndianWords ? part.readUInt32LE(offset + 4) : part.readUInt32BE(offset + 4);
        sum1 = (sum1 + word1 + sum2) >>> 0;
        sum2 = (sum2 + word2 + sum1) >>> 0;
      }
    }
    return [sum1, sum2];
  };
  const storedHeader = [wal.readUInt32BE(24), wal.readUInt32BE(28)];
  const calculatedHeader = checksum([wal.subarray(0, 24)], [0, 0]);
  const salt = [wal.readUInt32BE(16), wal.readUInt32BE(20)];
  let seed = storedHeader;
  let validFrames = 0;
  let firstInvalidFrame = null;
  let lastValidCommit = null;
  let finalCommit = null;
  let commitCount = 0;
  for (let index = 0; index < frameCount; index += 1) {
    const offset = 32 + index * frameSize;
    const frameSalt = [wal.readUInt32BE(offset + 8), wal.readUInt32BE(offset + 12)];
    const stored = [wal.readUInt32BE(offset + 16), wal.readUInt32BE(offset + 20)];
    const calculated = checksum([
      wal.subarray(offset, offset + 8),
      wal.subarray(offset + 24, offset + 24 + pageSize)
    ], seed);
    const valid = frameSalt[0] === salt[0]
      && frameSalt[1] === salt[1]
      && stored[0] === calculated[0]
      && stored[1] === calculated[1];
    const frame = index + 1;
    const page = wal.readUInt32BE(offset);
    const dbSize = wal.readUInt32BE(offset + 4);
    if (firstInvalidFrame === null && valid) validFrames = frame;
    else if (firstInvalidFrame === null) firstInvalidFrame = { frame, page, dbSize, saltValid: frameSalt[0] === salt[0] && frameSalt[1] === salt[1] };
    if (dbSize) {
      commitCount += 1;
      finalCommit = { frame, page, dbSize, checksumValidThroughFrame: firstInvalidFrame === null && valid };
      if (firstInvalidFrame === null && valid) lastValidCommit = finalCommit;
    }
    seed = stored;
  }
  return {
    magic: `0x${magic.toString(16)}`,
    pageSize,
    frameCount,
    headerValid: calculatedHeader[0] === storedHeader[0] && calculatedHeader[1] === storedHeader[1],
    validFrames,
    firstInvalidFrame,
    lastValidCommit,
    finalCommit,
    commitCount
  };
}

export function overlayLastValidWalCommit(database, wal) {
  const inspection = inspectWal(wal);
  const commit = inspection.lastValidCommit;
  if (!inspection.headerValid || !commit) return { buffer: Buffer.from(database), inspection, appliedFrames: 0 };
  const target = Buffer.alloc(commit.dbSize * inspection.pageSize);
  database.copy(target, 0, 0, Math.min(database.length, target.length));
  const frameSize = inspection.pageSize + 24;
  for (let index = 0; index < commit.frame; index += 1) {
    const offset = 32 + index * frameSize;
    const pageNumber = wal.readUInt32BE(offset);
    if (pageNumber < 1 || pageNumber > commit.dbSize) continue;
    wal.copy(target, (pageNumber - 1) * inspection.pageSize, offset + 24, offset + 24 + inspection.pageSize);
  }
  return { buffer: target, inspection, appliedFrames: commit.frame };
}

function readVarint(buffer, start, limit = buffer.length) {
  let value = 0n;
  let offset = start;
  for (let index = 0; index < 9; index += 1) {
    if (offset >= limit) throw new Error(`varint truncado em ${start}`);
    const byte = buffer[offset];
    offset += 1;
    if (index === 8) {
      value = (value << 8n) | BigInt(byte);
      return { value, bytes: offset - start };
    }
    value = (value << 7n) | BigInt(byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, bytes: offset - start };
  }
  throw new Error(`varint invalido em ${start}`);
}

function numericValue(value) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(value)
    : value.toString();
}

function readSignedInteger(buffer, offset, bytes) {
  let value = 0n;
  for (let index = 0; index < bytes; index += 1) value = (value << 8n) | BigInt(buffer[offset + index]);
  const bits = BigInt(bytes * 8);
  if ((value & (1n << (bits - 1n))) !== 0n) value -= 1n << bits;
  return numericValue(value);
}

function serialLength(serialType) {
  if (serialType >= 12) return Math.floor((serialType - (serialType % 2 === 0 ? 12 : 13)) / 2);
  return [0, 1, 2, 3, 4, 6, 8, 8, 0, 0, 0, 0][serialType] ?? 0;
}

function decodeSerial(buffer, offset, serialType) {
  if (serialType === 0) return { value: null, bytes: 0 };
  if (serialType >= 1 && serialType <= 6) {
    const bytes = serialLength(serialType);
    return { value: readSignedInteger(buffer, offset, bytes), bytes };
  }
  if (serialType === 7) return { value: buffer.readDoubleBE(offset), bytes: 8 };
  if (serialType === 8) return { value: 0, bytes: 0 };
  if (serialType === 9) return { value: 1, bytes: 0 };
  if (serialType === 10 || serialType === 11) return { value: null, bytes: 0 };
  const bytes = serialLength(serialType);
  const slice = buffer.subarray(offset, offset + bytes);
  return {
    value: serialType % 2 === 0 ? Buffer.from(slice) : slice.toString("utf8"),
    bytes
  };
}

function decodeRecord(payload) {
  const headerSizeValue = readVarint(payload, 0);
  const headerSize = Number(headerSizeValue.value);
  if (headerSize < headerSizeValue.bytes || headerSize > payload.length) throw new Error("cabecalho de registro invalido");
  const serialTypes = [];
  let headerOffset = headerSizeValue.bytes;
  while (headerOffset < headerSize) {
    const serial = readVarint(payload, headerOffset, headerSize);
    serialTypes.push(Number(serial.value));
    headerOffset += serial.bytes;
  }
  const values = [];
  let dataOffset = headerSize;
  for (const serialType of serialTypes) {
    const decoded = decodeSerial(payload, dataOffset, serialType);
    if (dataOffset + decoded.bytes > payload.length) throw new Error("payload de registro truncado");
    values.push(decoded.value);
    dataOffset += decoded.bytes;
  }
  return values;
}

export class RawSqliteReader {
  constructor(buffer, { source = "buffer" } = {}) {
    if (!buffer.subarray(0, 16).equals(SQLITE_HEADER)) throw new Error(`${source}: cabecalho SQLite ausente`);
    this.buffer = buffer;
    this.source = source;
    this.pageSize = buffer.readUInt16BE(16) || 65536;
    this.reservedBytes = buffer[20];
    this.usableSize = this.pageSize - this.reservedBytes;
    this.physicalPageCount = Math.floor(buffer.length / this.pageSize);
    this.declaredPageCount = buffer.readUInt32BE(28);
  }

  static async open(filePath) {
    return new RawSqliteReader(await readFile(filePath), { source: filePath });
  }

  static async openWithWal(filePath, walPath) {
    const database = await readFile(filePath);
    const wal = await readFile(walPath);
    const overlay = overlayLastValidWalCommit(database, wal);
    const reader = new RawSqliteReader(overlay.buffer, { source: `${filePath} + WAL valid prefix` });
    reader.walRecovery = { inspection: overlay.inspection, appliedFrames: overlay.appliedFrames };
    return reader;
  }

  page(pageNumber) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.physicalPageCount) {
      throw new Error(`pagina fora do arquivo: ${pageNumber}`);
    }
    const start = (pageNumber - 1) * this.pageSize;
    return this.buffer.subarray(start, start + this.pageSize);
  }

  readOverflow(firstPage, expectedBytes) {
    const chunks = [];
    const visited = new Set();
    let pageNumber = firstPage;
    let remaining = expectedBytes;
    while (pageNumber && remaining > 0) {
      if (visited.has(pageNumber)) throw new Error(`ciclo de overflow na pagina ${pageNumber}`);
      visited.add(pageNumber);
      const page = this.page(pageNumber);
      const nextPage = page.readUInt32BE(0);
      const length = Math.min(remaining, this.usableSize - 4);
      chunks.push(page.subarray(4, 4 + length));
      remaining -= length;
      pageNumber = nextPage;
    }
    if (remaining > 0) throw new Error(`overflow truncado: faltam ${remaining} bytes`);
    return Buffer.concat(chunks);
  }

  localPayloadSize(payloadSize) {
    const maxLocal = this.usableSize - 35;
    if (payloadSize <= maxLocal) return payloadSize;
    const minLocal = Math.floor(((this.usableSize - 12) * 32) / 255) - 23;
    const candidate = minLocal + ((payloadSize - minLocal) % (this.usableSize - 4));
    return candidate <= maxLocal ? candidate : minLocal;
  }

  readTableLeafCell(page, cellOffset) {
    const payloadSizeVarint = readVarint(page, cellOffset, this.usableSize);
    const payloadSize = Number(payloadSizeVarint.value);
    let offset = cellOffset + payloadSizeVarint.bytes;
    const rowidVarint = readVarint(page, offset, this.usableSize);
    offset += rowidVarint.bytes;
    const localSize = this.localPayloadSize(payloadSize);
    if (offset + localSize > this.usableSize) throw new Error("payload local fora da pagina");
    const chunks = [page.subarray(offset, offset + localSize)];
    if (localSize < payloadSize) {
      const overflowPointerOffset = offset + localSize;
      if (overflowPointerOffset + 4 > this.usableSize) throw new Error("ponteiro de overflow truncado");
      chunks.push(this.readOverflow(page.readUInt32BE(overflowPointerOffset), payloadSize - localSize));
    }
    const payload = Buffer.concat(chunks, payloadSize);
    return { rowid: numericValue(rowidVarint.value), values: decodeRecord(payload) };
  }

  readTable(rootPage, { tolerateCorruption = true } = {}) {
    const rows = [];
    const errors = [];
    const visited = new Set();
    const visit = (pageNumber) => {
      if (visited.has(pageNumber)) {
        errors.push({ page: pageNumber, reason: "BTREE_CYCLE" });
        return;
      }
      visited.add(pageNumber);
      let page;
      try {
        page = this.page(pageNumber);
        const headerOffset = pageNumber === 1 ? 100 : 0;
        const pageType = page[headerOffset];
        const cellCount = page.readUInt16BE(headerOffset + 3);
        const headerSize = pageType === 0x05 ? 12 : 8;
        if (pageType !== 0x05 && pageType !== 0x0d) throw new Error(`tipo de pagina ${pageType}`);
        if (headerOffset + headerSize + cellCount * 2 > this.usableSize) throw new Error("array de celulas truncado");
        for (let index = 0; index < cellCount; index += 1) {
          const cellOffset = page.readUInt16BE(headerOffset + headerSize + index * 2);
          try {
            if (cellOffset < headerOffset + headerSize || cellOffset >= this.usableSize) throw new Error(`offset de celula ${cellOffset}`);
            if (pageType === 0x05) visit(page.readUInt32BE(cellOffset));
            else rows.push(this.readTableLeafCell(page, cellOffset));
          } catch (error) {
            errors.push({ page: pageNumber, cell: index, reason: error.message });
            if (!tolerateCorruption) throw error;
          }
        }
        if (pageType === 0x05) visit(page.readUInt32BE(headerOffset + 8));
      } catch (error) {
        errors.push({ page: pageNumber, reason: error.message });
        if (!tolerateCorruption) throw error;
      }
    };
    visit(rootPage);
    return { rows, errors, visitedPages: [...visited] };
  }

  readSchema() {
    const result = this.readTable(1);
    return {
      ...result,
      entries: result.rows
        .filter((row) => row.values.length >= 5)
        .map((row) => ({
          rowid: row.rowid,
          type: row.values[0],
          name: row.values[1],
          tableName: row.values[2],
          rootPage: row.values[3],
          sql: row.values[4]
        }))
    };
  }
}
