import { describe, expect, it } from "vitest";
import { INVALID_INPUT_MESSAGE, decodeEntities, htmlToText, parseImageInput } from "./parseImageInput";

// The snippet Commons offers under "Use this file on the web" (spec §8), verbatim.
const NEWTON_SNIPPET =
  '<a title="Godfrey Kneller, Public domain, via Wikimedia Commons" href="https://commons.wikimedia.org/wiki/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg"><img width="250" alt="Sir Isaac Newton" src="https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/250px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=thumbnail"></a>';

const NEWTON = "File:Portrait of Sir Isaac Newton, 1689 (brightened).jpg";
const COMMONS = "commons.wikimedia.org";
const invalid = { kind: "invalid", message: INVALID_INPUT_MESSAGE };

describe("parseImageInput — Commons snippet", () => {
  it("takes the file from href, the credit from title and the thumbnail as fallback", () => {
    expect(parseImageInput(NEWTON_SNIPPET)).toEqual({
      kind: "wikimedia",
      wiki: COMMONS,
      title: NEWTON,
      credit: "Godfrey Kneller, Public domain, via Wikimedia Commons",
      fallbackSrc:
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/250px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=thumbnail",
    });
  });

  it("tolerates surrounding whitespace and single-quoted attributes", () => {
    const html = `  \n<a title='A &amp; B, CC BY 4.0, via Wikimedia Commons' href='https://commons.wikimedia.org/wiki/File:X.png'><img src='//upload.wikimedia.org/wikipedia/commons/a/ab/X.png'></a>\n`;
    expect(parseImageInput(html)).toEqual({
      kind: "wikimedia",
      wiki: COMMONS,
      title: "File:X.png",
      credit: "A & B, CC BY 4.0, via Wikimedia Commons",
      fallbackSrc: "https://upload.wikimedia.org/wikipedia/commons/a/ab/X.png",
    });
  });

  it("treats a bare <img> fragment as its src", () => {
    const html = '<meta charset="utf-8"><img src="https://example.org/pics/cat.png" alt="cat">';
    expect(parseImageInput(html)).toEqual({ kind: "web", url: "https://example.org/pics/cat.png" });
  });

  it("resolves a bare <img> pointing at Wikimedia to the file", () => {
    const html =
      '<img src="https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/250px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg">';
    expect(parseImageInput(html)).toEqual({ kind: "wikimedia", wiki: COMMONS, title: NEWTON });
  });

  it("rejects HTML with neither a file link nor an image", () => {
    expect(parseImageInput("<p>hello</p>")).toEqual(invalid);
  });
});

describe("parseImageInput — file pages", () => {
  it.each([
    ["https://commons.wikimedia.org/wiki/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg", COMMONS],
    ["https://commons.m.wikimedia.org/wiki/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg", COMMONS],
    ["https://en.wikipedia.org/wiki/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg", "en.wikipedia.org"],
    ["https://en.m.wikipedia.org/wiki/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg", "en.wikipedia.org"],
    ["https://en.wikipedia.org/wiki/Isaac_Newton#/media/File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg", "en.wikipedia.org"],
    ["https://commons.wikimedia.org/wiki/File:Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg", COMMONS],
    ["https://commons.wikimedia.org/w/index.php?title=File:Portrait_of_Sir_Isaac_Newton,_1689_(brightened).jpg", COMMONS],
  ])("%s", (url, wiki) => {
    expect(parseImageInput(url)).toEqual({ kind: "wikimedia", wiki, title: NEWTON });
  });

  it("accepts the legacy Image: prefix", () => {
    expect(parseImageInput("https://en.wikipedia.org/wiki/Image:Example.jpg")).toEqual({
      kind: "wikimedia",
      wiki: "en.wikipedia.org",
      title: "File:Example.jpg",
    });
  });

  it("treats an article URL without a media fragment as an ordinary web URL", () => {
    expect(parseImageInput("https://en.wikipedia.org/wiki/Isaac_Newton")).toEqual({
      kind: "web",
      url: "https://en.wikipedia.org/wiki/Isaac_Newton",
    });
  });
});

describe("parseImageInput — Wikimedia image URLs", () => {
  it.each([
    "https://upload.wikimedia.org/wikipedia/commons/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg",
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/250px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg/1280px-Portrait_of_Sir_Isaac_Newton%2C_1689_%28brightened%29.jpg?utm_source=x",
  ])("%s", (url) => {
    expect(parseImageInput(url)).toEqual({ kind: "wikimedia", wiki: COMMONS, title: NEWTON });
  });

  it("maps a language project to its Wikipedia", () => {
    expect(parseImageInput("https://upload.wikimedia.org/wikipedia/en/a/a9/Example.jpg")).toEqual({
      kind: "wikimedia",
      wiki: "en.wikipedia.org",
      title: "File:Example.jpg",
    });
  });

  it("accepts protocol-relative URLs", () => {
    expect(parseImageInput("//upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg")).toEqual({
      kind: "wikimedia",
      wiki: COMMONS,
      title: "File:Example.jpg",
    });
  });

  it("treats other paths on the image hosts as ordinary web URLs", () => {
    expect(parseImageInput("https://upload.wikimedia.org/favicon.ico").kind).toBe("web");
  });
});

describe("parseImageInput — other input", () => {
  it("keeps any other http(s) URL as a web image", () => {
    expect(parseImageInput("https://example.org/a/b.svg?x=1")).toEqual({
      kind: "web",
      url: "https://example.org/a/b.svg?x=1",
    });
  });

  it.each(["", "   ", "hello world", "example.org/cat.png", "ftp://example.org/cat.png", "javascript:alert(1)"])(
    "rejects %j",
    (text) => {
      expect(parseImageInput(text)).toEqual(invalid);
    }
  );
});

describe("decodeEntities / htmlToText", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x2013; &bogus;")).toBe(
      "a & b <c> \"d\" 'e' – &bogus;"
    );
  });

  it("leaves out-of-range code points alone", () => {
    expect(decodeEntities("&#x110000;")).toBe("&#x110000;");
  });

  it("reduces Commons' Artist HTML to the name", () => {
    const artist =
      '<bdi><a href="https://en.wikipedia.org/wiki/en:Godfrey_Kneller" class="extiw" title="w:en:Godfrey Kneller"><span title="German-born British painter (1646–1723)">Godfrey Kneller</span></a></bdi>';
    expect(htmlToText(artist)).toBe("Godfrey Kneller");
  });

  it("keeps punctuation tight around links and separates block elements", () => {
    const artist =
      '<p>Original by <a href="//en.wikipedia.org/wiki/User:Gutza" title="User:Gutza">Gutza</a>, modifications by <a href="//en.wikipedia.org/wiki/User:Centrx">Centrx</a>\n</p>';
    expect(htmlToText(artist)).toBe("Original by Gutza, modifications by Centrx");
    expect(htmlToText("<p>one</p><p>two</p>a<br>b")).toBe("one two a b");
  });
});
