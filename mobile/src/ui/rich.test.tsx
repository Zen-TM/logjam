import { isValidElement, type ReactNode } from "react";
import { rich } from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { Rich } from "./rich";

function flattenText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return flattenText(node.props.children);
  }
  return "";
}

describe("Rich", () => {
  // Mutation: render a tag's `text` without calling `tags[part.tag]`, so the
  // tag loses its element.
  it("draws a tag as the element its caller gives it, and the rest as text", () => {
    const seen: string[] = [];
    const el = Rich({
      parts: rich`I agree to the <a>${"Terms"}</a>.`,
      tags: {
        a: (text) => {
          seen.push(text);
          return `[${text}]`;
        },
      },
    });
    expect(seen).toEqual(["Terms"]);
    expect(flattenText(el)).toBe("I agree to the [Terms].");
  });

  // Mutation: return `null` for a tag `tags` does not name, instead of its
  // text, and the words go missing.
  it("keeps the words of a tag the caller does not name", () => {
    const el = Rich({
      parts: rich`Open <a>${"the map"}</a>.`,
      tags: {},
    });
    expect(flattenText(el)).toBe("Open the map.");
  });
});
