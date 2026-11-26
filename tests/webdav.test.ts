import { describe, expect, it } from 'vitest';
import { parseMultiStatus } from '../src/adapters/webdav';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://ns.jianguoyun.com">
  <d:response>
    <d:href>/dav/UDaSync/</d:href>
    <d:propstat><d:prop>
      <d:getcontenttype>httpd/unix-directory</d:getcontenttype>
      <d:resourcetype><d:collection/></d:resourcetype>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/UDaSync/devices/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/></d:resourcetype>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/UDaSync/devices/d-1.json.gz</d:href>
    <d:propstat><d:prop>
      <d:getcontentlength>1024</d:getcontentlength>
      <d:getlastmodified>Thu, 26 Nov 2026 13:37:48 GMT</d:getlastmodified>
      <d:resourcetype/>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;

describe('parseMultiStatus', () => {
  it('解析目录与文件，跳过自身', () => {
    const entries = parseMultiStatus(xml, 'UDaSync');
    const names = entries.map((e) => e.name);
    expect(names).toEqual(['devices', 'd-1.json.gz']);
    expect(entries[0]!.isDir).toBe(true);
    expect(entries[1]!.isDir).toBe(false);
    expect(entries[1]!.size).toBe(1024);
  });
});
