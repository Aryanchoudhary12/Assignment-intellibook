import {randomUUID} from "node:crypto";
import {PrismaClient} from "@prisma/client";

const globalKey = Symbol.for("clausebook.prisma");
const db = globalThis[globalKey] ??= new PrismaClient();
const METADATA = {id: true, name: true, size: true, uploadedAt: true, status: true, error: true};
const FILE_PART_SIZE = 4 * 1024 * 1024;

function metadata({uploadedAt, ...row}) {
  return {...row, uploaded_at: uploadedAt};
}

async function transaction(callback) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(callback, {timeout: 30_000});
    } catch (error) {
      if (error.code !== "P2034" || attempt >= 2) throw error;
    }
  }
}

export const store = {
  async list(owner) {
    return (await db.contract.findMany({where: {owner}, orderBy: {uploadedAt: "desc"}, select: METADATA})).map(metadata);
  },

  async detail(owner, id) {
    const row = await db.contract.findFirst({
      where: {owner, id}, select: {...METADATA, findings: true},
    });
    return row ? metadata({...row, findings: row.findings ?? []}) : null;
  },

  async create(owner, name, upload) {
    const id = randomUUID();
    return transaction(async (tx) => {
      const row = await tx.contract.create({
        data: {id, owner, name, size: upload.length}, select: METADATA,
      });
      for (let start = 0; start < upload.length; start += FILE_PART_SIZE) {
        await tx.filePart.create({data: {
          owner, contractId: id, position: start / FILE_PART_SIZE,
          bytes: upload.subarray(start, start + FILE_PART_SIZE),
        }, select: {id: true}});
      }
      return metadata(row);
    });
  },

  async delete(owner, id) {
    return transaction(async (tx) => {
      if (!(await tx.contract.deleteMany({where: {owner, id}})).count) return false;
      const where = {owner, contractId: id};
      await tx.turn.deleteMany({where});
      await tx.chunk.deleteMany({where});
      await tx.clause.deleteMany({where});
      await tx.filePart.deleteMany({where});
      return true;
    });
  },

  async retry(owner, id) {
    return (await db.contract.updateMany({
      where: {id, owner, status: "failed"}, data: {status: "processing", error: null, running: false},
    })).count > 0;
  },

  async resume() {
    await db.contract.updateMany({where: {status: "processing", running: true}, data: {running: false}});
  },

  async claim() {
    // Internal queue dispatch only. Every subsequent read and write includes the row's owner.
    const job = await db.contract.findFirst({
      where: {status: "processing", running: false},
      orderBy: {uploadedAt: "asc"}, select: {owner: true, id: true, name: true, size: true},
    });
    if (!job) return null;
    const claimed = await db.contract.updateMany({
      where: {owner: job.owner, id: job.id, status: "processing", running: false},
      data: {running: true},
    });
    return claimed.count ? job : null;
  },

  async raw(owner, contractId) {
    const parts = await db.filePart.findMany({
      where: {owner, contractId}, orderBy: {position: "asc"}, select: {bytes: true},
    });
    return Buffer.concat(parts.map(({bytes}) => bytes));
  },

  async finish(owner, contractId, clauses, chunks, findings, embeddingModel) {
    await transaction(async (tx) => {
      const updated = await tx.contract.updateMany({
        where: {owner, id: contractId, status: "processing", running: true},
        data: {status: "reviewed", running: false, findings, embeddingModel},
      });
      if (!updated.count) return;
      await tx.clause.createMany({data: clauses.map(({id: ordinal, title, parts}) => ({
        owner, contractId, ordinal, title, parts,
      }))});
      await tx.chunk.createMany({data: chunks.map(({id: ordinal, clauseId, location, text, vector}) => ({
        owner, contractId, ordinal, clauseId, location, text,
        vector: Buffer.from(Float32Array.from(vector).buffer),
      }))});
    });
  },

  async fail(owner, id, error) {
    await db.contract.updateMany({
      where: {owner, id, status: "processing", running: true},
      data: {status: "failed", running: false, error},
    });
  },

  async clause(owner, contractId, ordinal) {
    return db.clause.findFirst({where: {owner, contractId, ordinal}, select: {title: true, parts: true}});
  },

  async searchCorpus(owner, contractId) {
    const contract = await db.contract.findFirst({
      where: {owner, id: contractId, status: "reviewed"}, select: {embeddingModel: true},
    });
    if (!contract) return null;
    const rows = await db.chunk.findMany({
      where: {owner, contractId}, orderBy: {ordinal: "asc"},
      select: {ordinal: true, clauseId: true, location: true, text: true, vector: true},
    });
    return {
      model: contract.embeddingModel,
      chunks: rows.map(({ordinal, vector, ...chunk}) => ({
        ...chunk, id: ordinal,
        vector: new Float32Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength)),
      })),
    };
  },

  async history(owner, contractId, take) {
    const rows = await db.turn.findMany({
      where: {owner, contractId}, orderBy: [{createdAt: "desc"}, {id: "desc"}], take,
      select: {question: true, answer: true},
    });
    return rows.reverse();
  },

  async saveTurn(owner, contractId, question, answer) {
    return transaction(async (tx) => {
      const updated = await tx.contract.updateMany({
        where: {owner, id: contractId, status: "reviewed"}, data: {chatRevision: {increment: 1}},
      });
      if (!updated.count) return false;
      await tx.turn.create({data: {owner, contractId, question, answer}, select: {id: true}});
      return true;
    });
  },
};
