/**
 * Cursor-based pagination — unit tests.
 */

import { describe, it, expect } from "vitest";
import {
  paginate,
  encodeCursor,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "../../../src/utils/pagination.js";

describe("paginate", () => {
  const items = Array.from({ length: 30 }, (_, i) => i);

  it("returns the first page with a next_cursor when more items remain", () => {
    const { items: page, page: envelope } = paginate(items, undefined, 10);
    expect(page).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(envelope.total).toBe(30);
    expect(envelope.next_cursor).toBeDefined();
  });

  it("follows next_cursor to the next page", () => {
    const first = paginate(items, undefined, 10);
    const second = paginate(items, first.page.next_cursor, 10);
    expect(second.items).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it("omits next_cursor on the last page", () => {
    const { page: envelope } = paginate(items, undefined, 30);
    expect(envelope.next_cursor).toBeUndefined();
  });

  it("clamps page size to [1, MAX_PAGE_SIZE]", () => {
    expect(paginate(items, undefined, 0).items).toHaveLength(1);
    expect(paginate(items, undefined, 1000).items).toHaveLength(items.length);
  });

  it("defaults page size when omitted", () => {
    const { items: page } = paginate(items, undefined, undefined);
    expect(page).toHaveLength(Math.min(DEFAULT_PAGE_SIZE, items.length));
  });

  it("falls back to offset 0 for a malformed cursor", () => {
    const { items: page } = paginate(items, "not-a-real-cursor", 5);
    expect(page).toEqual([0, 1, 2, 3, 4]);
  });

  it("clamps an out-of-range cursor offset to the end (empty page)", () => {
    const cursor = encodeCursor({ offset: 1000 });
    const { items: page } = paginate(items, cursor, 5);
    expect(page).toEqual([]);
  });

  it("encodeCursor/decodeCursor round-trip", () => {
    expect(decodeCursor(encodeCursor({ offset: 42 }))).toEqual({ offset: 42 });
  });

  it("MAX_PAGE_SIZE constant matches paginationInputSchema's own max", () => {
    expect(MAX_PAGE_SIZE).toBe(100);
  });
});
