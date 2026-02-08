import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  timestamp,
  boolean,
  varchar,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";

// Import chat models from the integration
export * from "./models/chat";

// === USERS (Restored) ===
export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// === SAMPLE BUSINESS DATA FOR SQL CHATBOT ===

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  price: numeric("price").notNull(),
  stock: integer("stock").notNull(),
  description: text("description"),
});

export const sales = pgTable("sales", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").references(() => products.id),
  quantity: integer("quantity").notNull(),
  totalPrice: numeric("total_price").notNull(),
  saleDate: timestamp("sale_date").defaultNow(),
});

export const productsRelations = relations(products, ({ many }) => ({
  sales: many(sales),
}));

export const salesRelations = relations(sales, ({ one }) => ({
  product: one(products, {
    fields: [sales.productId],
    references: [products.id],
  }),
}));

// === SCHEMAS ===

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
});
export const insertSaleSchema = createInsertSchema(sales).omit({
  id: true,
  saleDate: true,
});

export type Product = typeof products.$inferSelect;
export type Sale = typeof sales.$inferSelect;

// === DATASETS (CSV Upload with Structured/Unstructured Support) ===

export const datasets = pgTable("datasets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  fileName: text("file_name").notNull(),
  dataType: text("data_type").notNull(), // 'structured' or 'unstructured'
  rowCount: integer("row_count").notNull().default(0),
  columnInfo: text("column_info"), // JSON string of column metadata for structured data
  description: text("description"), // JSON string of column metadata
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// [정형 데이터 테이블]
// SQL 분석용: 컬럼 구조가 있는 데이터를 JSONB로 저장하여 쿼리 가능하게 함
export const structuredData = pgTable(
  "structured_data",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id").references(() => datasets.id, {
      onDelete: "cascade",
    }),
    rowIndex: integer("row_index").notNull(),
    data: jsonb("data").notNull(), // JSONB for efficient querying
  },
  (table) => ({
    datasetIdIdx: index("structured_data_dataset_id_idx").on(table.datasetId),
  }),
);

// [비정형 데이터 테이블]
// 검색/RAG용: 텍스트 원문(rawContent)과 검색용 텍스트(searchText)를 분리하여 저장
export const unstructuredData = pgTable(
  "unstructured_data",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id").references(() => datasets.id, {
      onDelete: "cascade",
    }),
    rowIndex: integer("row_index").notNull(),
    rawContent: text("raw_content"), // Original text content
    metadata: jsonb("metadata"), // JSONB for metadata
    searchText: text("search_text"), // Normalized text for search
  },
  (table) => ({
    datasetIdIdx: index("unstructured_data_dataset_id_idx").on(table.datasetId),
  }),
);

export const datasetsRelations = relations(datasets, ({ many }) => ({
  structuredRows: many(structuredData),
  unstructuredRows: many(unstructuredData),
}));

export const structuredDataRelations = relations(structuredData, ({ one }) => ({
  dataset: one(datasets, {
    fields: [structuredData.datasetId],
    references: [datasets.id],
  }),
}));

export const unstructuredDataRelations = relations(
  unstructuredData,
  ({ one }) => ({
    dataset: one(datasets, {
      fields: [unstructuredData.datasetId],
      references: [datasets.id],
    }),
  }),
);

export const insertDatasetSchema = createInsertSchema(datasets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertStructuredDataSchema = createInsertSchema(
  structuredData,
).omit({ id: true });
export const insertUnstructuredDataSchema = createInsertSchema(
  unstructuredData,
).omit({ id: true });

export type Dataset = typeof datasets.$inferSelect;
export type InsertDataset = z.infer<typeof insertDatasetSchema>;
export type StructuredDataRow = typeof structuredData.$inferSelect;
export type UnstructuredDataRow = typeof unstructuredData.$inferSelect;

// === API TYPES ===

export interface SqlChatRequest {
  message: string;
}

export interface SqlChatResponse {
  answer: string;
  sql: string;
  data: any[];
  error?: string;
}

export interface DatasetUploadRequest {
  name: string;
  dataType: "structured" | "unstructured";
  description?: string;
}

export interface ColumnInfo {
  name: string;
  type: "text" | "number" | "date" | "boolean";
  nullable: boolean;
  sampleValues: string[];
}

// === KNOWLEDGE BASE (RAG) ===

export const knowledgeDocuments = pgTable("knowledge_documents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(), // 'pdf', 'doc', 'docx', 'ppt', 'pptx'
  fileSize: integer("file_size").notNull(), // bytes
  pageCount: integer("page_count").default(0),
  chunkCount: integer("chunk_count").default(0),
  status: text("status").notNull().default("processing"), // 'processing', 'ready', 'error'
  errorMessage: text("error_message"),
  hasOcr: boolean("has_ocr").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id").references(() => knowledgeDocuments.id, {
      onDelete: "cascade",
    }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    pageNumber: integer("page_number"),
    embedding: jsonb("embedding"), // JSON array of floats (vector)
    metadata: jsonb("metadata"), // JSONB for extra metadata
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    documentIdIdx: index("document_chunks_document_id_idx").on(
      table.documentId,
    ),
  }),
);

export const knowledgeDocumentsRelations = relations(
  knowledgeDocuments,
  ({ many }) => ({
    chunks: many(documentChunks),
  }),
);

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(knowledgeDocuments, {
    fields: [documentChunks.documentId],
    references: [knowledgeDocuments.id],
  }),
}));

export const insertKnowledgeDocumentSchema = createInsertSchema(
  knowledgeDocuments,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertDocumentChunkSchema = createInsertSchema(
  documentChunks,
).omit({
  id: true,
  createdAt: true,
});

export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type InsertKnowledgeDocument = z.infer<
  typeof insertKnowledgeDocumentSchema
>;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type InsertDocumentChunk = z.infer<typeof insertDocumentChunkSchema>;

// === KNOWLEDGE BASE API TYPES ===

export interface KnowledgeUploadResponse {
  success: boolean;
  document?: KnowledgeDocument;
  error?: string;
}

export interface RagSearchResult {
  chunkId: number;
  documentId: number;
  documentName: string;
  content: string;
  pageNumber?: number;
  score: number;
}

export interface RagQueryResponse {
  answer: string;
  sources: RagSearchResult[];
  error?: string;
}
