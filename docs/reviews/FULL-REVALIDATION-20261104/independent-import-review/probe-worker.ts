import { decodeXmlText, parseXmlPart } from '../../../../apps/api/src/services/import-xml.ts';
import { parseExcelWorkbook } from '../../../../apps/api/src/services/excel-parser.ts';

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const route = new URL(request.url).pathname;
      if (route === '/decode') return Response.json({ result: decodeXmlText(await request.text()) });
      if (route === '/xml') return Response.json({ result: parseXmlPart(Buffer.from(await request.arrayBuffer()), () => {}) });
      const result = parseExcelWorkbook(Buffer.from(await request.arrayBuffer()));
      return Response.json(result);
    } catch (error: any) {
      return Response.json({ error: error.code, message: error.message }, { status: error.status ?? 500 });
    }
  },
};
