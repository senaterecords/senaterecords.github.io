import { describe, expect, it } from "vitest";
import { unquoteAttributes } from "../../scripts/minify-html.mjs";

describe("attribute quotes", () => {
  it("drops quotes around simple values only", () => {
    expect(unquoteAttributes('<section class="turn" id="r-12" data-role="senator"><h3 id="w-12-826-liz-krueger" class="sp k sen">Senator Krueger</h3>'))
      .toBe('<section class=turn id=r-12 data-role=senator><h3 id=w-12-826-liz-krueger class="sp k sen">Senator Krueger</h3>');
    expect(unquoteAttributes('<a href="/bills/2025/S172/">S172</a>')).toBe("<a href=/bills/2025/S172/>S172</a>");
  });

  it("keeps quotes where a value could be misread", () => {
    expect(unquoteAttributes('<img src="/a.jpg"/>')).toBe('<img src="/a.jpg"/>');
    expect(unquoteAttributes('<a title="x=y" data-q="it\'s" data-e="">')).toBe('<a title="x=y" data-q="it\'s" data-e="">');
    expect(unquoteAttributes('<p>class="turn" in text</p>')).toBe('<p>class="turn" in text</p>');
  });

  it("leaves scripts and styles alone", () => {
    const html = '<script>var a = \'<b class="x">\';</script><style>a[class="x"]{}</style><b class="y">';
    expect(unquoteAttributes(html)).toBe('<script>var a = \'<b class="x">\';</script><style>a[class="x"]{}</style><b class=y>');
  });
});
