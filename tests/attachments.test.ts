/**
 * Unit tests for the attachment helpers used by create_work_package and
 * update_work_package. These cover content-type detection, the inline-image
 * decision, inline markdown generation, description merging, base64/file input
 * preparation, and the upload orchestrator (with a fake client, no live
 * OpenProject instance).
 */

import { describe, expect, test } from 'bun:test';
import {
  appendInlineImages,
  detectContentType,
  inlineImageMarkdown,
  isImageContentType,
  prepareAttachment,
  uploadPreparedAttachments,
  type AttachmentClient,
  type PreparedAttachment,
} from '../src/attachments.ts';
import { buildOpenProjectMultipartBody, type Attachment } from '../src/openproject-client.ts';

const PNG_BASE64 = Buffer.from('fake-png-bytes').toString('base64');

function fakeAttachment(id: number, fileName: string, contentType: string): Attachment {
  return {
    id,
    fileName,
    fileSize: 42,
    contentType,
    status: 'uploaded',
    createdAt: '2026-06-28T00:00:00Z',
    _links: { self: { href: `/api/v3/attachments/${id}` } },
  };
}

describe('detectContentType', () => {
  test('detects common image types', () => {
    expect(detectContentType('photo.png')).toBe('image/png');
    expect(detectContentType('PHOTO.JPG')).toBe('image/jpeg');
    expect(detectContentType('diagram.svg')).toBe('image/svg+xml');
  });

  test('detects common document types', () => {
    expect(detectContentType('report.pdf')).toBe('application/pdf');
    expect(detectContentType('data.csv')).toBe('text/csv');
  });

  test('falls back to octet-stream for unknown extensions', () => {
    expect(detectContentType('archive.unknownext')).toBe('application/octet-stream');
    expect(detectContentType('noextension')).toBe('application/octet-stream');
  });
});

describe('isImageContentType', () => {
  test('recognizes image MIME types case-insensitively', () => {
    expect(isImageContentType('image/png')).toBe(true);
    expect(isImageContentType('IMAGE/JPEG')).toBe(true);
    expect(isImageContentType('application/pdf')).toBe(false);
  });
});

describe('inlineImageMarkdown', () => {
  test('references the attachment content endpoint', () => {
    expect(inlineImageMarkdown({ id: 7, fileName: 'cat.png' })).toBe('![cat.png](/api/v3/attachments/7/content)');
  });
});

describe('appendInlineImages', () => {
  test('returns markdown alone when base is empty', () => {
    expect(appendInlineImages('', '![a](x)')).toBe('![a](x)');
    expect(appendInlineImages('   ', '![a](x)')).toBe('![a](x)');
  });

  test('appends with a blank line separator, trimming trailing whitespace', () => {
    expect(appendInlineImages('Existing description.\n\n', '![a](x)')).toBe('Existing description.\n\n![a](x)');
  });
});

describe('prepareAttachment', () => {
  test('decodes base64 and auto-detects an image content type + inline default', async () => {
    const prepared = await prepareAttachment({ fileName: 'shot.png', base64: PNG_BASE64 });
    expect(prepared.fileName).toBe('shot.png');
    expect(prepared.contentType).toBe('image/png');
    expect(prepared.isImage).toBe(true);
    expect(prepared.inline).toBe(true);
    expect(Buffer.from(prepared.content).toString()).toBe('fake-png-bytes');
  });

  test('non-image files default to not inline', async () => {
    const prepared = await prepareAttachment({ fileName: 'report.pdf', base64: PNG_BASE64 });
    expect(prepared.isImage).toBe(false);
    expect(prepared.inline).toBe(false);
  });

  test('explicit inline flag overrides the image default', async () => {
    const asAttachment = await prepareAttachment({ fileName: 'shot.png', base64: PNG_BASE64, inline: false });
    expect(asAttachment.inline).toBe(false);
  });

  test('requires filePath or base64', async () => {
    await expect(prepareAttachment({ fileName: 'x.png' })).rejects.toThrow(/filePath.*base64/);
  });

  test('rejects providing both filePath and base64', async () => {
    await expect(prepareAttachment({ fileName: 'x.png', filePath: '/tmp/x.png', base64: PNG_BASE64 })).rejects.toThrow(/only one/);
  });

  test('base64 input requires a fileName', async () => {
    await expect(prepareAttachment({ base64: PNG_BASE64 })).rejects.toThrow(/fileName/);
  });

  test('reads a local file and derives the file name from the path', async () => {
    const tmp = `${process.env.TMPDIR ?? '/tmp'}/attachments-test-${Date.now()}.txt`;
    await Bun.write(tmp, 'hello attachment');
    try {
      const prepared = await prepareAttachment({ filePath: tmp });
      expect(prepared.fileName).toBe(tmp.split('/').pop()!);
      expect(prepared.contentType).toBe('text/plain');
      expect(prepared.isImage).toBe(false);
      expect(Buffer.from(prepared.content).toString()).toBe('hello attachment');
    } finally {
      await Bun.file(tmp).delete();
    }
  });
});

