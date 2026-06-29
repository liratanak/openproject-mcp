/**
 * Work package attachment helpers
 *
 * Turns user-friendly attachment inputs (a local file path or base64 content)
 * into uploadable payloads, uploads them to a work package, and decides which
 * ones become inline images in the description versus plain file attachments.
 *
 * Images (content type `image/*`) default to being embedded inline in the work
 * package description as markdown — `![fileName](/api/v3/attachments/{id}/content)`
 * — while every other file type is left as a normal work package file
 * attachment. The `inline` flag overrides this per attachment.
 *
 * The upload orchestrator talks to a minimal `AttachmentClient` interface so it
 * can be unit tested with a fake client instead of a live OpenProject instance.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Attachment } from './openproject-client.ts';

/** Raw attachment input as accepted by the MCP tools. */
export interface AttachmentInput {
  /** File name including extension. Derived from `filePath` when omitted. */
  fileName?: string;
  /** Path to a local file the server can read. Mutually exclusive with `base64`. */
  filePath?: string;
  /** Base64-encoded file content. Mutually exclusive with `filePath`. */
  base64?: string;
  /** MIME type. Auto-detected from the file extension when omitted. */
  contentType?: string;
  /** Optional caption stored on the attachment. */
  description?: string;
  /** Embed in the description as an inline image. Defaults to true for images. */
  inline?: boolean;
}

/** An attachment whose content has been resolved into bytes and is ready to upload. */
export interface PreparedAttachment {
  fileName: string;
  content: Uint8Array;
  contentType: string;
  description?: string;
  /** Resolved inline decision (image + not explicitly disabled). */
  inline: boolean;
  isImage: boolean;
}

/** Per-attachment outcome reported back to the caller. */
export interface UploadedAttachmentResult {
  status: 'uploaded' | 'failed';
  fileName: string;
  contentType: string;
  inline: boolean;
  id?: number;
  fileSize?: number;
  /** Inline image markdown, present when the attachment was embedded in the description. */
  inlineMarkdown?: string;
  error?: string;
}

/** Minimal client surface needed to upload an attachment — keeps the orchestrator testable. */
export interface AttachmentClient {
  createWorkPackageAttachment(
    workPackageId: number,
    attachment: { fileName: string; content: Uint8Array; contentType?: string; description?: string }
  ): Promise<Attachment>;
}

// Common file extensions → MIME types. Images are listed first so the inline
// detection has good coverage; a handful of frequent document types follow.
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  // images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
  heic: 'image/heic',
  // documents / other
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/** Guess a MIME type from a file name's extension, defaulting to octet-stream. */
export function detectContentType(fileName: string): string {
  const ext = path.extname(fileName).replace(/^\./, '').toLowerCase();
  return EXTENSION_CONTENT_TYPES[ext] ?? DEFAULT_CONTENT_TYPE;
}

/** True when a MIME type denotes an image (and so can be embedded inline). */
export function isImageContentType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('image/');
}

/**
 * Markdown that embeds an uploaded attachment as an inline image, referencing
 * the OpenProject attachment content endpoint. OpenProject resolves this link
 * when rendering the description's rich text.
 */
export function inlineImageMarkdown(attachment: { id: number; fileName: string }): string {
  return `![${attachment.fileName}](/api/v3/attachments/${attachment.id}/content)`;
}

/**
 * Append inline image markdown to an existing description, separating it from
 * prior content with a blank line. Returns the markdown alone when the base is
 * empty.
 */
export function appendInlineImages(baseDescription: string, inlineMarkdown: string): string {
  const base = baseDescription ?? '';
  if (base.trim() === '') return inlineMarkdown;
  return `${base.replace(/\s+$/, '')}\n\n${inlineMarkdown}`;
}

/**
 * Resolve one attachment input into uploadable bytes. Reads the local file when
 * `filePath` is given, otherwise decodes `base64`. Content type is taken from
 * the input or guessed from the file name; the inline decision defaults to true
 * for images unless `inline` is explicitly set.
 */
export async function prepareAttachment(input: AttachmentInput): Promise<PreparedAttachment> {
  const hasPath = typeof input.filePath === 'string' && input.filePath.trim() !== '';
  const hasBase64 = typeof input.base64 === 'string' && input.base64.trim() !== '';

  if (!hasPath && !hasBase64) {
    throw new Error('Attachment requires either "filePath" or "base64" content');
  }
  if (hasPath && hasBase64) {
    throw new Error('Attachment must provide only one of "filePath" or "base64", not both');
  }

  let content: Uint8Array;
  let fileName = input.fileName?.trim();

  if (hasPath) {
    const filePath = input.filePath!.trim();
    let buffer: Buffer;
    try {
      buffer = await fs.promises.readFile(filePath);
    } catch (error) {
      throw new Error(`Could not read attachment file "${filePath}": ${error instanceof Error ? error.message : String(error)}`);
    }
    content = new Uint8Array(buffer);
    if (!fileName) fileName = path.basename(filePath);
  } else {
    if (!fileName) {
      throw new Error('Attachment provided as base64 must also provide a "fileName"');
    }
    try {
      content = new Uint8Array(Buffer.from(input.base64!, 'base64'));
    } catch (error) {
      throw new Error(`Could not decode base64 content for "${fileName}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!fileName) {
    throw new Error('Attachment requires a "fileName"');
  }

  const contentType = input.contentType?.trim() || detectContentType(fileName);
  const isImage = isImageContentType(contentType);
  const inline = input.inline ?? isImage;

  return { fileName, content, contentType, description: input.description, inline, isImage };
}

/** Resolve every attachment input into uploadable bytes. */
export async function prepareAttachments(inputs: AttachmentInput[]): Promise<PreparedAttachment[]> {
  return Promise.all(inputs.map(prepareAttachment));
}

/**
 * Upload already-prepared attachments to a work package one by one. Returns a
 * per-attachment result list plus the combined inline image markdown for every
 * image that was embedded inline (empty when there were none). A single failed
 * upload is recorded and does not abort the rest.
 */
export async function uploadPreparedAttachments(
  client: AttachmentClient,
  workPackageId: number,
  prepared: PreparedAttachment[]
): Promise<{ results: UploadedAttachmentResult[]; inlineMarkdown: string }> {
  const results: UploadedAttachmentResult[] = [];
  const inlineSnippets: string[] = [];

  for (const item of prepared) {
    try {
      const attachment = await client.createWorkPackageAttachment(workPackageId, {
        fileName: item.fileName,
        content: item.content,
        contentType: item.contentType,
        description: item.description,
      });

      const embedInline = item.inline && item.isImage;
      const markdown = embedInline ? inlineImageMarkdown({ id: attachment.id, fileName: attachment.fileName }) : undefined;
      if (markdown) inlineSnippets.push(markdown);

      results.push({
        status: 'uploaded',
        id: attachment.id,
        fileName: attachment.fileName,
        contentType: attachment.contentType ?? item.contentType,
        fileSize: attachment.fileSize,
        inline: Boolean(embedInline),
        ...(markdown ? { inlineMarkdown: markdown } : {}),
      });
    } catch (error) {
      results.push({
        status: 'failed',
        fileName: item.fileName,
        contentType: item.contentType,
        inline: item.inline && item.isImage,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { results, inlineMarkdown: inlineSnippets.join('\n\n') };
}
