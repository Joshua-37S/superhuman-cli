import { describe, expect, test } from "bun:test";
import { textToHtml } from "../superhuman-api";

describe("textToHtml", () => {
  test("escapes plain text HTML characters", () => {
    const result = textToHtml("A < B & C > D");
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
    expect(result).toContain("&amp;");
  });

  test("preserves explicit HTML", () => {
    const html = "<p>Hello</p>";
    expect(textToHtml(html)).toBe(html);
  });

  test("converts newlines to paragraphs and line breaks", () => {
    const result = textToHtml("line1\nline2\n\nline3");
    expect(result).toBe("<p>line1<br>line2</p><p>line3</p>");
  });
});