describe('uploadPreparedAttachments', () => {
  function makeClient(): { client: AttachmentClient; calls: Array<{ wpId: number; fileName: string }> } {
    const calls: Array<{ wpId: number; fileName: string }> = [];
    let nextId = 100;
    const client: AttachmentClient = {
      async createWorkPackageAttachment(workPackageId, attachment) {
        calls.push({ wpId: workPackageId, fileName: attachment.fileName });
        return fakeAttachment(nextId++, attachment.fileName, attachment.contentType ?? 'application/octet-stream');
      },
    };
    return { client, calls };
  }

  test('embeds images inline and leaves other files as plain attachments', async () => {
    const { client, calls } = makeClient();
    const prepared: PreparedAttachment[] = [
      { fileName: 'a.png', content: new Uint8Array([1]), contentType: 'image/png', inline: true, isImage: true },
      { fileName: 'b.pdf', content: new Uint8Array([2]), contentType: 'application/pdf', inline: false, isImage: false },
    ];

    const { results, inlineMarkdown } = await uploadPreparedAttachments(client, 555, prepared);

    expect(calls).toEqual([
      { wpId: 555, fileName: 'a.png' },
      { wpId: 555, fileName: 'b.pdf' },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ status: 'uploaded', id: 100, inline: true, inlineMarkdown: '![a.png](/api/v3/attachments/100/content)' });
    expect(results[1]).toMatchObject({ status: 'uploaded', id: 101, inline: false });
    expect(results[1]?.inlineMarkdown).toBeUndefined();
    expect(inlineMarkdown).toBe('![a.png](/api/v3/attachments/100/content)');
  });

  test('an image flagged inline:false is uploaded but not embedded', async () => {
    const { client } = makeClient();
    const prepared: PreparedAttachment[] = [
      { fileName: 'a.png', content: new Uint8Array([1]), contentType: 'image/png', inline: false, isImage: true },
    ];
    const { results, inlineMarkdown } = await uploadPreparedAttachments(client, 1, prepared);
    expect(results[0]).toMatchObject({ status: 'uploaded', inline: false });
    expect(inlineMarkdown).toBe('');
  });

  test('records a failed upload without aborting the rest', async () => {
    let count = 0;
    const client: AttachmentClient = {
      async createWorkPackageAttachment(_wpId, attachment) {
        count += 1;
        if (count === 1) throw new Error('boom');
        return fakeAttachment(200, attachment.fileName, attachment.contentType ?? 'application/octet-stream');
      },
    };
    const prepared: PreparedAttachment[] = [
      { fileName: 'fails.png', content: new Uint8Array([1]), contentType: 'image/png', inline: true, isImage: true },
      { fileName: 'ok.png', content: new Uint8Array([2]), contentType: 'image/png', inline: true, isImage: true },
    ];

    const { results, inlineMarkdown } = await uploadPreparedAttachments(client, 9, prepared);
    expect(results[0]).toMatchObject({ status: 'failed', fileName: 'fails.png', error: 'boom' });
    expect(results[1]).toMatchObject({ status: 'uploaded', id: 200 });
    expect(inlineMarkdown).toBe('![ok.png](/api/v3/attachments/200/content)');
  });
});

describe('buildOpenProjectMultipartBody', () => {
  test('builds the exact two OpenProject attachment parts', () => {
    const multipart = buildOpenProjectMultipartBody(
      'image.png',
      new Uint8Array(Buffer.from('png-bytes')),
      'image/png',
      'Screenshot',
      { boundary: 'test-boundary' }
    );
    const body = multipart.body.toString('utf8');

    expect(multipart.contentType).toBe('multipart/form-data; boundary=test-boundary');
    expect(multipart.contentLength).toBe(multipart.body.byteLength);
    expect(body).toContain('Content-Disposition: form-data; name="metadata"\r\nContent-Type: application/json');
    expect(body).not.toContain('name="metadata"; filename');
    expect(body).toContain('{"fileName":"image.png","description":{"raw":"Screenshot"}}');
    expect(body).toContain('Content-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\npng-bytes');
    expect(body.endsWith('\r\n--test-boundary--\r\n')).toBe(true);
  });
});
